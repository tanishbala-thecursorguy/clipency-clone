// inbound-email
// Receives replies to Clipency promotions (Resend "Receiving", event email.received),
// saves them for console > Promotions > Inbound, and forwards a copy to the real
// team mailbox in Gmail so nothing changes for whoever reads that inbox.
//
//   POST  (Resend webhook, Svix-signed)   email.received -> fetch content -> save -> forward
//
// Replies arrive at <mailbox>@reply.clipency.in (promo-emails sets that reply-to when
// REPLY_DOMAIN is set). jake@reply… -> jake@clipency.in, and so on; anything else
// goes to hello@clipency.in.
//
// Secrets: RESEND_WEBHOOK_SECRET (whsec_…, from the Resend webhook page) is required;
// without it every request is refused. Resend key: RESEND_API_KEY or Vault, as elsewhere.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET") ?? "";
const MAILBOXES = ["jake", "ayush", "tanish", "hello", "contact"];
const FORWARD_FROM = "replies@clipency.in";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function providerKey(): Promise<string> {
  const env = Deno.env.get("RESEND_API_KEY");
  if (env) return env;
  const { data } = await admin.rpc("cx_email_provider_key");
  return typeof data === "string" ? data : "";
}

/* Svix signature: base64(HMAC-SHA256(secret, `${id}.${timestamp}.${body}`)), header "v1,<sig> v1,<sig2>" */
async function verified(req: Request, body: string): Promise<boolean> {
  const id = req.headers.get("svix-id"), ts = req.headers.get("svix-timestamp"), sig = req.headers.get("svix-signature");
  if (!WEBHOOK_SECRET || !id || !ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const raw = Uint8Array.from(atob(WEBHOOK_SECRET.replace(/^whsec_/, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  const want = btoa(String.fromCharCode(...mac));
  return sig.split(" ").some((part) => {
    const v = part.split(",")[1] ?? "";
    if (v.length !== want.length) return false;
    let d = 0;
    for (let i = 0; i < v.length; i++) d |= v.charCodeAt(i) ^ want.charCodeAt(i);
    return d === 0;
  });
}

function parseAddr(s: string): { name: string; email: string } {
  const m = /^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/.exec(s || "");
  return m ? { name: m[1].trim(), email: m[2].trim().toLowerCase() } : { name: "", email: (s || "").trim().toLowerCase() };
}

function mailboxFor(to: string[]): { mailbox: string; to: string } {
  for (const t of to) {
    const a = parseAddr(t).email, local = a.split("@")[0];
    if (MAILBOXES.includes(local)) return { mailbox: `${local}@clipency.in`, to: a };
  }
  return { mailbox: "hello@clipency.in", to: parseAddr(to[0] ?? "").email };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const body = await req.text();
  if (!(await verified(req, body))) return json({ error: "Signature check failed." }, 401);

  let evt: { type?: string; data?: { email_id?: string } } = {};
  try { evt = JSON.parse(body); } catch { return json({ error: "Bad JSON" }, 400); }
  if (evt.type !== "email.received" || !evt.data?.email_id) return json({ ignored: evt.type ?? "unknown" });

  const key = await providerKey();
  if (!key) return json({ error: "No email provider configured." }, 409);

  const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(evt.data.email_id)}`, {
    headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return json({ error: `Resend ${res.status}` }, 502);
  const m = await res.json() as {
    id: string; from: string; to: string[] | string; subject?: string; html?: string | null; text?: string | null;
    authentication?: { spf?: string; dkim?: string; dmarc?: string };
  };

  const from = parseAddr(m.from);
  const { mailbox, to } = mailboxFor(Array.isArray(m.to) ? m.to : [m.to]);
  const subject = m.subject || "(no subject)";

  const { data: id, error } = await admin.rpc("inbound_save", { p: {
    resend_id: m.id, mailbox, to_address: to, from_email: from.email, from_name: from.name, subject,
    text_body: m.text ?? "", html: m.html ?? "",
    spf: m.authentication?.spf ?? null, dkim: m.authentication?.dkim ?? null, dmarc: m.authentication?.dmarc ?? null,
  } });
  if (error) return json({ error: error.message }, 500);
  if (!id) return json({ duplicate: m.id });   /* Resend retried; already saved and forwarded */

  /* forward a copy to the Gmail mailbox; replying there answers the creator directly */
  const who = from.name ? `${from.name} <${from.email}>` : from.email;
  const html = `<div style="font:13px Arial,sans-serif;color:#555;border-bottom:1px solid #ddd;padding-bottom:8px;margin-bottom:12px">` +
    `Reply from <b>${esc(who)}</b> to ${esc(to)} · saved in Clipency console &gt; Promotions &gt; Inbound</div>` +
    (m.html || `<pre style="font:14px/1.5 Arial,sans-serif;white-space:pre-wrap">${esc(m.text ?? "")}</pre>`);
  const fwd = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `cx-inbound-${m.id}` },
    body: JSON.stringify({
      from: `${(from.name || from.email).replace(/[<>"]/g, "")} via Clipency <${FORWARD_FROM}>`,
      to: [mailbox], reply_to: from.email, subject, html,
      text: `Reply from ${who} to ${to}\n\n${m.text ?? ""}`,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const fo = await fwd.json().catch(() => ({}));
  await admin.rpc("inbound_forwarded", { p_id: id, p_ok: fwd.ok, p_error: fwd.ok ? null : `Resend ${fwd.status}: ${JSON.stringify(fo).slice(0, 200)}` });
  return json({ saved: id, forwarded: fwd.ok });
});
