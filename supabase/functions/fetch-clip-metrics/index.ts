// fetch-clip-metrics
// Pulls views / likes / comments for a submitted clip from ScrapeCreators and
// writes them onto clip_submissions + clip_metrics_history.
//
// Modes:
//   POST { mode: "refresh", limit: 200 }    -> batch, called hourly by pg_cron
//   POST { submission_id: "<uuid>" }        -> one clip, STAFF/service only
//   POST { mode: "open", campaign_id? }     -> a client opened their dashboard (or staff
//                                              opened a campaign): re-read the clips they
//                                              see whose numbers are 30+ min old (064)
//
// There is deliberately no clipper-facing refresh. Every pull costs a
// ScrapeCreators credit, so the schedule is the only thing that spends them.
//
// WHICH clips get fetched is decided entirely in SQL by
// public.clips_due_for_metrics() / public.clip_metrics_eligible().
//
// When a pull returns exactly the numbers already stored, only metrics_fetched_at
// is stamped (so the clip is not picked again too soon) and no history row is
// added: more than half of all pulls were unchanged, and every write counts
// against the database's disk IO budget.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SC_KEY = Deno.env.get("SCRAPECREATORS_API_KEY") ?? "";
const SC_BASE = "https://api.scrapecreators.com";

const BATCH_DEFAULT = 200;
const CONCURRENCY = 8;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/* ------------------------------------------------------------------ *
 * URL parsing
 * ------------------------------------------------------------------ */

type Platform = "youtube" | "tiktok" | "instagram";

interface Parsed {
  platform: Platform;
  postId: string | null;
  url: string;
}

