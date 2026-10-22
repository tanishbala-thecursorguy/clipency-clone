/* =========================================================
   CLIPENCY CORE UX
   Single lightweight runtime layer
   ========================================================= */

(function () {
  const CX = {
    profile: null,
    user: null,
    initialized: false
  };

  const routeMap = {
    "/dashboard": "dashboard",
    "/campaigns": "campaigns",
    "/stats": "stats",
    "/payouts": "payout",
    "/wallet": "payment",
    "/profile": "profile"
  };

  function currentRoute() {
    const path = window.location.pathname.toLowerCase();
    const queryPage = new URLSearchParams(window.location.search).get("page");
    return routeMap[path] || queryPage || "dashboard";
  }

  function routePath(page) {
    return {
      dashboard: "/dashboard",
      campaigns: "/campaigns",
      stats: "/stats",
      payout: "/payouts",
      payouts: "/payouts",
      payment: "/wallet",
      wallet: "/wallet",
      profile: "/profile"
    }[page] || "/dashboard";
  }

  function setRouteClass() {
    const route = currentRoute();

    document.body.classList.remove(
      "cx-route-dashboard",
      "cx-route-campaigns",
      "cx-route-stats",
      "cx-route-payout",
      "cx-route-payment",
      "cx-route-profile"
    );

    document.body.classList.add(`cx-route-${route}`);
  }

  async function getSessionUser() {
    if (!window.supabaseClient) return null;

    try {
      const { data } = await window.supabaseClient.auth.getSession();
      return data?.session?.user || window._authUser || null;
    } catch {
      return window._authUser || null;
    }
  }

  async function getIdentity(force = false) {
    if (CX.user && CX.profile && !force) return CX;

    const user = await getSessionUser();
    CX.user = user;

    if (!user || !window.supabaseClient) {
      CX.profile = null;
      return CX;
    }

    try {
      const { data } = await window.supabaseClient
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      CX.profile = data || null;
    } catch {
      CX.profile = null;
    }

    return CX;
  }

  function displayName(profile, user) {
    const meta = user?.user_metadata || {};
    const fromParts = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();

    return (
      profile?.full_name ||
      fromParts ||
      meta.full_name ||
      meta.name ||
      [meta.first_name, meta.last_name].filter(Boolean).join(" ").trim() ||
      user?.email?.split("@")[0] ||
      "Creator"
    );
  }

  function username(profile, user) {
    return profile?.username || user?.email?.split("@")[0] || "creator";
  }

  function avatar(profile, name) {
    if (profile?.avatar_url) {
      return `<img src="${profile.avatar_url}" alt="${name}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">`;
    }

    return (name || "C").trim().charAt(0).toUpperCase();
  }

  async function applyIdentity() {
    const { user, profile } = await getIdentity();
    if (!user) return;

    const name = displayName(profile, user);
    const handle = username(profile, user);
    const emailPrefix = user.email?.split("@")[0];

    const possibleTexts = new Set([
      emailPrefix,
      profile?.username,
      "patilsmit2006",
      "Creator"
    ].filter(Boolean));

    document.querySelectorAll("body *").forEach((el) => {
      if (el.children.length) return;
      const text = (el.textContent || "").trim();

      if (possibleTexts.has(text)) {
        el.textContent = name;
      }
    });

    document.querySelectorAll(".premium-avatar-xl, .master-avatar, .avatar, .user-avatar, [class*='avatar']").forEach((el) => {
      const text = (el.textContent || "").trim();

      if (profile?.avatar_url && !el.querySelector("img")) {
        el.innerHTML = avatar(profile, name);
      } else if (!profile?.avatar_url && text.length <= 2) {
        el.textContent = name.charAt(0).toUpperCase();
      }
    });

    document.querySelectorAll("[data-cx-name]").forEach((el) => {
      el.textContent = name;
    });

    document.querySelectorAll("[data-cx-username]").forEach((el) => {
      el.textContent = handle;
    });
  }

  function syncNav() {
    const route = currentRoute();

    const section =
      route === "dashboard" ? "dashboard" :
      route === "campaigns" ? "campaigns" :
      route === "stats" ? "stats" :
      route === "payout" || route === "payouts" ? "payout" :
      route === "payment" || route === "wallet" ? "payment" :
      route;

    document.querySelectorAll(".nav-item").forEach((item) => {
      item.classList.toggle("active", item.dataset.section === section);
    });
  }

  function hideProfileNav() {
    document.querySelectorAll('.nav-item[data-section="profile"]').forEach((el) => {
      el.style.display = "none";
    });
  }

  function routeToProfile() {
    const target = "/profile";

    if (window.location.pathname !== target) {
      window.history.pushState({ page: "profile" }, "", target);
    }

    document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".section").forEach((section) => section.classList.remove("active"));

    const profileSection = document.getElementById("section-profile");
    if (profileSection) profileSection.classList.add("active");

    if (typeof renderPremiumProfilePage === "function") {
      renderPremiumProfilePage();
    }

    setRouteClass();
    syncNav();
    document.title = "Clipency | Profile";
  }

  function bindIdentityClicks() {
    const selectors = [
      ".sidebar-user",
      ".user-footer",
      ".top-profile",
      ".header-profile",
      ".profile-chip",
      ".user-pill",
      ".user-menu",
      "[class*='footer-user']"
    ];

    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        if (el.dataset.cxProfileReady === "true") return;

        const text = (el.textContent || "").toLowerCase();
        const hasAvatar = el.querySelector("img, .avatar, [class*='avatar']");

        if (
          hasAvatar ||
          text.includes("creator") ||
          text.includes("smit") ||
          text.includes("patil")
        ) {
          el.dataset.cxProfileReady = "true";
          el.classList.add("cx-profile-clickable");
          el.setAttribute("role", "button");
          el.setAttribute("tabindex", "0");

          el.addEventListener("click", (event) => {
            const logout = event.target.closest(".logout, .signout, .sign-out, [data-logout]");
            if (logout) return;
            routeToProfile();
          });

          el.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              routeToProfile();
            }
          });
        }
      });
    });
  }

  function bindLogoHome() {
    const selectors = [
      ".logo",
      ".brand",
      ".brand-logo",
      ".sidebar-logo",
      ".app-logo",
      "[class*='logo']",
      "[class*='brand']"
    ];

    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        if (el.dataset.cxLogoHome === "true") return;

        const text = (el.textContent || "").trim().toLowerCase();
        const hasVisualLogo = el.querySelector("img, svg") || el.tagName === "IMG";

        if (!hasVisualLogo && !text.includes("clipency")) return;

        el.dataset.cxLogoHome = "true";
        el.setAttribute("role", "link");
        el.setAttribute("tabindex", "0");

        el.addEventListener("click", (event) => {
          event.preventDefault();
          window.location.href = "/";
        });
      });
    });
  }

  function dedupeCampaignTags() {
    if (currentRoute() !== "campaigns") return;

    document.querySelectorAll(".campaign-card").forEach((card) => {
      const badges = Array.from(
        card.querySelectorAll(".tag, .badge, [class*='tag'], [class*='badge']")
      );

      const seen = new Set();

      badges.forEach((badge) => {
        const text = (badge.textContent || "").trim().toLowerCase();
        if (!text) return;

        if (seen.has(text) && text !== "new") {
          badge.remove();
        } else {
          seen.add(text);
        }
      });
    });
  }

  function showToast(title, message) {
    document.querySelectorAll(".cx-toast").forEach((el) => el.remove());

    const toast = document.createElement("div");
    toast.className = "cx-toast";
    toast.innerHTML = `<strong>${title}</strong><span>${message}</span>`;

    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 4200);
  }

  function installErrorStates() {
    window.addEventListener("unhandledrejection", (event) => {
      const msg = event.reason?.message || "";

      if (
        msg.toLowerCase().includes("supabase") ||
        msg.toLowerCase().includes("fetch") ||
        msg.toLowerCase().includes("network")
      ) {
        showToast("Couldn’t load data", "Please refresh once. Your session and submissions are safe.");
      }
    });
  }

  function installLoadingHelpers() {
    window.ClipencyLoading = {
      grid(targetSelector, count = 6) {
        const target = document.querySelector(targetSelector);
        if (!target) return;

        target.innerHTML = `
          <div class="cx-loading-grid">
            ${Array.from({ length: count }).map(() => `<div class="cx-skeleton cx-loading-card"></div>`).join("")}
          </div>
        `;
      },

      error(targetSelector, title = "Couldn’t load this section", message = "Please refresh once or try again in a moment.") {
        const target = document.querySelector(targetSelector);
        if (!target) return;

        target.innerHTML = `
          <div class="cx-error-box">
            <strong>${title}</strong>
            <span>${message}</span>
          </div>
        `;
      },

      empty(targetSelector, title = "Nothing here yet", message = "Once activity starts, this section will update automatically.") {
        const target = document.querySelector(targetSelector);
        if (!target) return;

        target.innerHTML = `
          <div class="cx-empty-box">
            <strong>${title}</strong>
            <span>${message}</span>
          </div>
        `;
      }
    };
  }

  async function polish() {
    setRouteClass();
    syncNav();
    hideProfileNav();
    bindIdentityClicks();
    bindLogoHome();
    dedupeCampaignTags();
    await applyIdentity();
  }

  function installLandingDecision() {
    const path = window.location.pathname;

    if (path !== "/" && path !== "/index.html" && path !== "/login" && path !== "/signup") {
      return;
    }

    setTimeout(async () => {
      const user = await getSessionUser();

      if (user && (path === "/" || path === "/index.html")) {
        window.location.href = "/dashboard";
      }
    }, 250);
  }

  function boot() {
    if (CX.initialized) return;
    CX.initialized = true;

    installLoadingHelpers();
    installErrorStates();
    installLandingDecision();

    polish();
    setTimeout(polish, 700);
    setTimeout(polish, 1800);

    document.addEventListener("click", () => {
      setTimeout(polish, 120);
    });

    window.addEventListener("popstate", () => {
      setTimeout(polish, 80);
    });

    window.ClipencyUX = {
      getIdentity,
      applyIdentity,
      displayName,
      username,
      avatar,
      routeToProfile,
      showToast,
      polish
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
