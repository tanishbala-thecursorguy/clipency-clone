// admin-create-creator
// Console > Creators > "Add creator": an admin makes a creator (clipper) account
// by hand. The account is confirmed straight away (no email is sent) and can sign
// in at /client/clipper-signin with the password the admin typed.
//
//   POST { email, password, first_name, last_name? }   admins only (cx_is_admin)
//
// Refused when the email already has an account or a pending staff/client invite,
// so this can never overwrite someone's login or hand out an invited role.
// Role comes from handle_new_user, which gives 'clipper' when there is no invite.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

/** cx_is_admin() reads auth.uid() from the JWT, so it must run as the caller. */
async function isAdmin(token: string): Promise<boolean> {
  if (!token) return false;
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await asCaller.rpc("cx_is_admin");
  return !error && data === true;
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

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!(await isAdmin(token))) return json({ error: "Admins only." }, 403);

  let b: { email?: string; password?: string; first_name?: string; last_name?: string } = {};
  try { b = await req.json(); } catch { /* empty */ }
  const email = String(b.email ?? "").trim().toLowerCase();
  const password = String(b.password ?? "");
  const first = String(b.first_name ?? "").trim().slice(0, 60);
  const last = String(b.last_name ?? "").trim().slice(0, 60);

  if (!first) return json({ error: "Enter a first name." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) return json({ error: "That email address doesn't look right." }, 400);
  if (password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);
  const domain = email.split("@")[1];
  if (!(await domainTakesMail(domain))) return json({ error: `No email inbox exists at ${domain}. Check the address.` }, 400);

  const { data: info, error: le } = await admin.rpc("cx_signup_lookup", { p_email: email });
  if (le) return json({ error: "Couldn't check the email right now. Try again." }, 500);
  const u = (info ?? {}) as { user_id?: string; invite?: string };
  if (u.user_id) return json({ error: "This email already has a Clipency account. Search for it in the list instead." }, 409);
  if (u.invite) return json({ error: `This email has a pending ${u.invite} invite, so it can't be added as a creator.` }, 409);

  const full = `${first} ${last}`.trim();
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { first_name: first, last_name: last, full_name: full },
  });
  if (error) {
    if (/already|exists|registered/i.test(error.message)) return json({ error: "This email already has a Clipency account." }, 409);
    return json({ error: error.message }, 400);
  }
  return json({ ok: true, user_id: created.user?.id ?? null, email, name: full });
});
