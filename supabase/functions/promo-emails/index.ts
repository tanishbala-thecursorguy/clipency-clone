// promo-emails
// Sends approved Promotions emails (console > Promotions) and handles unsubscribes.
//
//   POST { mode: "send" }            service role only (pg_cron via promo_kick, every 2 min)
//   POST { mode: "test", id, to }    Clipency staff only: one preview of promo `id` to `to`
//   GET/POST ?u=<token>              public unsubscribe link (and one-click List-Unsubscribe)
//
// Who gets what is decided in SQL (promo_approve / promo_queue / promo_batch):
// only approved promos, only queued recipients, never an unsubscribed address,
// never twice. This function renders {first_name}, adds the unsubscribe footer
// and headers, sends through Resend's batch API, and reports each result back
// (promo_mark). The From address rotates across the team mailboxes per
// recipient (promo_senders); replies go to that same mailbox.
//
// Provider key: RESEND_API_KEY secret, or Vault via cx_email_provider_key,
// the same as client-review-emails.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SELF = `${SUPABASE_URL}/functions/v1/promo-emails`;
/* Set to reply.clipency.in once Resend receiving is verified there: replies then go
   through inbound-email (saved for console > Inbound, forwarded to Gmail). Unset,
   replies go straight to the team mailbox as before. */
const REPLY_DOMAIN = (Deno.env.get("REPLY_DOMAIN") ?? "").trim();
const NAMES: Record<string, string> = {
  "jake@clipency.in": "Jake from Clipency",
  "ayush@clipency.in": "Ayush from Clipency",
  "tanish@clipency.in": "Tanish from Clipency",
  "hello@clipency.in": "Clipency",
  "contact@clipency.in": "Clipency",
};

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function providerKey(): Promise<string> {
  const env = Deno.env.get("RESEND_API_KEY");
  if (env) return env;
  const { data } = await admin.rpc("cx_email_provider_key");
  return typeof data === "string" ? data : "";
}

type Row = { id: number; email: string; first_name: string | null; from_email: string; token: string; subject: string; html: string; text_body: string };

function build(r: Row) {
  const name = (r.first_name || "").trim();
  const hi = name ? name.charAt(0).toUpperCase() + name.slice(1) : "there";
  const unsub = `${SELF}?u=${r.token}`;
  const html = r.html.replaceAll("{first_name}", esc(hi)) +
    `<p style="margin:28px 0 0;font:12px/1.5 Arial,sans-serif;color:#8a8278">You're getting this because you have a Clipency account. ` +
    `<a href="${unsub}" style="color:#8a8278">Unsubscribe</a></p>`;
  const text = r.text_body.replaceAll("{first_name}", hi) +
    `\n\n--\nYou're getting this because you have a Clipency account. Unsubscribe: ${unsub}\n`;
  return {
    from: `${NAMES[r.from_email] ?? "Clipency"} <${r.from_email}>`,
    to: [r.email],
    reply_to: REPLY_DOMAIN ? r.from_email.replace(/@.*$/, "@" + REPLY_DOMAIN) : r.from_email,
    subject: r.subject,
    html, text,
    headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}

async function isStaff(token: string): Promise<boolean> {
  if (!token) return false;
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await asCaller.rpc("cx_is_staff");
  return !error && data === true;
}

function page(title: string, msg: string, status = 200) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>` +
    `<body style="margin:0;background:#f4f0e8;font:16px/1.6 Arial,sans-serif;color:#1b1a18;display:grid;place-items:center;min-height:100vh">` +
    `<div style="max-width:420px;padding:32px;text-align:center"><h1 style="font:600 22px Georgia,serif">${esc(title)}</h1><p>${esc(msg)}</p>` +
    `<p><a href="https://www.clipency.in" style="color:#8a6a46">clipency.in</a></p></div>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);

  /* unsubscribe: the footer link (GET) and Gmail's one-click (POST) */
  const u = url.searchParams.get("u");
  if (u) {
    if (!/^[0-9a-f-]{36}$/i.test(u)) return page("Link not recognised", "This unsubscribe link is not valid.", 400);
    const { data, error } = await admin.rpc("promo_unsubscribe", { p_token: u });
    if (error || !data) return page("Link not recognised", "This unsubscribe link is not valid.", 400);
    return page("You're unsubscribed", `${data} won't get Clipency newsletters or announcements again. Account emails (like clip approvals) still arrive.`);
  }

  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const isService = !!SERVICE_KEY && token === SERVICE_KEY;
  let body: { mode?: string; id?: number; to?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const key = await providerKey();
  if (!key) return json({ error: "No email provider configured." }, 409);

  if (body.mode === "test") {
    if (!isService && !(await isStaff(token))) return json({ error: "Staff only." }, 403);
    const to = String(body.to || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json({ error: "Give a valid 'to' address." }, 400);
    const { data: p, error } = await admin.from("promo_emails").select("subject,html,text_body").eq("id", body.id).single();
    if (error || !p) return json({ error: "Promo not found." }, 404);
    const m = build({ id: 0, email: to, first_name: null, from_email: "jake@clipency.in", token: "00000000-0000-0000-0000-000000000000", ...p, subject: "[Test] " + p.subject });
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(m), signal: AbortSignal.timeout(20_000),
    });
    const out = await res.json().catch(() => ({}));
    return json(res.ok ? { sent: true, id: (out as { id?: string }).id } : { error: `Resend ${res.status}: ${JSON.stringify(out).slice(0, 300)}` }, res.ok ? 200 : 502);
  }

  if (!isService) return json({ error: "Sending runs on the schedule only." }, 403);

  const { data, error } = await admin.rpc("promo_batch", { p_limit: 90 });
  if (error) return json({ error: error.message }, 500);
  const rows = (data ?? []) as Row[];
  if (!rows.length) return json({ mode: "send", queued: 0 });

  const res = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `cx-promo-${rows[0].id}-${rows.length}` },
    body: JSON.stringify(rows.map(build)),
    signal: AbortSignal.timeout(45_000),
  });
  const out = await res.json().catch(() => ({})) as { data?: { id: string }[] };
  /* rate limited: leave everything queued for the next kick */
  if (res.status === 429) return json({ mode: "send", deferred: rows.length, reason: "rate limited" });
  if (!res.ok) {
    const msg = `Resend ${res.status}: ${JSON.stringify(out).slice(0, 300)}`;
    for (const r of rows) await admin.rpc("promo_mark", { p_id: r.id, p_ok: false, p_provider_id: null, p_error: msg });
    return json({ mode: "send", failed: rows.length, error: msg }, 502);
  }
  const ids = out.data ?? [];
  for (let i = 0; i < rows.length; i++) {
    await admin.rpc("promo_mark", { p_id: rows[i].id, p_ok: true, p_provider_id: ids[i]?.id ?? null, p_error: null });
  }
  return json({ mode: "send", sent: rows.length });
});
