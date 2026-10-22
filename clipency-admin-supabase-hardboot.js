(function () {
  if (window.__clipencyAdminSupabaseHardbootLoaded) return;
  window.__clipencyAdminSupabaseHardbootLoaded = true;

  var SUPABASE_URL = "https://spwtkdgpgeutrhwcjrpy.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_IInNrDBLK3dINHSyWaUDzg_UWF63j0B";

  function createClientNow() {
    if (!window.supabase || !window.supabase.createClient) return false;

    window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });

    window.dispatchEvent(new CustomEvent("clipency:supabase-ready"));
    console.log("Clipency Admin Supabase client ready");
    return true;
  }

  if (createClientNow()) return;

  var script = document.createElement("script");
  script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
  script.async = false;

  script.onload = function () {
    if (!createClientNow()) {
      window.__clipencySupabaseBootError = new Error("Supabase library loaded but client could not be created.");
    }
  };

  script.onerror = function () {
    window.__clipencySupabaseBootError = new Error("Supabase CDN failed to load.");
  };

  document.head.appendChild(script);
})();
