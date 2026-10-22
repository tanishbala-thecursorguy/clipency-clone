// admin-password-reset  (serves every "Forgot password?" on the site)
// Sends Clipency's own reset email with a link that opens /reset-password directly.
// It does not use Supabase's reset template or its redirect allow-list, so a broken
// template can't break resets.
//
//   POST { email, origin, for: "admin" | "client" | "creator" }   public (signed out)
//
// for = "admin": an email goes out ONLY when the address is in admin_users.
// for = "client" / "creator": an email goes out when the account exists.
// The answer is always the same and takes the same time, so the form can't be used to
// find out who has an account or who the admins are.
// A reset never grants admin access by itself: the console checks admin_users
// (cx_is_admin) after every sign-in.
//
// Email: Resend, same key and sender as client-review-emails.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FROM = Deno.env.get("EMAIL_FROM") ?? "Clipency <review@clipency.in>";
const SITES = ["https://clipency-site.vercel.app", "https://www.clipency.in", "https://clipency.in", "http://localhost:9000", "http://localhost:5173"];
const LOGO = "https://kszlfvsplkkmsgxqnakj.supabase.co/storage/v1/object/public/assets/clipency-logo-chip.png";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function isAdminEmail(email: string) {
  const { data: rows } = await admin.from("admin_users").select("user_id, email");
  if ((rows ?? []).some((r) => String(r.email ?? "").toLowerCase() === email)) return true;
  for (const r of rows ?? []) {
    if (!r.user_id) continue;
    const { data } = await admin.auth.admin.getUserById(r.user_id);
    if (String(data?.user?.email ?? "").toLowerCase() === email) return true;
  }
  return false;
}

async function resendKey(): Promise<string> {
  const env = Deno.env.get("RESEND_API_KEY");
  if (env) return env;
  const { data } = await admin.rpc("cx_email_provider_key");
  return typeof data === "string" ? data : "";
}

function render(link: string, email: string, who: string) {
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f6f3ec;font-family:Inter,Helvetica,Arial,sans-serif;color:#14120e;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f3ec;"><tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#faf9f6;border:1px solid #e6dfd2;border-radius:18px;overflow:hidden;">
<tr><td style="height:3px;background:#c8a170;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td align="center" style="padding:32px 32px 8px;"><img src="${LOGO}" width="132" alt="Clipency" style="display:block;border:0;height:auto;"></td></tr>
<tr><td align="center" style="padding:20px 36px 0;"><div style="font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.2;color:#14120e;">Reset your password</div></td></tr>
<tr><td align="center" style="padding:14px 40px 0;font-size:14.5px;line-height:1.65;color:#5b554c;">We got a request to reset the ${esc(who)} password for <b style="color:#14120e;">${esc(email)}</b>. Click the button to choose a new one. The link works once and expires in <b style="color:#8a6224;">1 hour</b>.</td></tr>
<tr><td align="center" style="padding:28px 32px 8px;"><a href="${esc(link)}" style="display:inline-block;background:#14120e;color:#f3efe7;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:.02em;padding:14px 30px;border-radius:999px;">Set a new password</a></td></tr>
<tr><td align="center" style="padding:14px 40px 0;font-size:11.5px;line-height:1.6;color:#8a8378;">Button not working? Copy this link into your browser:<br><a href="${esc(link)}" style="color:#8a6224;word-break:break-all;">${esc(link)}</a></td></tr>
<tr><td style="padding:26px 36px 0;"><div style="height:1px;background:#ebe4d7;"></div></td></tr>
<tr><td align="center" style="padding:18px 40px 30px;font-size:12px;line-height:1.6;color:#8a8378;">Didn’t ask for this? Ignore this email and your password stays the same. Clipency will never ask for your password by email or chat.<br>Questions: <a href="mailto:hello@clipency.in" style="color:#8a6224;text-decoration:none;">hello@clipency.in</a></td></tr>
</table><div style="padding:16px 8px 0;font-size:11px;color:#a39b8e;">© 2026 Clipency</div></td></tr></table></body></html>`;
  const text = `Reset your Clipency password\n\nWe got a request to reset the ${who} password for ${email}.\nSet a new password (works once, expires in 1 hour):\n${link}\n\nDidn't ask for this? Ignore this email and your password stays the same.`;
  return { html, text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: { email?: string; origin?: string; for?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return json({ ok: false, message: "Enter a valid email address." }, 400);
  const kind = ["admin", "client", "creator"].includes(String(body.for)) ? String(body.for) : "admin";
  const site = SITES.includes(String(body.origin ?? "")) ? String(body.origin) : SITES[0];
  const same = { ok: true, message: kind === "admin" ? "If that email belongs to a Clipency admin, a reset link is on its way."
                                                     : "If that email has an account, a reset link is on its way." };
  const started = Date.now();

  try {
    if (kind !== "admin" || await isAdminEmail(email)) {
      // a one-time recovery token for this account (fails quietly when there is no account)
      const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
      const hash = data?.properties?.hashed_token;
      if (!error && hash) {
        const link = `${site}/reset-password?for=${kind}&token_hash=${encodeURIComponent(hash)}`;
        const key = await resendKey();
        if (key) {
          const m = render(link, email, kind === "admin" ? "admin" : "Clipency");
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json",
                       "Idempotency-Key": `cx-reset-${email}-${Math.floor(Date.now() / 60000)}` },   // one email per address per minute
            body: JSON.stringify({ from: FROM, to: [email], subject: "Reset your Clipency password", html: m.html, text: m.text }),
            signal: AbortSignal.timeout(15_000),
          });
          if (!res.ok) console.error("resend", res.status, (await res.text()).slice(0, 200));
        } else {
          console.error("no Resend key: reset email not sent");
        }
      }
    }
  } catch (e) {
    console.error("reset failed", e instanceof Error ? e.message : String(e));
  }

  // same answer, same time, whoever asked
  const wait = 2000 - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  return json(same);
});
