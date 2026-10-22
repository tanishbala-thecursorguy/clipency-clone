(function () {
  if (window.__clipencyAuthEntryGuardLoaded) return;
  window.__clipencyAuthEntryGuardLoaded = true;

  const authRoutes = ["/login", "/signup", "/auth.html", "/login.html", "/signup.html"];
  const isAuthRoute = authRoutes.includes(window.location.pathname);

  if (!isAuthRoute) return;

  window.CLIPENCY_AUTH_ROUTE = true;
  window.CLIPENCY_SUPPRESS_GENERIC_TOASTS = true;

  // Clean logout query from the address bar after landing on auth page.
  try {
    const url = new URL(window.location.href);

    if (url.searchParams.has("logged_out")) {
      url.searchParams.delete("logged_out");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    }
  } catch {}

  function isBadToast(el) {
    const text = (el.textContent || "").trim().toLowerCase();

    return (
      text.includes("something broke") &&
      text.includes("please refresh once")
    );
  }

  function removeBadToasts() {
    if (!document.body) return;

    document.querySelectorAll("body *").forEach((el) => {
      if (!isBadToast(el)) return;

      const toast =
        el.closest(".toast, .notification, .alert, [role='alert']") ||
        el;

      toast.remove();
    });
  }

  // Intercept global toast if the old app exposes it.
  try {
    let realShowToast = window.showToast;

    Object.defineProperty(window, "showToast", {
      configurable: true,
      get() {
        return function (...args) {
          const text = args.map(String).join(" ").toLowerCase();

          if (
            window.CLIPENCY_SUPPRESS_GENERIC_TOASTS &&
            text.includes("something broke")
          ) {
            return;
          }

          if (typeof realShowToast === "function") {
            return realShowToast.apply(this, args);
          }
        };
      },
      set(fn) {
        realShowToast = function (...args) {
          const text = args.map(String).join(" ").toLowerCase();

          if (
            window.CLIPENCY_SUPPRESS_GENERIC_TOASTS &&
            text.includes("something broke")
          ) {
            return;
          }

          return fn.apply(this, args);
        };
      }
    });
  } catch {}

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", removeBadToasts);
  } else {
    removeBadToasts();
  }

  new MutationObserver(removeBadToasts).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
})();
