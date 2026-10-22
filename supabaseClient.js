/* Public Supabase config for Clipency */
const SUPABASE_URL = "https://spwtkdgpgeutrhwcjrpy.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_IInNrDBLK3dINHSyWaUDzg_UWF63j0B";

window.CLIPENCY_SUPABASE_URL = SUPABASE_URL;
window.CLIPENCY_SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;

window.clipencySupabase = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

window.supabaseClient = window.clipencySupabase;
window.sbClient = window.clipencySupabase;


/* ===== CLIPENCY_SUPABASE_GLOBAL_EXPOSURE ===== */
(function(){
  if (window.CLIPENCY_SUPABASE_GLOBAL_EXPOSURE) return;
  window.CLIPENCY_SUPABASE_GLOBAL_EXPOSURE = true;

  try {
    var existing =
      window.clipencySupabase ||
      window.supabaseClient ||
      window.sbClient ||
      null;

    if (!existing || !existing.auth || !existing.rpc) {
      if (
        window.supabase &&
        typeof window.supabase.createClient === "function" &&
        typeof SUPABASE_URL !== "undefined" &&
        typeof SUPABASE_ANON_KEY !== "undefined"
      ) {
        existing = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      }
    }

    if (existing && existing.auth) {
      window.clipencySupabase = existing;
      window.supabaseClient = existing;
      window.sbClient = existing;
    }
  } catch (e) {
    console.warn("[Clipency] Supabase global exposure failed", e);
  }
})();
/* ===== CLIPENCY_LAUNCH_SUPABASE_BRIDGE ===== */
(function(){
  try{
    var c = window.clipencySupabase || window.supabaseClient || window.sbClient;
    if(!c && window.supabase && window.CLIPENCY_SUPABASE_URL && window.CLIPENCY_SUPABASE_ANON_KEY){
      c = window.supabase.createClient(window.CLIPENCY_SUPABASE_URL, window.CLIPENCY_SUPABASE_ANON_KEY);
    }
    if(c){ window.clipencySupabase = c; window.supabaseClient = c; window.sbClient = c; }
  }catch(e){ console.warn('[Clipency] Supabase bridge failed', e); }
})();