function parseClipUrl(raw: string): Parsed | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\.|^vm\.|^vt\./, "").toLowerCase();
  const path = u.pathname.replace(/\/+$/, "");

  if (host === "youtu.be") {
    const id = path.split("/").filter(Boolean)[0] ?? null;
    return id ? { platform: "youtube", postId: id, url: `https://www.youtube.com/watch?v=${id}` } : null;
  }
  if (host.endsWith("youtube.com")) {
    const v = u.searchParams.get("v");
    if (v) return { platform: "youtube", postId: v, url: `https://www.youtube.com/watch?v=${v}` };
    const m = path.match(/^\/(shorts|live|embed|v)\/([A-Za-z0-9_-]{6,})/);
    if (m) return { platform: "youtube", postId: m[2], url: `https://www.youtube.com/watch?v=${m[2]}` };
    return null;
  }

  if (host.endsWith("tiktok.com")) {
    const m = path.match(/\/video\/(\d+)/) ?? path.match(/\/photo\/(\d+)/);
    // Short links (vm.tiktok.com/XXXX) carry no id; ScrapeCreators follows the
    // redirect itself, so pass the URL through untouched.
    return { platform: "tiktok", postId: m ? m[1] : null, url: u.origin + path };
  }

  if (host.endsWith("instagram.com")) {
    const m = path.match(/\/(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/);
    if (!m) return null;
    return { platform: "instagram", postId: m[1], url: `https://www.instagram.com/p/${m[1]}/` };
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * ScrapeCreators
 * ------------------------------------------------------------------ */

interface Metrics {
  views: number;
  likes: number;
  comments: number;
  shares: number;
}

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? Math.round(x) : 0;
};

/** Largest of several candidate counts. See the Instagram note below. */
const best = (...vals: unknown[]): number => Math.max(0, ...vals.map(n));

async function scGet(path: string, params: Record<string, string>): Promise<any> {
  const url = new URL(SC_BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, {
    headers: { "x-api-key": SC_KEY },
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ScrapeCreators ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function fetchMetrics(p: Parsed): Promise<Metrics> {
  if (p.platform === "youtube") {
    const d = await scGet("/v1/youtube/video", { url: p.url });
    if (d?.success === false) throw new Error(d?.error ?? "YouTube lookup failed");
    return {
      views: n(d?.viewCountInt),
      likes: n(d?.likeCountInt),
      comments: n(d?.commentCountInt),
      shares: 0, // YouTube does not expose share counts publicly
    };
  }

  if (p.platform === "tiktok") {
    const d = await scGet("/v2/tiktok/video", { url: p.url, trim: "true" });
    const st = d?.aweme_detail?.statistics;
    if (!st) throw new Error("TikTok video not found or private");
    return {
      views: n(st.play_count),
      likes: n(st.digg_count),
      comments: n(st.comment_count),
      shares: n(st.share_count),
    };
  }

  // ---- Instagram ----
  const d = await scGet("/v1/instagram/post", { url: p.url });
  const m = d?.data?.xdt_shortcode_media;
  if (!m) throw new Error("Instagram post not found or private");

  // Instagram exposes the like count in more than one place and they disagree:
  // `edge_liked_by.count` is the real total, while `edge_media_preview_like`
  // is a PREVIEW subset that can be an order of magnitude smaller (a reel
  // showing 128 likes came back as 20 from the preview field). Take the
  // largest of the candidates rather than trusting any single one. Same idea
  // for comments, where the parent-comment count excludes replies.
  return {
    // play_count is the reel view number; view_count is often 0. Static posts
    // have neither, so views legitimately stays 0 for them.
    views: best(m.video_play_count, m.video_view_count),
    likes: best(m.edge_liked_by?.count, m.edge_media_preview_like?.count),
    comments: best(m.edge_media_to_comment?.count,
                   m.edge_media_to_parent_comment?.count,
                   m.edge_media_preview_comment?.count),
    shares: 0, // Instagram does not expose share counts publicly
  };
}

/* ------------------------------------------------------------------ *
 * Per-row worker
 * ------------------------------------------------------------------ */

interface Row {
  id: string;
  clip_url: string | null;
  metrics_fetched_at: string | null;
}

async function processRow(row: Row) {
  const parsed = row.clip_url ? parseClipUrl(row.clip_url) : null;

  if (!parsed) {
    await admin.from("clip_submissions").update({
      metrics_status: "unsupported",
      metrics_error: "Unrecognised URL — must be a YouTube, TikTok or Instagram link",
      metrics_fetched_at: new Date().toISOString(),
    }).eq("id", row.id);
    return { id: row.id, status: "unsupported" };
  }

  try {
    const m = await fetchMetrics(parsed);
    const engagement = m.views > 0
      ? Math.round(((m.likes + m.comments + m.shares) / m.views) * 10000) / 100
      : 0;

    // Same numbers as last time: just record that we checked.
    const { data: cur } = await admin.from("clip_submissions")
      .select("views, views_count, likes, comments, shares, platform_post_id, metrics_status")
      .eq("id", row.id).maybeSingle();
    if (cur && cur.metrics_status === "ok" && cur.platform_post_id === parsed.postId &&
        Number(cur.views) === m.views && Number(cur.views_count) === m.views && Number(cur.likes) === m.likes &&
        Number(cur.comments) === m.comments && Number(cur.shares) === m.shares) {
      const { error } = await admin.from("clip_submissions")
        .update({ metrics_fetched_at: new Date().toISOString() }).eq("id", row.id);
      if (error) throw new Error(error.message);
      return { id: row.id, status: "unchanged", ...m, engagement_rate: engagement };
    }

    const { error } = await admin.from("clip_submissions").update({
      views: m.views,
      views_count: m.views,
      likes: m.likes,
      comments: m.comments,
      shares: m.shares,
      engagement_rate: engagement,
      platform_post_id: parsed.postId,
      metrics_status: "ok",
      metrics_error: null,
      metrics_fetched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
    if (error) throw new Error(error.message);

    await admin.from("clip_metrics_history").insert({
      submission_id: row.id,
      views: m.views,
      likes: m.likes,
      comments: m.comments,
      shares: m.shares,
    });

    return { id: row.id, status: "ok", ...m, engagement_rate: engagement };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("clip_submissions").update({
      metrics_status: "error",
      metrics_error: msg.slice(0, 500),
      metrics_fetched_at: new Date().toISOString(),
    }).eq("id", row.id);
    return { id: row.id, status: "error", error: msg };
  }
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

/**
 * cx_is_staff() reads auth.uid() out of the JWT, so it MUST be called with the
 * caller's own token. Calling it through the service-role client always returns
 * false, because that client carries no user JWT.
 */
async function isStaff(token: string): Promise<boolean> {
  if (!token) return false;
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await asCaller.rpc("cx_is_staff");
  return !error && data === true;
}

/* ------------------------------------------------------------------ *
 * Handler
 * ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!SC_KEY) return json({ error: "SCRAPECREATORS_API_KEY is not set on this project" }, 500);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const isService = !!SERVICE_KEY && token === SERVICE_KEY;

  let body: any = {};
  try {
    body = await req.json();
  } catch { /* empty body is fine */ }

  /* ---- batch mode (hourly cron) ---- */
  if (body.mode === "refresh") {
    if (!isService) return json({ error: "Batch refresh requires the service-role key" }, 403);

    const limit = Math.min(Number(body.limit) || BATCH_DEFAULT, 500);
    const { data, error } = await admin.rpc("clips_due_for_metrics", { p_limit: limit });
    if (error) return json({ error: error.message }, 500);
    if (!data?.length) return json({ mode: "refresh", processed: 0, tally: {} });

    const results = await pool(data as Row[], CONCURRENCY, processRow);
    const tally = results.reduce<Record<string, number>>((a, r: any) => {
      a[r.status] = (a[r.status] ?? 0) + 1;
      return a;
    }, {});
    return json({ mode: "refresh", processed: results.length, tally });
  }

  /* ---- someone opened a dashboard ---- */
  if (body.mode === "open") {
    if (!token || isService) return json({ error: "Sign in first" }, 401);
    const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await asCaller.rpc("clips_due_on_open", { p_campaign: body.campaign_id || null });
    if (error) return json({ error: error.message }, 403);
    if (!data?.length) return json({ mode: "open", processed: 0, changed: 0 });
    const results = await pool(data as Row[], CONCURRENCY, processRow);
    return json({ mode: "open", processed: results.length,
                  changed: results.filter((r: any) => r.status === "ok").length });
  }

  /* ---- single submission: staff / service only ---- */
  const id = body.submission_id;
  if (!id) return json({ error: "submission_id is required" }, 400);

  if (!isService && !(await isStaff(token))) {
    return json({
      error: "Manual refresh is staff-only. Clip metrics update on their own schedule.",
    }, 403);
  }

  const { data: row, error } = await admin
    .from("clip_submissions")
    .select("id, clip_url, metrics_fetched_at")
    .eq("id", id)
    .maybeSingle();

  if (error) return json({ error: error.message }, 500);
  if (!row) return json({ error: "Submission not found" }, 404);

  if (body.force !== true) {
    const { data: ok } = await admin.rpc("clip_metrics_eligible", { p_id: id });
    if (ok !== true) {
      return json({
        id,
        status: "not_eligible",
        reason:
          "Metrics only refresh for approved clips on an active, in-budget campaign, " +
          "within 14 days of submission. Pass force:true to override.",
      }, 409);
    }
  }

  const result = await processRow(row as Row);
  return json(result, (result as any).status === "error" ? 502 : 200);
});
