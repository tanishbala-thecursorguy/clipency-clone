(function () {
  if (window.__clipencyLayoutFixLoaded) return;
  window.__clipencyLayoutFixLoaded = true;

  const path = window.location.pathname;

  const creatorRoutes = [
    "/dashboard",
    "/campaigns",
    "/stats",
    "/payouts",
    "/wallet",
    "/profile"
  ];

  const isCreatorRoute = creatorRoutes.includes(path);

  function ensureBodyClasses() {
    if (isCreatorRoute) document.body.classList.add("cx-creator-route");
    if (path === "/") document.body.classList.add("cx-landing-route");
  }

  function addSidebarToggle() {
    if (!isCreatorRoute) return;
    if (document.querySelector(".cx-sidebar-toggle")) return;

    const btn = document.createElement("button");
    btn.className = "cx-sidebar-toggle";
    btn.type = "button";
    btn.setAttribute("aria-label", "Toggle sidebar");
    btn.innerHTML = "☰";
    document.body.appendChild(btn);

    btn.addEventListener("click", function () {
      document.body.classList.toggle("cx-mobile-sidebar-open");
    });

    document.addEventListener("click", function (e) {
      if (!document.body.classList.contains("cx-mobile-sidebar-open")) return;
      const sidebar = document.querySelector(".sidebar, .dashboard-sidebar, aside.sidebar");
      const clickedToggle = e.target.closest(".cx-sidebar-toggle");
      const clickedInsideSidebar = sidebar && sidebar.contains(e.target);

      if (!clickedToggle && !clickedInsideSidebar) {
        document.body.classList.remove("cx-mobile-sidebar-open");
      }
    });

    window.addEventListener("resize", function () {
      if (window.innerWidth > 900) {
        document.body.classList.remove("cx-mobile-sidebar-open");
      }
    });
  }

  function normalizeSidebarFooter() {
    if (!isCreatorRoute) return;

    const sidebar = document.querySelector(".sidebar, .dashboard-sidebar, aside.sidebar");
    if (!sidebar) return;

    let footer =
      sidebar.querySelector(".sidebar-footer, .dashboard-sidebar-footer, .bottom-area");

    if (!footer) {
      footer = document.createElement("div");
      footer.className = "sidebar-footer";
      sidebar.appendChild(footer);
    }

    const quickSwitch = document.querySelector(".cx-command-trigger, .quick-switch, .command-trigger");
    const adminLink = Array.from(sidebar.querySelectorAll("a")).find(a =>
      /admin/i.test(a.textContent || "") || (a.getAttribute("href") || "").includes("admin")
    );

    const candidateUserCard =
      sidebar.querySelector(".sidebar-user, .sidebar-profile, .bottom-profile-card") ||
      Array.from(sidebar.querySelectorAll("a, div, button")).find(el => {
        const txt = (el.textContent || "").toLowerCase();
        return txt.includes("creator") && txt.includes("logout") === false;
      });

    if (candidateUserCard && candidateUserCard.parentElement !== footer) {
      candidateUserCard.classList.add("sidebar-profile");
      footer.prepend(candidateUserCard);
    }

    if (quickSwitch && quickSwitch.parentElement !== footer) {
      footer.appendChild(quickSwitch);
    }

    if (adminLink && adminLink.parentElement !== footer) {
      footer.appendChild(adminLink);
    }
  }

  function makeTopPillClickable() {
    const pills = document.querySelectorAll(".cx-user-pill, .page-user-pill, .top-user-pill, .page-identity-pill");
    pills.forEach((pill) => {
      if (pill.tagName.toLowerCase() !== "a") {
        pill.style.cursor = "pointer";
        pill.addEventListener("click", () => {
          window.location.href = "/profile";
        });
      }
    });
  }

  function improveResponsiveTables() {
    document.querySelectorAll("table").forEach((table) => {
      if (!table.parentElement.classList.contains("cx-table-wrap")) {
        const wrap = document.createElement("div");
        wrap.className = "cx-table-wrap";
        wrap.style.overflowX = "auto";
        table.parentElement.insertBefore(wrap, table);
        wrap.appendChild(table);
      }
    });
  }

  function run() {
    ensureBodyClasses();
    addSidebarToggle();
    normalizeSidebarFooter();
    makeTopPillClickable();
    improveResponsiveTables();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
