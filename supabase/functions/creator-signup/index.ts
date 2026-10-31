// creator-signup
// Creates a creator (clipper) account that can sign in straight away: no
// confirmation email. The only check is that the email can really receive mail
// (well-formed, the domain has mail servers, not a throwaway inbox).
//
//   POST { email, password, first_name, last_name }   -> { ok: true } then the page signs in
//
// Also lets someone who signed up before this change, and never confirmed, in:
// an account that was never confirmed and never signed in is confirmed and given
// the password just typed.
//
// Never used for: emails with a pending staff/client invite, or accounts whose
// role is not 'clipper'. Those get { fallback: true } and the page uses the normal
// sign-up with a confirmation email, so nobody can claim an invited role unverified.

import { createClient } from "jsr:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

/* Throwaway inbox providers; sign-ups from these never become real creators. */
const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "10minutemail.com",
  "tempmail.com", "temp-mail.org", "yopmail.com", "trashmail.com", "getnada.com", "dispostable.com",
  "maildrop.cc", "mintemail.com", "throwawaymail.com", "fakeinbox.com", "mohmal.com", "emailondeck.com",
  "tempmail.dev", "tmpmail.org", "mail.tm", "hebase.com", "spamgourmet.com", "burnermail.io",
]);
/* Common slips, so we can suggest the right one instead of just saying no. */
const TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gamil.com": "gmail.com", "gmail.co": "gmail.com",
  "gmail.con": "gmail.com", "gnail.com": "gmail.com", "gmal.com": "gmail.com", "gmaill.com": "gmail.com",
  "yahoo.co": "yahoo.com", "yaho.com": "yahoo.com", "hotmial.com": "hotmail.com", "outlok.com": "outlook.com",
  "icloud.co": "icloud.com",
};

/* A few tries per address per instance, against scripted sign-up floods. */
const recent = new Map<string, number[]>();
function tooMany(key: string, max = 6, windowMs = 10 * 60_000): boolean {
  const now = Date.now(), hits = (recent.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.push(now);
  recent.set(key, hits);
  return hits.length > max;
}

async function domainTakesMail(domain: string): Promise<boolean> {
  try {
    const mx = await Deno.resolveDns(domain, "MX");
    return mx.some((r) => r.exchange && r.exchange !== ".");
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let b: { email?: string; password?: string; first_name?: string; last_name?: string } = {};
  try { b = await req.json(); } catch { /* empty */ }
  const email = String(b.email ?? "").trim().toLowerCase();
  const password = String(b.password ?? "");
  const first = String(b.first_name ?? "").trim().slice(0, 60);
  const last = String(b.last_name ?? "").trim().slice(0, 60);

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "?";
  if (tooMany("ip:" + ip, 12) || tooMany("em:" + email)) return json({ error: "Too many tries. Wait a few minutes and try again." }, 429);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) return json({ error: "That email address doesn't look right." }, 400);
  if (password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);

  const domain = email.split("@")[1];
  if (TYPOS[domain]) return json({ error: `Did you mean ${email.split("@")[0]}@${TYPOS[domain]}?` }, 400);
  if (DISPOSABLE.has(domain)) return json({ error: "Please use your real email, not a temporary inbox." }, 400);
  if (!(await domainTakesMail(domain))) return json({ error: `We couldn't find an email inbox at ${domain}. Check the address.` }, 400);

  const { data: info, error: le } = await admin.rpc("cx_signup_lookup", { p_email: email });
  if (le) return json({ error: "Couldn't create the account right now. Try again." }, 500);
  const u = (info ?? {}) as { user_id?: string; confirmed?: boolean; signed_in?: boolean; role?: string; invite?: string };

  /* invited staff/clients, and non-creator accounts: keep the confirmation email */
  if (u.invite || (u.user_id && u.role && u.role !== "clipper")) return json({ fallback: true });

  const meta: Record<string, string> = {};
  if (first) { meta.first_name = first; meta.last_name = last; meta.full_name = `${first} ${last}`.trim(); }

  if (!u.user_id) {
    if (!first) return json({ error: "Enter your first name." }, 400);
    const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: meta });
    if (error) {
      if (/already|exists|registered/i.test(error.message)) return json({ exists: true });
      return json({ error: error.message }, 400);
    }
    return json({ ok: true, created: true });
  }

  if (u.confirmed || u.signed_in) return json({ exists: true });

  /* signed up before, never confirmed, never used: let them in with this password */
  const { error } = await admin.auth.admin.updateUserById(u.user_id, {
    password, email_confirm: true, ...(first ? { user_metadata: meta } : {}),
  });
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true, confirmed: true });
});
