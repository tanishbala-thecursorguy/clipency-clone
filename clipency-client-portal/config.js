/* ============================================================
   CLIPENCY CLIENT PORTAL — configuration
   ------------------------------------------------------------
   Almost nothing lives here any more, and that is the point.

   This file used to carry the campaign id, the budget and the
   rate, because the portal read the database with the anon key
   and no user session. With no signed-in user the `campaigns`
   table returns [] — RLS grants it to `authenticated` only — so
   the portal could not discover which campaign it was showing,
   and the money had to be typed in by hand. One deployment could
   therefore serve exactly one client.

   That is fixed. The portal now uses the client's own signed-in
   session and calls client_dashboard_data(), which returns the
   campaigns and clips belonging to auth.uid(). Campaign, budget
   and rate all come from the database. Nothing client-specific
   is written here, so one deployment serves every client.
   ============================================================ */

window.CLIPENCY_CONFIG = {

  /* ---- which Supabase project to read ---------------------- */
  /* The publishable key is public by design. It grants nothing on
     its own — every read is filtered by RLS and, for the dashboard,
     by the signed-in client's auth.uid(). */
  SUPABASE_URL:      "https://spwtkdgpgeutrhwcjrpy.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_IInNrDBLK3dINHSyWaUDzg_UWF63j0B",

  /* ---- where to send a visitor with no session ------------- */
  SIGNIN_URL: "./client-signin.html",

  /* ---- safety rails ---------------------------------------- */
  /* Blocks insert/update/upsert/delete at the client wrapper. The
     client portal is a reporting surface and has no reason to
     write. Reads through rpc() are allowed: client_dashboard_data()
     is an RPC, and blocking it outright is what forced the
     hardcoded campaign above. */
  READ_ONLY: true,

  /* Seconds to reuse a fetched payload within one tab. The portal
     is nine separate documents, so without this every click re-runs
     the query before anything can paint. Clips change on a human
     timescale; 90s is invisible to a client and removes the round
     trip. sessionStorage, so it dies with the tab. */
  CACHE_TTL_SECONDS: 90,

  /* Small mode bar at the bottom of the page. */
  SHOW_MODE_BANNER: true
};
