// creator-reels
// Lists a creator's recent Instagram reels through ScrapeCreators, so staff
// can see which reels are not yet on Clipency. Internal: the caller must be
// the service role or staff (cx_is_staff). The API key never leaves here.
//
//   POST { handle: "mercyunnfiltered", since?: "2026-09-01", max_pages?: 5 }
//
// Pages newest-first until a reel older than `since` turns up, the feed
// ends, or max_pages is hit (12 reels and 1 credit per page). The profile
// endpoint (1 credit) is read too, because pinned reels do not come through
// the feed. Reels older than `since` can still be in the last page; filter
// on taken_at when that matters.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SC_KEY = Deno.env.get("SCRAPECREATORS_API_KEY") ?? "";
const SC_BASE = "https://api.scrapecreators.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function scGet(path: string, params: Record<string, string>) {
  const url = new URL(SC_BASE + path);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "x-api-key": SC_KEY }, signal: AbortSignal.timeout(40_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`ScrapeCreators ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { throw new Error(`ScrapeCreators returned non-JSON: ${text.slice(0, 120)}`); }
}

type Reel = {
  code: string; taken_at: string | null; play_count: number | null; like_count: number | null;
  comment_count: number | null; caption: string; source: "reels" | "profile";
};

/** an item of the reels feed (items[].media) */
function reelFromItem(m: any): Reel | null {
  if (!m || !m.code) return null;
  const ts = Number(m.taken_at ?? m.taken_at_timestamp ?? 0);
  return {
    code: String(m.code),
    taken_at: ts ? new Date(ts * 1000).toISOString() : null,
    play_count: m.play_count ?? m.ig_play_count ?? m.view_count ?? null,
    like_count: m.like_count ?? null,
    comment_count: m.comment_count ?? null,
    caption: String(m.caption?.text ?? (typeof m.caption === "string" ? m.caption : "")).slice(0, 140),
    source: "reels",
  };
}

/** a node of the profile's timeline (edge_owner_to_timeline_media.edges[].node) */
function reelFromProfileEdge(n: any): Reel | null {
  if (!n || !n.shortcode || n.is_video === false) return null;
  const ts = Number(n.taken_at_timestamp ?? 0);
  return {
    code: String(n.shortcode),
    taken_at: ts ? new Date(ts * 1000).toISOString() : null,
    play_count: n.video_view_count ?? n.video_play_count ?? null,
    like_count: n.edge_liked_by?.count ?? n.edge_media_preview_like?.count ?? null,
    comment_count: n.edge_media_to_comment?.count ?? null,
    caption: String(n.edge_media_to_caption?.edges?.[0]?.node?.text ?? "").slice(0, 140),
    source: "profile",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!SC_KEY) return json({ error: "SCRAPECREATORS_API_KEY is not set on this project" }, 500);

  // service role, or a signed-in staff member (cx_is_staff reads auth.uid())
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  let allowed = !!SERVICE_KEY && token === SERVICE_KEY;
  if (!allowed && token) {
    const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: staff } = await asCaller.rpc("cx_is_staff");
    allowed = staff === true;
  }
  if (!allowed) return json({ error: "Staff only" }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const handle = String(body.handle ?? "").replace(/^@/, "").trim();
  if (!handle) return json({ error: "handle is required" }, 400);
  const sinceMs = body.since ? new Date(body.since).getTime() : 0;
  const maxPages = Math.min(Math.max(Number(body.max_pages) || 5, 1), 15);

  const items = new Map<string, Reel>();
  const errors: string[] = [];
  let requests = 0, pages = 0, maxId = "", moreAvailable = true, reachedSince = false;
  try {
    while (pages < maxPages && moreAvailable && !reachedSince) {
      const page = await scGet("/v1/instagram/user/reels", { handle, max_id: maxId });
      requests++; pages++;
      const list: any[] = page?.items ?? page?.data?.items ?? [];
      for (const it of list) {
        const r = reelFromItem(it?.media ?? it);
        if (!r) continue;
        if (!items.has(r.code)) items.set(r.code, r);
        if (sinceMs && r.taken_at && new Date(r.taken_at).getTime() < sinceMs) reachedSince = true;
      }
      maxId = String(page?.paging_info?.max_id ?? page?.max_id ?? "");
      moreAvailable = !!(page?.paging_info?.more_available ?? page?.more_available ?? maxId);
      if (!list.length || !maxId) moreAvailable = false;
    }
  } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }

  let profile: Record<string, unknown> | null = null;
  try {
    const p = await scGet("/v1/instagram/profile", { handle });
    requests++;
    const u = p?.data?.user ?? p?.user ?? p;
    profile = {
      media_count: u?.edge_owner_to_timeline_media?.count ?? u?.media_count ?? null,
      followers: u?.edge_followed_by?.count ?? u?.follower_count ?? null,
      is_private: u?.is_private ?? null,
    };
    const edges: any[] = u?.edge_owner_to_timeline_media?.edges ?? [];
    for (const e of edges) { const r = reelFromProfileEdge(e?.node); if (r && !items.has(r.code)) items.set(r.code, r); }
  } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }

  const out = [...items.values()].sort((a, b) => String(b.taken_at ?? "").localeCompare(String(a.taken_at ?? "")));
  return json({ handle, requests, pages, reached_since: reachedSince, more_available: moreAvailable, profile, count: out.length, items: out, errors });
});
