(function(){
  window.CLIPENCY_CONNECTED_ACCOUNTS_CODE = "six-code-v1";

  const platforms = ["tiktok", "instagram", "youtube"];

  function clean(v){
    return String(v || "").replace(/\s+/g, " ").trim();
  }

  function path(){
    return location.pathname.replace(/\/+$/, "").toLowerCase();
  }

  function isProfile(){
    return path() === "/profile";
  }

  function sb(){
    return window.clipencySupabase || window.supabaseClient || window.sbClient || null;
  }

  async function rpc(name, payload){
    const client = sb();
    if(!client?.rpc) throw new Error("Supabase client missing.");
    const { data, error } = await client.rpc(name, payload || {});
    if(error) throw error;
    return data || [];
  }

  function labelPlatform(p){
    if(p === "tiktok") return "TikTok";
    if(p === "instagram") return "Instagram";
    if(p === "youtube") return "YouTube";
    return p;
  }

  function statusLabel(s){
    if(s === "verified") return "Connected";
    if(s === "pending") return "Under Verification";
    if(s === "expired") return "Expired";
    if(s === "rejected") return "Rejected";
    return "Add";
  }

  function findConnectedCard(){
    return Array.from(document.querySelectorAll("section, div, main, article"))
      .filter(el => /connected accounts/i.test(clean(el.textContent)))
      .sort((a,b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height)[0];
  }

  function findPlatformRow(platform){
    const card = findConnectedCard();
    if(!card) return null;

    const target = labelPlatform(platform).toLowerCase();

    return Array.from(card.querySelectorAll("div, li, section"))
      .filter(el => {
        const txt = clean(el.textContent).toLowerCase();
        const r = el.getBoundingClientRect();
        return txt.includes(target) && r.height > 35 && r.height < 150;
      })
      .sort((a,b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height)[0] || null;
  }

  function findButton(row){
    if(!row) return null;

    return Array.from(row.querySelectorAll("button,a,[role='button']"))
      .find(btn => /add|edit|connect|pending|verification|connected|rejected|expired/i.test(clean(btn.textContent)));
  }

  function setButton(btn, account){
    if(!btn) return;

    const status = account?.status || "";
    btn.textContent = account ? statusLabel(status) : "+ Add";

    btn.style.pointerEvents = "auto";
    btn.style.cursor = "pointer";

    if(status === "verified"){
      btn.style.opacity = "1";
    }else if(status === "pending"){
      btn.style.opacity = "1";
    }else{
      btn.style.opacity = "1";
    }
  }

  function setSubtitle(row, account){
    if(!row) return;

    const leaves = Array.from(row.querySelectorAll("*")).filter(el => !el.children.length);
    const subtitle = leaves.find(el => /no accounts connected|under verification|connected|rejected|expired|pending/i.test(clean(el.textContent)));

    if(!subtitle) return;

    if(!account){
      subtitle.textContent = "No accounts connected";
      return;
    }

    if(account.status === "verified"){
      subtitle.textContent = `@${account.handle} · Connected`;
      return;
    }

    if(account.status === "pending"){
      subtitle.textContent = `@${account.handle} · Under verification`;
      return;
    }

    if(account.status === "expired"){
      subtitle.textContent = `@${account.handle} · Code expired`;
      return;
    }

    if(account.status === "rejected"){
      subtitle.textContent = `@${account.handle} · Rejected`;
      return;
    }

    subtitle.textContent = `@${account.handle}`;
  }

  function modalHtml(platform, existing){
    const title = labelPlatform(platform);
    const handle = existing?.handle ? "@" + existing.handle : "";
    const url = existing?.profile_url || "";
    const code = existing?.verification_code || "";
    const showCode = existing?.status === "pending" && code;

    return `
      <div id="cx-connect-modal" style="
        position:fixed;inset:0;z-index:999999;
        background:rgba(0,0,0,.76);
        display:flex;align-items:center;justify-content:center;
        padding:22px;
        backdrop-filter:blur(12px);
      ">
        <div style="
          width:min(560px,96vw);
          background:linear-gradient(145deg,rgba(34,25,18,.98),rgba(9,7,5,.98));
          border:1px solid rgba(224,172,120,.28);
          border-radius:28px;
          padding:30px;
          color:#fff8ef;
          box-shadow:0 35px 100px rgba(0,0,0,.58);
          font-family:inherit;
        ">
          <div style="display:flex;justify-content:space-between;gap:18px;align-items:flex-start;">
            <div>
              <div style="color:#e0ac78;letter-spacing:.18em;text-transform:uppercase;font-size:11px;font-weight:900;">
                Connect Account
              </div>
              <h2 style="margin:10px 0 8px;font-size:30px;font-family:Georgia,serif;">Connect ${title}</h2>
              <p style="margin:0;color:rgba(216,199,180,.72);line-height:1.55;">
                Enter your ${title} username. Clipency will generate a 6-digit verification code valid for 24 hours.
              </p>
            </div>
            <button id="cx-close-connect" style="
              width:40px;height:40px;border-radius:13px;border:1px solid rgba(255,255,255,.12);
              background:rgba(255,255,255,.06);color:white;font-size:24px;cursor:pointer;
            ">×</button>
          </div>

          <label style="display:block;margin-top:22px;color:#e0ac78;font-weight:900;font-size:12px;letter-spacing:.16em;">
            ${title.toUpperCase()} USERNAME
          </label>
          <input id="cx-connect-handle" value="${handle}" placeholder="@yourhandle" style="
            width:100%;margin-top:9px;border-radius:16px;border:1px solid rgba(224,172,120,.38);
            background:rgba(255,255,255,.045);color:#fff8ef;padding:15px 17px;font-size:16px;outline:none;
            box-sizing:border-box;
          ">

          <label style="display:block;margin-top:16px;color:#e0ac78;font-weight:900;font-size:12px;letter-spacing:.16em;">
            PROFILE URL
          </label>
          <input id="cx-connect-url" value="${url}" placeholder="https://..." style="
            width:100%;margin-top:9px;border-radius:16px;border:1px solid rgba(224,172,120,.38);
            background:rgba(255,255,255,.045);color:#fff8ef;padding:15px 17px;font-size:16px;outline:none;
            box-sizing:border-box;
          ">

          <div id="cx-code-box" style="
            display:${showCode ? "block" : "none"};
            margin-top:20px;padding:20px;border-radius:20px;
            border:1px solid rgba(224,172,120,.28);
            background:rgba(224,172,120,.08);
            text-align:center;
          ">
            <div style="font-size:11px;letter-spacing:.18em;color:#e0ac78;font-weight:900;text-transform:uppercase;">
              Your 6-digit verification code
            </div>
            <div id="cx-code-value" style="margin-top:12px;font-size:42px;letter-spacing:.24em;font-weight:900;color:#e0ac78;">
              ${code}
            </div>
            <p style="margin:14px 0 0;color:rgba(216,199,180,.74);line-height:1.5;text-align:left;">
              Paste this code in your ${title} bio/profile for verification. Code expires in 24 hours.
            </p>
          </div>

          ${existing?.status === "verified" ? `
            <div style="margin-top:18px;padding:14px 16px;border-radius:14px;background:rgba(55,220,130,.12);color:#72f0aa;font-weight:900;">
              This ${title} account is connected.
            </div>
          ` : ""}

          ${existing?.status === "rejected" ? `
            <div style="margin-top:18px;padding:14px 16px;border-radius:14px;background:rgba(255,80,80,.1);color:#ffaaaa;font-weight:800;">
              Rejected: ${existing.rejection_reason || "Please update and submit again."}
            </div>
          ` : ""}

          ${existing?.status === "expired" ? `
            <div style="margin-top:18px;padding:14px 16px;border-radius:14px;background:rgba(255,190,80,.1);color:#ffd08a;font-weight:800;">
              Previous code expired. Generate a new one.
            </div>
          ` : ""}

          <button id="cx-submit-connect" style="
            width:100%;margin-top:22px;padding:16px 18px;border-radius:16px;
            border:0;background:#e0ac78;color:#090706;font-weight:900;
            cursor:pointer;font-size:16px;
          ">Generate 6-digit code →</button>
        </div>
      </div>
    `;
  }

  function openModal(platform, existing){
    const old = document.getElementById("cx-connect-modal");
    if(old) old.remove();

    document.body.insertAdjacentHTML("beforeend", modalHtml(platform, existing));

    const modal = document.getElementById("cx-connect-modal");
    modal.querySelector("#cx-close-connect").onclick = () => modal.remove();

    modal.querySelector("#cx-submit-connect").onclick = async () => {
      const handle = clean(modal.querySelector("#cx-connect-handle").value);
      const url = clean(modal.querySelector("#cx-connect-url").value);

      if(!handle){
        alert("Please enter your username.");
        return;
      }

      try{
        const rows = await rpc("clipency_request_connected_account", {
          p_platform: platform,
          p_handle: handle,
          p_profile_url: url
        });

        const account = Array.isArray(rows) ? rows[0] : rows;

        modal.querySelector("#cx-code-box").style.display = "block";
        modal.querySelector("#cx-code-value").textContent = account.verification_code;

        await loadProfileAccounts();

        alert("Verification code generated. Add it to your bio/profile within 24 hours.");
      }catch(error){
        console.error("[Connected Account]", error);
        alert("Could not generate code: " + (error.message || error));
      }
    };
  }

  async function loadProfileAccounts(){
    if(!isProfile()) return;

    let accounts = [];

    try{
      accounts = await rpc("clipency_my_connected_accounts", {});
    }catch(error){
      console.error("[Connected Accounts Load]", error);
      return;
    }

    const byPlatform = {};
    accounts.forEach(a => byPlatform[a.platform] = a);

    platforms.forEach(platform => {
      const row = findPlatformRow(platform);
      const account = byPlatform[platform];
      const btn = findButton(row);

      setSubtitle(row, account);
      setButton(btn, account);

      if(btn && btn.dataset.cxCodeBound !== "true"){
        btn.dataset.cxCodeBound = "true";

        btn.addEventListener("click", function(e){
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          openModal(platform, byPlatform[platform]);
        }, true);
      }
    });
  }

  function boot(){
    loadProfileAccounts();
    setTimeout(loadProfileAccounts, 700);
    setTimeout(loadProfileAccounts, 1600);
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot);
  }else{
    boot();
  }

  window.addEventListener("load", boot);
})();
