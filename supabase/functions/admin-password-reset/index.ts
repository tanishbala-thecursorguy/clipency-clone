// admin-password-reset
// "Forgot password?" on the admin sign-in page. A reset email goes out ONLY when the
// address belongs to someone in admin_users. The answer is the same either way, so
// the page can't be used to find out who the admins are.
//
//   POST { email, origin }   public (the admin sign-in page calls it, signed out)
//
// A reset never grants admin access by itself: the console checks admin_users
// (cx_is_admin) after every sign-in. This only stops reset emails being sent from the
// admin page for accounts that aren't staff.
// The link lands on /reset-password on the site that asked, if that site is ours.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SITES = ["https://clipency-site.vercel.app", "https://www.clipency.in", "https://clipency.in", "http://localhost:9000", "http://localhost:5173"];

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SAME = { ok: true, message: "If that email belongs to a Clipency admin, a reset link is on its way." };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: { email?: string; origin?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return json({ ok: false, message: "Enter a valid email address." }, 400);
  const site = SITES.includes(String(body.origin ?? "")) ? String(body.origin) : SITES[0];
  const started = Date.now();

  // staff = a row in admin_users for this email (by its email, or by the account's user id)
  const { data: rows } = await admin.from("admin_users").select("user_id, email");
  let isAdmin = (rows ?? []).some((r) => String(r.email ?? "").toLowerCase() === email);
  if (!isAdmin) {
    const ids = (rows ?? []).map((r) => r.user_id).filter(Boolean);
    for (const id of ids) {
      const { data } = await admin.auth.admin.getUserById(id);
      if (String(data?.user?.email ?? "").toLowerCase() === email) { isAdmin = true; break; }
    }
  }
  if (isAdmin) {
    // sent through the normal auth mailer, so Supabase's own rate limits and template apply
    await anon.auth.resetPasswordForEmail(email, { redirectTo: `${site}/reset-password?for=admin` });
  }
  // answer in the same time either way, so timing doesn't give admins away
  const wait = 1500 - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  return json(SAME);
});
