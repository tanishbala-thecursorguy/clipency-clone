// message-emails
// Emails for chats: appeals (creator <-> client, supervised by Clipency),
// support requests, and new-appeal alerts to the Clipency team. Also deletes
// screenshots/images whose conversation is gone (settled appeals, group chat
// images older than 12 hours), because those chats promise "no backup".
//
//   POST { mode: "send" }   service role only (pg_cron cx_message_emails, every 5 min)
//
// Which emails go out is decided in SQL (037/039): one email per person per
// thread while unsent, merged when several messages arrive close together.
// This function renders, sends, and reports back (cx_message_email_mark).
//
// Provider: Resend, same key as client-review-emails (RESEND_API_KEY secret,
// or Vault resend_api_key through cx_email_provider_key). Without a key the
// queue simply waits.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FROM = Deno.env.get("MESSAGE_EMAIL_FROM") ?? Deno.env.get("EMAIL_FROM") ?? "Clipency <review@clipency.in>";
const SITE = (Deno.env.get("SITE_URL") ?? "https://www.clipency.in").replace(/\/+$/, "");
const BUCKET = "appeal-attachments";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

type Item = { id: number; to: string; subject: string; body: string; template: string; ref_id: string | null; messages: number };

// where the button goes: the team works in the console, everyone else signs in from the site
function link(t: string) {
  if (t === "support-request" || t === "appeal-new") return `${SITE}/console`;
  return `${SITE}/`;
}

function render(it: Item) {
  const more = it.messages > 1 ? `${it.messages} new messages. The latest:` : "New message:";
  const lead = it.template === "support-request" ? "A creator or client wrote to Clipency support."
    : it.template === "support-reply" ? "The Clipency team replied to your support request."
    : it.template === "appeal-new" ? "A creator opened an appeal on a rejected clip."
    : "There is a new message on a clip appeal.";
  const cta = it.template === "support-request" || it.template === "appeal-new" ? "Open the console" : "Open your dashboard";
  const html = `<!doctype html><html><body style="margin:0;background:#EEE9E1;font-family:Inter,Arial,sans-serif;color:#141210">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:14px;border:1px solid rgba(20,18,16,.1)">
<tr><td style="padding:26px 28px 6px;font-family:Georgia,serif;font-size:20px;letter-spacing:.02em">Clipency</td></tr>
<tr><td style="padding:6px 28px 0;font-size:14px;line-height:1.55;color:rgba(20,18,16,.72)">${esc(lead)}</td></tr>
<tr><td style="padding:16px 28px 0;font-size:12px;color:rgba(20,18,16,.5)">${esc(more)}</td></tr>
<tr><td style="padding:8px 28px 0"><div style="padding:14px 16px;background:#F6F3EE;border-left:3px solid #8C6A45;border-radius:8px;font-size:14px;line-height:1.55;white-space:pre-wrap">${esc(it.body)}</div></td></tr>
<tr><td style="padding:22px 28px 26px"><a href="${esc(link(it.template))}" style="display:inline-block;background:#141210;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:11px 18px;border-radius:9px">${cta}</a></td></tr>
</table>
<div style="max-width:520px;padding:14px 8px;font-size:11px;line-height:1.5;color:rgba(20,18,16,.45)">Reply from your dashboard, not to this email. Conversations are deleted once they are settled.</div>
</td></tr></table></body></html>`;
  const text = `${lead}\n\n${more}\n${it.body}\n\n${cta}: ${link(it.template)}\n\nReply from your dashboard, not to this email.`;
  return { subject: it.subject, html, text };
}

async function providerKey(): Promise<string> {
  const env = Deno.env.get("RESEND_API_KEY");
  if (env) return env;
  const { data } = await admin.rpc("cx_email_provider_key");
  return typeof data === "string" ? data : "";
}

async function sendOne(key: string, it: Item) {
  const m = render(it);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `cx-msg-${it.id}-${it.messages}` },
    body: JSON.stringify({ from: FROM, to: [it.to], subject: m.subject, html: m.html, text: m.text }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function cleanImages() {
  const { data, error } = await admin.rpc("cx_attachment_orphans", { p_limit: 500 });
  if (error || !Array.isArray(data) || !data.length) return { deleted: 0, error: error?.message };
  let deleted = 0;
  for (let i = 0; i < data.length; i += 100) {
    const { data: gone, error: e } = await admin.storage.from(BUCKET).remove(data.slice(i, i + 100));
    if (e) return { deleted, error: e.message };
    deleted += gone?.length ?? 0;
  }
  return { deleted };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!SERVICE_KEY || token !== SERVICE_KEY) return json({ error: "Service role only" }, 403);

  const images = await cleanImages();
  const key = await providerKey();
  if (!key) return json({ sent: 0, waiting: "no Resend key yet", images });

  const { data, error } = await admin.rpc("cx_message_email_batch", { p_limit: 50 });
  if (error) return json({ error: error.message, images }, 500);
  let sent = 0, failed = 0;
  for (const it of (data ?? []) as Item[]) {
    try {
      await sendOne(key, it);
      await admin.rpc("cx_message_email_mark", { p_id: it.id, p_ok: true });
      sent++;
    } catch (e) {
      await admin.rpc("cx_message_email_mark", { p_id: it.id, p_ok: false, p_error: e instanceof Error ? e.message : String(e) });
      failed++;
    }
  }
  return json({ sent, failed, images });
});
