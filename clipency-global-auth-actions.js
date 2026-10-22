(function () {

  const cxAuthRoutes = ["/login", "/signup", "/auth.html", "/login.html", "/signup.html"];
  if (cxAuthRoutes.includes(window.location.pathname)) return;

  if (window.__clipencyGlobalAuthActionsLoaded) return;
  window.__clipencyGlobalAuthActionsLoaded = true;

  function isLogoutElement(el) {
    if (!el) return false;

    const text = (el.textContent || "").trim().toLowerCase();
    const href = el.getAttribute?.("href") || "";
    const aria = el.getAttribute?.("aria-label") || "";
    const title = el.getAttribute?.("title") || "";
    const className = String(el.className || "").toLowerCase();
    const data = [
      el.dataset?.logout,
      el.dataset?.action,
      el.dataset?.auth,
      el.dataset?.target
    ].filter(Boolean).join(" ").toLowerCase();

    return (
      text === "logout" ||
      text === "log out" ||
      text === "sign out" ||
      href === "/logout" ||
      href === "/signout" ||
      aria.toLowerCase().includes("logout") ||
      aria.toLowerCase().includes("log out") ||
      title.toLowerCase().includes("logout") ||
      title.toLowerCase().includes("log out") ||
      className.includes("logout") ||
      data.includes("logout") ||
      data.includes("signout")
    );
  }

  function clearAuthStorage() {
    const keysToRemove = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);

      if (!key) continue;

      const lower = key.toLowerCase();

      if (
        lower.includes("supabase") ||
        lower.includes("sb-") ||
        lower.includes("clipency.auth") ||
        lower.includes("auth-token")
      ) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => localStorage.removeItem(key));

    const sessionKeysToRemove = [];

    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);

      if (!key) continue;

      const lower = key.toLowerCase();

      if (
        lower.includes("supabase") ||
        lower.includes("sb-") ||
        lower.includes("clipency.auth") ||
        lower.includes("auth-token")
      ) {
        sessionKeysToRemove.push(key);
      }
    }

    sessionKeysToRemove.forEach((key) => sessionStorage.removeItem(key));
  }

  async function logout() {
    try {
      if (window.supabaseClient?.auth?.signOut) {
        await window.supabaseClient.auth.signOut();
      }
    } catch (error) {
      console.warn("Supabase signOut failed. Clearing local session anyway.", error);
    }

    clearAuthStorage();
    window.location.replace("/login");
  }

  window.ClipencyLogout = logout;

  document.addEventListener("click", function (event) {
    const target = event.target.closest("a, button, [role='button'], [data-logout], .logout, .logout-btn");

    if (!target) return;

    if (!isLogoutElement(target)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    logout();
  }, true);

  function markLogoutButtons() {
    document.querySelectorAll("a, button, [role='button']").forEach((el) => {
      if (!isLogoutElement(el)) return;

      el.setAttribute("data-logout", "true");
      el.setAttribute("title", "Logout");
      el.style.cursor = "pointer";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", markLogoutButtons);
  } else {
    markLogoutButtons();
  }

  new MutationObserver(markLogoutButtons).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
