(function () {
  if (window.ClipencyAppleLayerInstalled) return;
  window.ClipencyAppleLayerInstalled = true;

  function softenCommandTrigger() {
    const trigger = document.querySelector(".cx-command-trigger span");
    if (trigger) {
      trigger.textContent = "Navigate";
    }
  }

  function addPageEyebrowContext() {
    const path = window.location.pathname;

    const contextMap = {
      "/admin": "Today’s operating view",
      "/review": "Verification before approval",
      "/workspace": "Choose the right workspace",
      "/admin/finance": "Secure finance boundary",
      "/admin/leads": "People who want to work with Clipency",
      "/admin/users": "Access before scale",
      "/dashboard": "Creator workspace",
      "/campaigns": "Campaign discovery",
      "/stats": "Performance clarity",
      "/payouts": "Money you can track",
      "/profile": "Your Clipency identity"
    };

    const context = contextMap[path];
    if (!context) return;

    const topbar = document.querySelector(".staff-topbar, .workspace-header");
    if (!topbar || topbar.querySelector(".apple-context-line")) return;

    const line = document.createElement("div");
    line.className = "apple-context-line";
    line.textContent = context;

    topbar.prepend(line);
  }

  function installAppleContextStyles() {
    if (document.getElementById("apple-context-style")) return;

    const style = document.createElement("style");
    style.id = "apple-context-style";
    style.textContent = `
      .apple-context-line {
        width: max-content;
        max-width: 100%;
        margin-bottom: 14px;
        padding: 7px 11px;
        border-radius: 999px;
        color: rgba(255,255,255,0.62);
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.085);
        font-size: 12px;
        font-weight: 850;
      }

      .apple-flow-note {
        margin-top: 18px;
        padding: 16px 18px;
        border: 1px solid rgba(255,255,255,0.09);
        border-radius: 22px;
        background: rgba(255,255,255,0.04);
        color: rgba(255,255,255,0.58);
        line-height: 1.6;
      }
    `;
    document.head.appendChild(style);
  }

  function addWorkspaceFlowNote() {
    if (window.location.pathname !== "/workspace") return;
    if (document.querySelector(".apple-flow-note")) return;

    const header = document.querySelector(".workspace-header");
    if (!header) return;

    const note = document.createElement("div");
    note.className = "apple-flow-note";
    note.textContent = "Tip: admins can safely move between Admin, Review, Finance and Creator View. Each area keeps its own responsibility, so the platform stays clean instead of becoming one crowded dashboard.";

    header.appendChild(note);
  }

  function addFinanceFlowNote() {
    if (window.location.pathname !== "/admin/finance") return;
    if (document.querySelector(".apple-flow-note")) return;

    const hero = document.querySelector(".finance-launcher-hero");
    if (!hero) return;

    const note = document.createElement("div");
    note.className = "apple-flow-note";
    note.textContent = "Finance opens in a separate secure app because money data should stay isolated. Clipency gives you the doorway; Finance OS keeps the books.";

    hero.appendChild(note);
  }

  function boot() {
    installAppleContextStyles();
    softenCommandTrigger();
    addPageEyebrowContext();
    addWorkspaceFlowNote();
    addFinanceFlowNote();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
