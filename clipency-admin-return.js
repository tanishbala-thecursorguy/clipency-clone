(function () {
  if (window.__clipencyAdminReturnLoaded) return;
  window.__clipencyAdminReturnLoaded = true;

  const clipperRoutes = ["/campaigns", "/stats", "/payouts", "/wallet", "/profile"];

  if (!clipperRoutes.includes(window.location.pathname)) return;

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForSupabase() {
    for (let i = 0; i < 80; i++) {
      if (window.supabaseClient) return window.supabaseClient;
      await wait(80);
    }

    return null;
  }

  function getSidebar() {
    return document.querySelector(".sidebar, .dashboard-sidebar, aside");
  }

  function goAdmin(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }

    window.location.href = "/admin";
  }

  function addButton() {
    const sidebar = getSidebar();

    if (!sidebar) return;

    let link = sidebar.querySelector(".cx-admin-return-link");

    if (!link) {
      link = document.createElement("a");
      link.href = "/admin";
      link.className = "cx-admin-return-link";
      link.setAttribute("data-admin-return", "true");
      link.setAttribute("title", "Open Admin OS");
      link.setAttribute("aria-label", "Open Admin OS");

      link.innerHTML = `
        <span class="cx-admin-return-icon">⌘</span>
        <strong>Admin OS</strong>
      `;

      const currencyLabel = Array.from(sidebar.querySelectorAll("*")).find((el) => {
        return (el.textContent || "").trim().toLowerCase() === "currency";
      });

      if (currencyLabel) {
        currencyLabel.insertAdjacentElement("beforebegin", link);
      } else {
        sidebar.appendChild(link);
      }
    }

    link.onclick = goAdmin;

    ["pointerdown", "mousedown", "click"].forEach((eventName) => {
      link.addEventListener(eventName, goAdmin, true);
    });
  }

  async function boot() {
    try {
      const supabase = await waitForSupabase();
      if (!supabase) return;

      const { data } = await supabase.auth.getUser();
      const user = data?.user;

      if (!user?.email || !user?.id) return;

      const email = user.email.toLowerCase();

      const { data: adminRows, error } = await supabase
        .from("admin_users")
        .select("email,user_id")
        .or(`user_id.eq.${user.id},email.eq.${email}`)
        .limit(1);

      if (error) return;

      if (adminRows && adminRows.length) {
        addButton();
      }
    } catch {}
  }

  document.addEventListener("click", function (event) {
    const adminButton = event.target.closest(".cx-admin-return-link, [data-admin-return]");

    if (!adminButton) return;

    goAdmin(event);
  }, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  setTimeout(boot, 400);
  setTimeout(boot, 1000);
})();
