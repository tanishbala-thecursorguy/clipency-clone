// autosub-sync
// Auto-submit for linked accounts (036): looks at each linked account's newest
// posts and hands them to cx_autosub_ingest, which submits the ones posted after
// the account was linked, once each, to the campaign the creator picked. The
// duplicate guard and every other clip rule still apply in SQL.
//
//   POST { mode: "sync" }   service role only (pg_cron cx_autosub_sync every 15 min,
//                           and "Sync now" in the dashboard through autosub_sync_now)
//
// Instagram reads the newest reels through ScrapeCreators (same key as
// creator-reels: SCRAPECREATORS_API_KEY), 1 credit per account per run, and only
// for accounts that are due (an hour since the last sync, or "Sync now").
// TikTok and YouTube are marked synced with nothing found until their readers are
// added here. Once Meta approves Instagram Login, the official API can replace
// ScrapeCreators for accounts connected that way.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SC_KEY = Deno.env.get("SCRAPECREATORS_API_KEY") ?? "";
const SC_BASE = "https://api.scrapecreators.com";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Due = { account_id: string; platform: string; handle: string; since: string; last_synced_at: string | null };
type Post = { external_id: string; url: string; caption: string; posted_at: string };

async function instagramReels(handle: string): Promise<Post[]> {
  const url = new URL(SC_BASE + "/v1/instagram/user/reels");
  url.searchParams.set("handle", handle.replace(/^@/, ""));
  const res = await fetch(url, { headers: { "x-api-key": SC_KEY }, signal: AbortSignal.timeout(40_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`ScrapeCreators ${res.status}: ${text.slice(0, 200)}`);
  const page = JSON.parse(text);
  const list: any[] = page?.items ?? page?.data?.items ?? [];
  const out: Post[] = [];
  for (const it of list) {
    const m = it?.media ?? it;
    const ts = Number(m?.taken_at ?? m?.taken_at_timestamp ?? 0);
    if (!m?.code || !ts) continue;
    out.push({
      external_id: String(m.code),
      url: `https://www.instagram.com/reel/${m.code}/`,
      caption: String(m.caption?.text ?? (typeof m.caption === "string" ? m.caption : "")).slice(0, 500),
      posted_at: new Date(ts * 1000).toISOString(),
    });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!SERVICE_KEY || token !== SERVICE_KEY) return json({ error: "Service role only" }, 403);

  const { data, error } = await admin.rpc("cx_autosub_due", { p_limit: 40 });
  if (error) return json({ error: error.message }, 500);
  const due = (data ?? []) as Due[];
  let submitted = 0, skipped = 0;
  const errors: string[] = [];
  for (const a of due) {
    let posts: Post[] = [];
    try {
      if (a.platform === "instagram") {
        if (!SC_KEY) { errors.push("SCRAPECREATORS_API_KEY is not set"); break; }
        posts = await instagramReels(a.handle);
      }
    } catch (e) {
      errors.push(`${a.handle}: ${e instanceof Error ? e.message : String(e)}`);
      continue;   // not marked synced: it is tried again next run
    }
    const { data: r, error: e } = await admin.rpc("cx_autosub_ingest", { p_account: a.account_id, p_posts: posts });
    if (e) { errors.push(`${a.handle}: ${e.message}`); continue; }
    submitted += Number(r?.submitted ?? 0);
    skipped += Number(r?.skipped ?? 0);
  }
  return json({ accounts: due.length, submitted, skipped, errors });
});
