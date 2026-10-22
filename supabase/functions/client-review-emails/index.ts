// client-review-emails
// Every Clipency transactional email: clients (clips waiting at every 10,
// the 6-hour auto-approval reminder, the Monday report) and creators (clip
// approved, clip rejected with a 24-hour redo countdown, approved into a
// private campaign).
//
//   POST { mode: "send" }                     service role only (pg_cron, every 10 min)
//   POST { mode: "test", to, kinds? }         Clipency staff only: sample emails
//
// Which emails go out is decided in SQL (cx_client_email_batch): the every-10
// milestones, the reminder, the weekly schedule, each client's own settings,
// creator events from email_outbox, and "never twice about the same thing".
// This function only renders and sends, then reports each result back
// (cx_client_email_mark).
//
// Provider: Resend. The key is read from the RESEND_API_KEY secret, or from
// Vault (name resend_api_key). With neither, nothing is queued or sent.
// Content: creator handle, platform, post link and the deadline. Never a
// rate, payout, fee or pool.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { KINDS, type Payload, render, samples } from "./templates.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const FROM = Deno.env.get("EMAIL_FROM") ?? "Clipency <review@clipency.in>";
const REPLY_TO = Deno.env.get("EMAIL_REPLY_TO") ?? "";
const PORTAL = (Deno.env.get("PORTAL_URL") ?? "https://www.clipency.in/client").replace(/\/+$/, "");

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

/* ---------------- rendering: see templates.ts ---------------- */

export { esc, fmtWhen, render } from "./templates.ts";

const CTX = {
  portal: PORTAL,
  clipper: `${PORTAL}/clipper.html`,
  countdown: `${SUPABASE_URL}/functions/v1/email-countdown`,
};

/* ---------------- sending ---------------- */

async function providerKey(): Promise<string> {
  const env = Deno.env.get("RESEND_API_KEY");
  if (env) return env;
  const { data } = await admin.rpc("cx_email_provider_key");
  return typeof data === "string" ? data : "";
}

async function sendOne(key: string, id: number | string, to: string, m: { subject: string; html: string; text: string }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `cx-client-email-${id}`,
    },
    body: JSON.stringify({
      from: FROM, to: [to], subject: m.subject, html: m.html, text: m.text,
      ...(REPLY_TO ? { reply_to: REPLY_TO } : {}),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return String((body as { id?: string }).id ?? "");
}

async function isStaff(token: string): Promise<{ ok: boolean; uid: string | null }> {
  if (!token) return { ok: false, uid: null };
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const [{ data: staff, error }, { data: u }] = await Promise.all([asCaller.rpc("cx_is_staff"), asCaller.auth.getUser(token)]);
  return { ok: !error && staff === true, uid: u?.user?.id ?? null };
}

if (import.meta.main) Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const isService = !!SERVICE_KEY && token === SERVICE_KEY;
  let body: { mode?: string; to?: string; kinds?: unknown[] } = {};
  try { body = await req.json(); } catch { /* empty body */ }

  const key = await providerKey();

  if (body.mode === "test") {
    const who = isService ? { ok: true, uid: null } : await isStaff(token);
    if (!who.ok) return json({ error: "Test emails are for Clipency staff." }, 403);
    const to = String(body.to || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json({ error: "Give a valid 'to' address." }, 400);
    if (!key) return json({ error: "No email provider yet: add the Resend API key first." }, 409);
    const want = (Array.isArray(body.kinds) && body.kinds.length ? body.kinds : [...KINDS])
      .filter((k): k is string => (KINDS as readonly string[]).includes(String(k)));
    if (!want.length) return json({ error: `kinds must be from: ${KINDS.join(", ")}` }, 400);
    const S = samples();
    const out: { kind: string; ok: boolean; id?: string; error?: string }[] = [];
    for (const k of want) {
      const m = render(k, S[k], CTX);
      try { out.push({ kind: k, ok: true, id: await sendOne(key, `test-${k}-${Date.now()}`, to, { ...m, subject: "[Test] " + m.subject }) }); }
      catch (e) { out.push({ kind: k, ok: false, error: (e as Error).message }); }
    }
    return json({ sent: out.filter((r) => r.ok).length, results: out }, out.some((r) => r.ok) ? 200 : 502);
  }

  if (!isService) return json({ error: "Sending runs on the schedule only." }, 403);
  if (!key) return json({ mode: "send", skipped: "no email provider configured" });

  const { data: batch, error } = await admin.rpc("cx_client_email_batch");
  if (error) return json({ error: error.message }, 500);
  const items = (batch ?? []) as { id: number; kind: string; to: string; payload: Payload }[];
  const results: { id: number; ok: boolean; error?: string }[] = [];
  for (const it of items) {
    let m: { subject: string; html: string; text: string };
    try { m = render(it.kind, it.payload || {}, CTX); }
    catch (e) {
      const msg = (e as Error).message;
      await admin.rpc("cx_client_email_mark", { p_id: it.id, p_ok: false, p_subject: null, p_provider_id: null, p_error: msg });
      results.push({ id: it.id, ok: false, error: msg });
      continue;
    }
    try {
      const pid = await sendOne(key, it.id, it.to, m);
      await admin.rpc("cx_client_email_mark", { p_id: it.id, p_ok: true, p_subject: m.subject, p_provider_id: pid, p_error: null });
      results.push({ id: it.id, ok: true });
    } catch (e) {
      const msg = (e as Error).message;
      await admin.rpc("cx_client_email_mark", { p_id: it.id, p_ok: false, p_subject: m.subject, p_provider_id: null, p_error: msg });
      results.push({ id: it.id, ok: false, error: msg });
    }
  }
  return json({ mode: "send", queued: items.length, sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) });
});
