(function () {

  const cxAuthRoutes = ["/login", "/signup", "/auth.html", "/login.html", "/signup.html"];
  if (cxAuthRoutes.includes(window.location.pathname)) return;

  if (window.__clipencyForceProfileButtonLoaded) return;
  window.__clipencyForceProfileButtonLoaded = true;

  const creatorRoutes = ["/campaigns", "/stats", "/payouts", "/wallet", "/profile", "/dashboard"];
  if (!creatorRoutes.includes(window.location.pathname)) return;

  function getSidebar() {
    return document.querySelector(".sidebar, .dashboard-sidebar, aside");
  }

  function textOf(el) {
    return (el.textContent || "").trim().toLowerCase();
  }

  function isProfileNav(el) {
    const href = el.getAttribute?.("href") || "";
    const route = el.dataset?.route || el.dataset?.page || el.dataset?.nav || "";

    return (
      el.classList?.contains("cx-forced-profile-link") ||
      href === "/profile" ||
      route === "/profile" ||
      route === "profile" ||
      textOf(el) === "profile"
    );
  }

  function isWalletNav(el) {
    const href = el.getAttribute?.("href") || "";
    const route = el.dataset?.route || el.dataset?.page || el.dataset?.nav || "";

    return (
      href === "/wallet" ||
      route === "/wallet" ||
      route === "wallet" ||
      textOf(el).includes("wallet")
    );
  }

  function createProfileLink() {
    const link = document.createElement("a");
    link.href = "/profile";
    link.className = "cx-forced-profile-link";
    link.setAttribute("data-route", "/profile");

    if (window.location.pathname === "/profile") {
      link.classList.add("active");
      link.setAttribute("aria-current", "page");
    }

    link.innerHTML = `
      <span class="cx-forced-profile-icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M20 21a8 8 0 0 0-16 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.8"/>
        </svg>
      </span>
      <span>Profile</span>
    `;

    link.addEventListener("click", function (event) {
      event.preventDefault();
      window.location.href = "/profile";
    });

    return link;
  }

  function addProfileButton() {
    const sidebar = getSidebar();
    if (!sidebar) return;

    // Remove duplicate forced links first
    sidebar.querySelectorAll(".cx-forced-profile-link").forEach((el, index) => {
      if (index > 0) el.remove();
    });

    // If real profile link already exists, just make it visible and active
    const existingProfile = Array.from(sidebar.querySelectorAll("a, button")).find(isProfileNav);
    if (existingProfile && !existingProfile.classList.contains("cx-forced-profile-link")) {
      existingProfile.style.display = "";
      return;
    }

    if (sidebar.querySelector(".cx-forced-profile-link")) return;

    const walletItem = Array.from(sidebar.querySelectorAll("a, button, [role='button'], div")).find(isWalletNav);
    const profileLink = createProfileLink();

    if (walletItem) {
      const row =
        walletItem.closest("li, a, button, .nav-item, .sidebar-link, .nav-link") ||
        walletItem;

      row.insertAdjacentElement("afterend", profileLink);
      return;
    }

    const currencyLabel = Array.from(sidebar.querySelectorAll("*")).find((el) => {
      return textOf(el) === "currency";
    });

    if (currencyLabel) {
      currencyLabel.insertAdjacentElement("beforebegin", profileLink);
      return;
    }

    const nav = sidebar.querySelector("nav") || sidebar;
    nav.appendChild(profileLink);
  }

  function makeBottomProfileClickable() {
    const sidebar = getSidebar();
    if (!sidebar) return;

    const bottomProfile = Array.from(sidebar.querySelectorAll("div, a, button")).find((el) => {
      const text = textOf(el);
      return text.includes("smit bharat patil") && !text.includes("campaigns");
    });

    if (!bottomProfile || bottomProfile.dataset.cxProfileOpenReady) return;

    bottomProfile.dataset.cxProfileOpenReady = "true";
    bottomProfile.style.cursor = "pointer";
    bottomProfile.addEventListener("click", function (event) {
      if (event.target.closest("[data-logout], .logout, .logout-btn, [aria-label='Logout']")) return;
      window.location.href = "/profile";
    });
  }

  function boot() {
    addProfileButton();
    makeBottomProfileClickable();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  new MutationObserver(boot).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
