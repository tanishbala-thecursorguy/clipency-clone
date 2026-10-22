(function () {
  if (window.__clipencyFinalLogoutLoaded) return;
  window.__clipencyFinalLogoutLoaded = true;

  const authRoutes = ["/login", "/signup", "/auth.html", "/login.html", "/signup.html"];
  if (authRoutes.includes(window.location.pathname)) return;

  let loggingOut = false;

  function isExplicitLogout(el) {
    if (!el) return false;

    const text = (el.textContent || "").trim().toLowerCase();
    const href = el.getAttribute?.("href") || "";
    const aria = (el.getAttribute?.("aria-label") || "").toLowerCase();
    const title = (el.getAttribute?.("title") || "").toLowerCase();
    const cls = String(el.className || "").toLowerCase();
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
      aria.includes("logout") ||
      aria.includes("log out") ||
      aria.includes("sign out") ||
      title.includes("logout") ||
      title.includes("log out") ||
      title.includes("sign out") ||
      cls.includes("logout") ||
      data.includes("logout") ||
      data.includes("signout")
    );
  }

  function isSmallBottomLogoutButton(el) {
    const sidebar = el?.closest?.(".sidebar, .dashboard-sidebar, aside");
    if (!sidebar) return false;

    const button = el.closest("button, a, [role='button']");
    if (!button) return false;

    const sidebarBox = sidebar.getBoundingClientRect();
    const box = button.getBoundingClientRect();

    const smallEnough = box.width <= 72 && box.height <= 72;
    const nearBottom = box.top > sidebarBox.bottom - 170;
    const nearRight = box.left > sidebarBox.right - 96;

    return smallEnough && nearBottom && nearRight;
  }

  function isLogoutClick(event) {
    const explicit = event.target.closest("[data-logout], .logout, .logout-btn, a, button, [role='button']");

    if (explicit && isExplicitLogout(explicit)) return true;

    return isSmallBottomLogoutButton(event.target);
  }

  function clearStoredAuth() {
    const clear = (storage) => {
      const keys = [];

      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key) continue;

        const lower = key.toLowerCase();

        if (
          lower.startsWith("sb-") ||
          lower.includes("supabase") ||
          lower.includes("auth-token") ||
          lower.includes("clipency.auth")
        ) {
          keys.push(key);
        }
      }

      keys.forEach((key) => storage.removeItem(key));
    };

    try { clear(localStorage); } catch {}
    try { clear(sessionStorage); } catch {}
  }

  async function waitForSupabase() {
    for (let i = 0; i < 40; i++) {
      if (window.supabaseClient?.auth?.signOut) return window.supabaseClient;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return null;
  }

  async function logoutNow() {
    if (loggingOut) return;
    loggingOut = true;

    document.documentElement.classList.add("cx-logging-out");

    try {
      const supabase = await waitForSupabase();

      if (supabase?.auth?.signOut) {
        await supabase.auth.signOut({ scope: "global" });
      }
    } catch (error) {
      console.warn("Logout failed, clearing local session anyway.", error);
    }

    clearStoredAuth();

    setTimeout(function () {
      window.location.replace("/login");
    }, 80);
  }

  document.addEventListener("click", function (event) {
    if (!isLogoutClick(event)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    logoutNow();
  }, true);

  function markOnlyLogoutButton() {
    document.querySelectorAll(".sidebar, .dashboard-sidebar, aside").forEach((sidebar) => {
      sidebar.querySelectorAll("[data-logout], .logout, .logout-btn, a, button, [role='button']").forEach((el) => {
        if (isExplicitLogout(el) || isSmallBottomLogoutButton(el)) {
          el.setAttribute("data-logout", "true");
          el.setAttribute("title", "Logout");
          el.style.cursor = "pointer";
        }
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", markOnlyLogoutButton);
  } else {
    markOnlyLogoutButton();
  }

  new MutationObserver(markOnlyLogoutButton).observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.ClipencyLogout = logoutNow;
})();
