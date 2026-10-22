(function () {
  if (window.__clipencyAdminShellPolishLoaded) return;
  window.__clipencyAdminShellPolishLoaded = true;

  if (!window.location.pathname.startsWith("/admin") && window.location.pathname !== "/workspace") return;

  const adminLinks = [
    { label: "Command Center", href: "/admin", icon: "grid" },
    { label: "Reviews", href: "/admin/reviews", icon: "check" },
    { label: "Campaigns", href: "/admin/campaigns", icon: "play" },
    { label: "Leads", href: "/admin/leads", icon: "mail" },
    { label: "Users", href: "/admin/users", icon: "users" },
    { label: "Workspace", href: "/workspace", icon: "spark" }
  ];

  function icon(name) {
    const icons = {
      grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" stroke="currentColor" stroke-width="1.7" fill="none" rx="2"/>',
      check: '<path d="M20 6 9 17l-5-5" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
      play: '<path d="M7 5v14l12-7-12-7Z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/>',
      mail: '<path d="M4 6h16v12H4z" stroke="currentColor" stroke-width="1.7" fill="none" rx="2"/><path d="m4 8 8 6 8-6" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
      users: '<path d="M16 21a5 5 0 0 0-10 0" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/><circle cx="11" cy="8" r="4" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M20 21a4 4 0 0 0-3-3.87" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/><path d="M17 4.2a3 3 0 0 1 0 5.6" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/>',
      spark: '<path d="M12 3l1.7 5.2L19 10l-5.3 1.8L12 17l-1.7-5.2L5 10l5.3-1.8L12 3Z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/>'
    };

    return `<svg viewBox="0 0 24 24" fill="none">${icons[name] || icons.grid}</svg>`;
  }

  function text(el) {
    return (el?.textContent || "").trim().toLowerCase();
  }

  function getSidebar() {
    return document.querySelector(".sidebar, .dashboard-sidebar, aside");
  }

  function hideOldClipperSidebar(sidebar) {
    Array.from(sidebar.querySelectorAll("*")).forEach((el) => {
      if (el.closest(".cx-admin-nav")) return;

      const t = text(el);

      if (
        t === "clippers" ||
        t === "currency" ||
        t === "campaigns" ||
        t === "stats" ||
        t === "payouts" ||
        t === "wallet" ||
        t === "profile" ||
        t === "usd"
      ) {
        el.classList.add("cx-admin-hide-old");
      }
    });
  }

  function injectAdminNav() {
    document.body.classList.add("cx-admin-mode");

    const sidebar = getSidebar();
    if (!sidebar) return;

    hideOldClipperSidebar(sidebar);

    if (sidebar.querySelector(".cx-admin-nav")) return;

    const nav = document.createElement("nav");
    nav.className = "cx-admin-nav";

    const label = document.createElement("div");
    label.className = "cx-admin-nav-label";
    label.textContent = "ADMIN";

    const links = adminLinks.map((item) => {
      const active =
        window.location.pathname === item.href ||
        (item.href !== "/admin" && window.location.pathname.startsWith(item.href));

      return `
        <a href="${item.href}" class="${active ? "active" : ""}">
          ${icon(item.icon)}
          <span>${item.label}</span>
        </a>
      `;
    }).join("");

    nav.innerHTML = links;

    const logoBoundary =
      Array.from(sidebar.children).find((child) => {
        return text(child).includes("clippers");
      }) || sidebar.children[1] || null;

    if (logoBoundary) {
      logoBoundary.insertAdjacentElement("beforebegin", label);
      label.insertAdjacentElement("afterend", nav);
    } else {
      sidebar.appendChild(label);
      sidebar.appendChild(nav);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectAdminNav);
  } else {
    injectAdminNav();
  }

  setTimeout(injectAdminNav, 300);
  setTimeout(injectAdminNav, 900);
})();
