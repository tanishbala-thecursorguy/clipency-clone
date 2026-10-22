(function () {
  if (window.__clipencyAuthUxGuardLoaded) return;
  window.__clipencyAuthUxGuardLoaded = true;

  const AUTH_FLAG = "clipency_auth_in_progress";
  const MAX_AUTH_WAIT = 12000;
  let loaderTimer = null;

  function path() {
    return window.location.pathname;
  }

  function isAuthPath() {
    return ["/login", "/signup", "/auth", "/index.html", "/"].includes(path());
  }

  function isWorkspacePath() {
    return [
      "/campaigns",
      "/stats",
      "/payouts",
      "/wallet",
      "/profile",
      "/admin",
      "/workspace"
    ].some((p) => path() === p || path().startsWith(p + "/"));
  }

  function ensureLoader() {
    let loader = document.getElementById("clipency-auth-loader");

    if (!loader) {
      loader = document.createElement("div");
      loader.id = "clipency-auth-loader";
      loader.innerHTML = `
        <div class="cx-auth-loader-card">
          <div class="cx-auth-loader-mark"></div>
          <span id="cx-auth-loader-kicker">WELCOME TO CLIPENCY</span>
          <h1 id="cx-auth-loader-title">Signing you in.</h1>
          <p id="cx-auth-loader-text">Preparing your workspace. Please hold on for a moment.</p>
        </div>
      `;
      document.body.appendChild(loader);
    }

    return loader;
  }

  function ensureToast() {
    let toast = document.getElementById("clipency-auth-toast");

    if (!toast) {
      toast = document.createElement("div");
      toast.id = "clipency-auth-toast";
      toast.innerHTML = `
        <strong id="cx-auth-toast-title">Already signed up</strong>
        <p id="cx-auth-toast-text">Kindly login with the same email to continue.</p>
        <button id="cx-auth-toast-login">Go to login</button>
      `;
      document.body.appendChild(toast);

      document.getElementById("cx-auth-toast-login")?.addEventListener("click", function () {
        toast.classList.remove("active");
        goLogin();
      });
    }

    return toast;
  }

  function showLoader(title, text, options = {}) {
    const loader = ensureLoader();

    document.getElementById("cx-auth-loader-title").textContent = title || "Signing you in.";
    document.getElementById("cx-auth-loader-text").textContent = text || "Preparing your workspace. Please hold on for a moment.";

    loader.classList.add("active");

    localStorage.setItem(AUTH_FLAG, JSON.stringify({
      title: title || "Signing you in.",
      text: text || "Preparing your workspace. Please hold on for a moment.",
      at: Date.now()
    }));

    clearTimeout(loaderTimer);

    if (!options.noTimeout) {
      loaderTimer = setTimeout(function () {
        if (isAuthPath()) {
          hideLoader();
          showToast(
            "Could not continue",
            "Please check your details and try again. If you already have an account, kindly login."
          );
        }
      }, MAX_AUTH_WAIT);
    }
  }

  function hideLoader() {
    clearTimeout(loaderTimer);
    loaderTimer = null;

    const loader = document.getElementById("clipency-auth-loader");
    if (loader) loader.classList.remove("active");

    localStorage.removeItem(AUTH_FLAG);
  }

  function showToast(title, text) {
    hideLoader();

    const toast = ensureToast();

    document.getElementById("cx-auth-toast-title").textContent = title;
    document.getElementById("cx-auth-toast-text").textContent = text;

    toast.classList.add("active");

    setTimeout(function () {
      toast.classList.remove("active");
    }, 8500);
  }

  function goLogin() {
    hideLoader();

    const tabs = Array.from(document.querySelectorAll("button, a, [role='button']"));
    const signInTab = tabs.find((el) => {
      const txt = (el.textContent || "").trim().toLowerCase();
      return txt === "sign in" || txt === "login" || txt === "log in";
    });

    if (signInTab) {
      setTimeout(() => signInTab.click(), 50);
      return;
    }

    if (path() !== "/login") {
      window.location.href = "/login";
    }
  }

  function isExistingSignup(result) {
    const message = String(result?.error?.message || "").toLowerCase();

    if (
      message.includes("already registered") ||
      message.includes("already exists") ||
      message.includes("user already") ||
      message.includes("duplicate") ||
      message.includes("user_exists")
    ) {
      return true;
    }

    const identities = result?.data?.user?.identities;

    if (Array.isArray(identities) && identities.length === 0) {
      return true;
    }

    return false;
  }

  function patchClient(client) {
    if (!client || !client.auth || client.__clipencyAuthUxPatched) return client;

    client.__clipencyAuthUxPatched = true;

    const originalSignUp = client.auth.signUp?.bind(client.auth);
    const originalSignInWithPassword = client.auth.signInWithPassword?.bind(client.auth);
    const originalSignInWithOAuth = client.auth.signInWithOAuth?.bind(client.auth);
    const originalSignOut = client.auth.signOut?.bind(client.auth);

    if (originalSignUp) {
      client.auth.signUp = async function () {
        showLoader("Creating your account.", "Welcome to Clipency. Setting up your creator workspace.");

        let result;

        try {
          result = await originalSignUp.apply(null, arguments);
        } catch (error) {
          hideLoader();
          showToast("Signup failed", error.message || "Please try again.");
          throw error;
        }

        if (isExistingSignup(result)) {
          showToast("Already signed up", "Kindly login with the same email to continue.");
          setTimeout(goLogin, 500);

          return {
            data: result.data || null,
            error: {
              message: "Already signed up. Kindly login."
            }
          };
        }

        if (result?.error) {
          hideLoader();
          showToast("Signup failed", result.error.message || "Please try again.");
          return result;
        }

        showLoader("Welcome to Clipency.", "Your account is ready. Opening your workspace.", { noTimeout: false });
        return result;
      };
    }

    if (originalSignInWithPassword) {
      client.auth.signInWithPassword = async function () {
        showLoader("Logging you in.", "Welcome to Clipency. Verifying your session.");

        let result;

        try {
          result = await originalSignInWithPassword.apply(null, arguments);
        } catch (error) {
          hideLoader();
          showToast("Login failed", error.message || "Please try again.");
          throw error;
        }

        if (result?.error) {
          hideLoader();
          showToast("Login failed", result.error.message || "Please check your email and password.");
          return result;
        }

        showLoader("Welcome to Clipency.", "Opening your workspace.", { noTimeout: false });
        return result;
      };
    }

    if (originalSignInWithOAuth) {
      client.auth.signInWithOAuth = async function () {
        showLoader("Redirecting securely.", "Welcome to Clipency. Taking you to Google login.", { noTimeout: true });

        let result;

        try {
          result = await originalSignInWithOAuth.apply(null, arguments);
        } catch (error) {
          hideLoader();
          showToast("Google login failed", error.message || "Please try again.");
          throw error;
        }

        if (result?.error) {
          hideLoader();
          showToast("Google login failed", result.error.message || "Please try again.");
        }

        return result;
      };
    }

    if (originalSignOut) {
      client.auth.signOut = async function () {
        showLoader("Signing you out.", "Closing your Clipency session.");

        const result = await originalSignOut.apply(null, arguments);

        hideLoader();
        return result;
      };
    }

    return client;
  }

  function patchCreateClient() {
    if (!window.supabase || !window.supabase.createClient || window.supabase.__clipencyCreateClientPatched) return;

    const originalCreateClient = window.supabase.createClient.bind(window.supabase);

    window.supabase.createClient = function () {
      const client = originalCreateClient.apply(null, arguments);
      return patchClient(client);
    };

    window.supabase.__clipencyCreateClientPatched = true;
  }

  function patchKnownClients() {
    patchCreateClient();

    if (window.supabaseClient) patchClient(window.supabaseClient);
    if (window.sb) patchClient(window.sb);
    if (window.client) patchClient(window.client);
  }

  function bindOnlyRealSubmitLoaders() {
    document.addEventListener("submit", function (event) {
      if (!isAuthPath()) return;

      const form = event.target;
      const text = (form.textContent || "").toLowerCase();

      const hasInvalidRequired = Array.from(form.querySelectorAll("input[required]")).some((input) => !input.value);

      if (hasInvalidRequired) {
        hideLoader();
        return;
      }

      if (text.includes("become a clipper") || text.includes("create account") || text.includes("sign up")) {
        showLoader("Creating your account.", "Welcome to Clipency. Setting up your creator workspace.");
      } else if (text.includes("login") || text.includes("log in") || text.includes("sign in")) {
        showLoader("Logging you in.", "Welcome to Clipency. Verifying your session.");
      }
    }, true);

    document.addEventListener("click", function (event) {
      if (!isAuthPath()) return;

      const target = event.target.closest("button, a, [role='button']");
      if (!target) return;

      const text = (target.textContent || "").trim().toLowerCase();

      // Do NOT show loader when switching tabs between create account/sign in.
      if (text === "create account" || text === "sign in") return;

      if (text.includes("continue with google") || text.includes("google")) {
        showLoader("Redirecting securely.", "Welcome to Clipency. Taking you to Google login.", { noTimeout: true });
      }
    }, true);
  }

  function handleWorkspaceFlash() {
    const raw = localStorage.getItem(AUTH_FLAG);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      const age = Date.now() - Number(parsed.at || 0);

      if (age > 15000) {
        hideLoader();
        return;
      }

      if (isWorkspacePath()) {
        showLoader("Welcome to Clipency.", "Opening your workspace.");
        setTimeout(hideLoader, 1200);
      }
    } catch {
      hideLoader();
    }
  }

  function bindSupabaseAuthState() {
    let attempts = 0;

    const timer = setInterval(function () {
      attempts++;
      patchKnownClients();

      const client = window.supabaseClient || window.sb || window.client;

      if (client?.auth?.onAuthStateChange && !client.__clipencyAuthStateBound) {
        client.__clipencyAuthStateBound = true;

        client.auth.onAuthStateChange(function (event) {
          if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
            if (isAuthPath()) {
              showLoader("Welcome to Clipency.", "Opening your workspace.");
            }
          }

          if (event === "SIGNED_OUT") {
            hideLoader();
          }
        });
      }

      if (attempts > 180) clearInterval(timer);
    }, 80);
  }

  function emergencyEscape() {
    window.addEventListener("keydown", function (event) {
      if (event.key === "Escape") hideLoader();
    });
  }

  function boot() {
    ensureLoader();
    ensureToast();
    patchKnownClients();
    bindOnlyRealSubmitLoaders();
    bindSupabaseAuthState();
    handleWorkspaceFlash();
    emergencyEscape();

    setInterval(patchKnownClients, 500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.addEventListener("clipency:supabase-ready", patchKnownClients);
})();
