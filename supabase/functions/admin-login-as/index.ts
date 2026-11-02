// admin-login-as
// Console > Creators / Clients > "Log in": opens that person's dashboard in a new tab.
//
//   POST { user_id, as: "creator" | "client" }   admins only (cx_is_admin)
//   -> { url }   /client/clipper or /client/home with a one-time sign-in token in the #hash
//
// The token comes from auth.admin.generateLink (nothing is emailed), works once and
// expires within the hour. Other admins can't be opened this way. Every use is
// recorded in admin_impersonations (059). The dashboards keep this session in the
// tab's sessionStorage only and sign out locally, so neither the admin's login nor
// the person's own devices are affected.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SITES = ["https://www.clipency.in", "https://clipency.in", "https://clipency-site.vercel.app"];
const PATHS = { creator: "/client/clipper", client: "/client/home" } as const;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Admins only." }, 403);
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const [{ data: isAdmin }, { data: me }] = await Promise.all([asCaller.rpc("cx_is_admin"), asCaller.auth.getUser(token)]);
  if (isAdmin !== true || !me?.user) return json({ error: "Admins only." }, 403);

  let b: { user_id?: string; as?: string } = {};
  try { b = await req.json(); } catch { /* empty */ }
  const as = b.as === "client" ? "client" : "creator";
  const uid = String(b.user_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(uid)) return json({ error: "Missing user." }, 400);

  const { data: target, error: te } = await admin.auth.admin.getUserById(uid);
  if (te || !target?.user?.email) return json({ error: "That account has no email to sign in with." }, 404);
  const { data: isTargetAdmin } = await admin.from("admin_users").select("user_id").eq("user_id", uid).limit(1);
  if ((isTargetAdmin ?? []).length) return json({ error: "Admin accounts can't be opened this way." }, 403);

  const { data: link, error: le } = await admin.auth.admin.generateLink({ type: "magiclink", email: target.user.email });
  const hashed = link?.properties?.hashed_token;
  if (le || !hashed) return json({ error: `Couldn't make a sign-in link: ${le?.message ?? "no token"}` }, 500);

  await admin.from("admin_impersonations").insert({
    admin_id: me.user.id, admin_email: me.user.email, target_id: uid, target_email: target.user.email, dashboard: as,
  });

  const origin = req.headers.get("Origin") ?? "";
  const site = SITES.includes(origin) ? origin : SITES[0];
  return json({ url: `${site}${PATHS[as]}#imp=${encodeURIComponent(hashed)}`, email: target.user.email });
});
