/* =========================================================
   CLIPENCY LIGHTWEIGHT FINAL POLISH
   Performance-safe version
   ========================================================= */

(function () {
  let polishTimer = null;

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

  function setRouteClass() {
    const route = currentRoute();

    document.body.classList.remove(
      "route-dashboard",
      "route-campaigns",
      "route-stats",
      "route-payout",
      "route-payment",
      "route-profile"
    );

    document.body.classList.add(`route-${route}`);
  }

  function hideProfileNav() {
    document.querySelectorAll('.nav-item[data-section="profile"]').forEach((el) => {
      el.style.display = "none";
    });
  }

  function syncNav() {
    const route = currentRoute();

    const navSection =
      route === "dashboard" ? "dashboard" :
      route === "campaigns" ? "campaigns" :
      route === "stats" ? "stats" :
      route === "payout" || route === "payouts" ? "payout" :
      route === "payment" || route === "wallet" ? "payment" :
      route;

    document.querySelectorAll(".nav-item").forEach((item) => {
      item.classList.toggle("active", item.dataset.section === navSection);
    });
  }

  function dedupeCampaignTags() {
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

  function routeToProfile() {
    if (window.location.pathname !== "/profile") {
      window.history.pushState({ page: "profile" }, "", "/profile");
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

  function makeIdentityClickable() {
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
        if (el.dataset.profileClickReady === "true") return;

        const text = (el.textContent || "").toLowerCase();
        const hasAvatar = el.querySelector("img, .avatar, [class*='avatar']");

        if (
          hasAvatar ||
          text.includes("creator") ||
          text.includes("smit") ||
          text.includes("patil")
        ) {
          el.dataset.profileClickReady = "true";
          el.style.cursor = "pointer";

          el.addEventListener("click", (event) => {
            const logout = event.target.closest(".logout, .signout, .sign-out, [data-logout]");
            if (logout) return;
            routeToProfile();
          });
        }
      });
    });
  }

  function polish() {
    setRouteClass();
    hideProfileNav();
    syncNav();
    makeIdentityClickable();

    if (currentRoute() === "campaigns") {
      dedupeCampaignTags();
    }
  }

  function schedulePolish() {
    clearTimeout(polishTimer);
    polishTimer = setTimeout(polish, 150);
  }

  function boot() {
    polish();

    document.addEventListener("click", schedulePolish);
    window.addEventListener("popstate", schedulePolish);

    // Lightweight observer only for added/removed nodes.
    // No characterData scanning, no full text walking.
    const observer = new MutationObserver(schedulePolish);
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Stop observer after initial dynamic render is complete to keep app fast.
    setTimeout(() => observer.disconnect(), 5000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
