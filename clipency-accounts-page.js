(function(){
  window.CLIPENCY_ACCOUNTS_PAGE = "accounts-page-v1";

  const platforms = [
    {
      id: "youtube",
      name: "YouTube",
      icon: "▶",
      placeholder: "https://youtube.com/@yourchannel"
    },
    {
      id: "instagram",
      name: "Instagram",
      icon: "◎",
      placeholder: "https://instagram.com/yourhandle"
    },
    {
      id: "tiktok",
      name: "TikTok",
      icon: "♪",
      placeholder: "https://tiktok.com/@yourhandle"
    }
  ];

  let accounts = {};

  function clean(v){
    return String(v || "").replace(/\s+/g, " ").trim();
  }

  function sb(){
    return window.clipencySupabase || window.supabaseClient || window.sbClient || null;
  }

  async function rpc(name, payload){
    const client = sb();
    if(!client || !client.rpc){
      throw new Error("Supabase client missing. Please refresh or login again.");
    }

    const { data, error } = await client.rpc(name, payload || {});
    if(error) throw error;
    return data || [];
  }

  function statusLabel(status){
    if(status === "verified") return "Connected";
    if(status === "pending") return "Under Verification";
    if(status === "rejected") return "Rejected";
    if(status === "expired") return "Expired";
    return "Not Connected";
  }

  function statusClass(status){
    if(status === "verified") return "connected";
    if(status === "pending") return "pending";
    if(status === "rejected") return "rejected";
    if(status === "expired") return "expired";
    return "empty";
  }

  function actionText(status){
    if(status === "verified") return "Connected";
    if(status === "pending") return "View Status";
    if(status === "rejected") return "Retry";
    if(status === "expired") return "Generate New Code";
    return "Add Account";
  }

  function fmtDate(v){
    if(!v) return "—";
    try{
      return new Date(v).toLocaleString();
    }catch(e){
      return "—";
    }
  }

  function renderSkeleton(){
    const root = document.getElementById("accounts-grid");
    if(!root) return;

    root.innerHTML = platforms.map(() => `
      <div class="account-card skeleton-card">
        <div class="skeleton-line w40"></div>
        <div class="skeleton-line w70"></div>
        <div class="skeleton-line w55"></div>
      </div>
    `).join("");
  }

  function render(){
    const root = document.getElementById("accounts-grid");
    if(!root) return;

    root.innerHTML = platforms.map(platform => {
      const account = accounts[platform.id] || null;
      const status = account ? account.status : "not_connected";
      const cls = statusClass(status);
      const handle = account && account.handle ? "@" + account.handle : "No account added";
      const code = account && account.verification_code ? account.verification_code : "—";

      return `
        <article class="account-card ${cls}" data-platform="${platform.id}">
          <div class="account-top">
            <div class="platform-icon">${platform.icon}</div>
            <div>
              <h2>${platform.name}</h2>
              <p>${handle}</p>
            </div>
            <span class="status-pill ${cls}">${statusLabel(status)}</span>
          </div>

          <div class="account-meta">
            <div>
              <span>Verification code</span>
              <strong class="code">${code}</strong>
            </div>
            <div>
              <span>Review timeline</span>
              <strong>Within 24 hours</strong>
            </div>
          </div>

          ${account && account.profile_url ? `
            <a class="profile-link" href="${account.profile_url}" target="_blank" rel="noopener">Open profile ↗</a>
          ` : `
            <div class="profile-link muted-link">${platform.placeholder}</div>
          `}

          ${status === "pending" ? `
            <div class="notice">
              Paste the 6-digit code in your ${platform.name} bio/profile. Your account will be reviewed and verified within 24 hours.
            </div>
          ` : ""}

          ${status === "verified" ? `
            <div class="notice success">
              This ${platform.name} account is connected and ready for campaign proof verification.
            </div>
          ` : ""}

          ${status === "rejected" ? `
            <div class="notice danger">
              ${account.rejection_reason || "Verification was rejected. Please retry with the correct account."}
            </div>
          ` : ""}

          ${status === "expired" ? `
            <div class="notice warning">
              Your previous verification code expired. Generate a new code and submit again.
            </div>
          ` : ""}

          <button class="account-action" data-action-platform="${platform.id}" ${status === "verified" ? "disabled" : ""}>
            ${actionText(status)}
          </button>
        </article>
      `;
    }).join("");

    root.querySelectorAll("[data-action-platform]").forEach(btn => {
      btn.addEventListener("click", () => openModal(btn.dataset.actionPlatform));
    });
  }

  function openModal(platformId){
    const platform = platforms.find(p => p.id === platformId);
    const account = accounts[platformId] || null;
    if(!platform) return;

    const old = document.getElementById("accounts-modal");
    if(old) old.remove();

    document.body.insertAdjacentHTML("beforeend", `
      <div id="accounts-modal" class="modal-backdrop">
        <div class="modal-card">
          <button class="modal-close" id="accounts-close">×</button>
          <p class="modal-eyebrow">Connect ${platform.name}</p>
          <h2>${account && account.status === "pending" ? "Verification status" : "Add account"}</h2>
          <p class="modal-copy">
            Enter your ${platform.name} username and profile URL. Clipency will generate a 6-digit code. Verification is usually completed within 24 hours.
          </p>

          <label>Username / handle</label>
          <input id="account-handle" value="${account && account.handle ? "@" + account.handle : ""}" placeholder="@yourhandle" />

          <label>Profile URL</label>
          <input id="account-url" value="${account && account.profile_url ? account.profile_url : ""}" placeholder="${platform.placeholder}" />

          ${account && account.status === "pending" ? `
            <div class="code-box">
              <span>Your verification code</span>
              <strong>${account.verification_code || "—"}</strong>
              <p>Paste this code in your ${platform.name} bio/profile. Your account will be reviewed and verified within 24 hours.</p>
            </div>
          ` : ""}

          <button class="modal-submit" id="account-submit">Generate 6-digit code →</button>
        </div>
      </div>
    `);

    const modal = document.getElementById("accounts-modal");
    document.getElementById("accounts-close").onclick = () => modal.remove();

    document.getElementById("account-submit").onclick = async () => {
      const handle = clean(document.getElementById("account-handle").value);
      const url = clean(document.getElementById("account-url").value);

      if(!handle){
        alert("Please enter your username.");
        return;
      }

      try{
        const result = await rpc("clipency_request_connected_account", {
          p_platform: platformId,
          p_handle: handle,
          p_profile_url: url
        });

        const row = Array.isArray(result) ? result[0] : result;
        accounts[platformId] = row;

        modal.remove();
        render();

        alert(`Verification code generated: ${row.verification_code}\n\nPaste this code in your ${platform.name} bio/profile. Your account will be reviewed and verified within 24 hours.`);
      }catch(error){
        console.error("[Accounts] Generate code failed", error);
        alert("Could not generate verification code: " + (error.message || error));
      }
    };
  }

  async function load(){
    const errorBox = document.getElementById("accounts-error");
    if(errorBox) errorBox.textContent = "";

    renderSkeleton();

    try{
      const rows = await rpc("clipency_my_connected_accounts", {});
      accounts = {};

      rows.forEach(row => {
        if(row && row.platform){
          accounts[row.platform] = row;
        }
      });

      render();
    }catch(error){
      console.error("[Accounts] Load failed", error);
      const root = document.getElementById("accounts-grid");
      if(root){
        root.innerHTML = "";
      }
      if(errorBox){
        errorBox.textContent = "Could not load connected accounts: " + (error.message || error);
      }
    }
  }

  document.addEventListener("DOMContentLoaded", load);
})();
