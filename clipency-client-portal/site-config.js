/* ============================================================
   CLIPENCY — main landing page configuration
   ------------------------------------------------------------
   This is the only file you edit for the PUBLIC landing page
   (index.html). The client portal has its own config.js.

   index.html is 426KB of inline SVG/WebP artwork — do not edit
   it by hand for these values. Change them here.
   ============================================================ */

window.CLIPENCY_SITE = {

  /* ---- where the hero / nav buttons go --------------------- */

  /* "Start Clipping" + nav "Log In" -> the clipper sign-in.
     NOT "/login" — on this deployment that path is the CLIENT
     access-code page, so sending clippers there was a dead end.
     index.html rewrites its [data-go="clipper"] hrefs from this
     value at runtime, which is why changing it here is enough. */
  CLIPPER_LOGIN_URL: "/clipper-signin",

  /* Where a clipper lands after a successful sign-in on /login.
     ------------------------------------------------------------
     Now points at clipper.html, which is served from THIS project.
     That is deliberate: the old note here warned that sending a
     clipper to clipency.in would drop the session, because
     localStorage does not cross origins. Hosting the dashboard on
     the same host as the login sidesteps that entirely, so the
     Supabase session carries and the dashboard boots on live data
     rather than falling back to demo. */
  CLIPPER_DASHBOARD_URL: "/clipper",

  /* "Client Dashboard" -> the client-facing portal that lives in
     this same Vercel project. Relative on purpose, so it keeps
     working on preview deploys and on a custom domain alike. */
  CLIENT_PORTAL_URL: "/client-signin",

  /* Where a signed-in CLIENT lands, and where a client password-reset
     link returns them. This is the portal home — Home, Clips, Campaign,
     Budget, Analytics, Billing, Creators, Profile — served from
     home.html (cleanUrls turns that into /home).

     It exists because client-signin.html was redirecting to
     CLIPPER_DASHBOARD_URL, so signing in as a client dropped you on the
     clipper dashboard. Keep these two separate: they are different
     people looking at different data. */
  CLIENT_DASHBOARD_URL: "/home",

  /* ---- lead form -> existing database ---------------------- */
  /* The form posts to the EXISTING SECURITY DEFINER function
     public.submit_landing_lead(jsonb), which inserts into the
     EXISTING public.leads table. `anon` already has EXECUTE on it
     (verified 30 Jul 2026), and the admin dashboard already reads
     that table. No new table, no migration.

     Payload keys sent, matching the 28 rows already in there:
       full_name, email, phone, company, brand_name,
       campaign_type, budget, message, source_page

     Anon key is public by design — it is already on every page of
     clipency.in. It only ever gets the access RLS allows. */
  SUPABASE_URL:      "https://spwtkdgpgeutrhwcjrpy.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_IInNrDBLK3dINHSyWaUDzg_UWF63j0B"
};
