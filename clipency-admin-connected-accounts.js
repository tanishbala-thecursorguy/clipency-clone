(function(){
  window.CLIPENCY_ADMIN_CONNECTED_ACCOUNTS = "admin-connected-six-code-v1";

  let rows = [];

  function clean(v){
    return String(v || "").replace(/\s+/g, " ").trim();
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
    return p || "—";
  }

  function statusText(s){
    if(s === "pending") return "Under Verification";
    if(s === "verified") return "Connected";
    if(s === "expired") return "Expired";
    if(s === "rejected") return "Rejected";
    return s || "—";
  }

  function fmtDate(v){
    if(!v) return "—";
    try{
      return new Date(v).toLocaleString();
    }catch(e){
      return "—";
    }
  }

  function getFiltered(){
    const q = clean(document.getElementById("search")?.value).toLowerCase();
    const platform = document.getElementById("platform")?.value || "all";
    const status = document.getElementById("status")?.value || "all";

    return rows.filter(r => {
      const blob = [
        r.creator_name,
        r.creator_email,
        r.platform,
        r.handle,
        r.profile_url,
        r.verification_code,
        r.status
      ].join(" ").toLowerCase();

      if(q && !blob.includes(q)) return false;
      if(platform !== "all" && r.platform !== platform) return false;
      if(status !== "all" && r.status !== status) return false;

      return true;
    });
  }

  function updateMetrics(){
    document.getElementById("metric-total").textContent = rows.length;
    document.getElementById("metric-pending").textContent = rows.filter(r => r.status === "pending").length;
    document.getElementById("metric-verified").textContent = rows.filter(r => r.status === "verified").length;
    document.getElementById("metric-closed").textContent = rows.filter(r => r.status === "rejected" || r.status === "expired").length;
  }

  function render(){
    updateMetrics();

    const data = getFiltered();
    const area = document.getElementById("table-area");

    if(!data.length){
      area.className = "empty";
      area.innerHTML = "No connected account requests found.";
      return;
    }

    area.className = "";

    area.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Creator</th>
            <th>Platform</th>
            <th>Username</th>
            <th>Code</th>
            <th>Expires</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(r => `
            <tr>
              <td>
                ${r.creator_name || "Creator"}
                <span class="muted">${r.creator_email || ""}</span>
              </td>
              <td>${labelPlatform(r.platform)}</td>
              <td>
                @${r.handle || "—"}
                <span class="muted">${r.profile_url ? `<a href="${r.profile_url}" target="_blank">Open profile ↗</a>` : "No profile URL"}</span>
              </td>
              <td><span class="code">${r.verification_code || "—"}</span></td>
              <td>
                ${fmtDate(r.expires_at)}
                <span class="muted">Generated: ${fmtDate(r.created_at)}</span>
              </td>
              <td><span class="pill ${r.status}">${statusText(r.status)}</span></td>
              <td>
                <div class="actions">
                  ${r.status !== "verified" ? `<button class="mini verify" data-verify="${r.id}">Verify</button>` : ""}
                  ${r.status !== "rejected" ? `<button class="mini reject" data-reject="${r.id}">Reject</button>` : ""}
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    area.querySelectorAll("[data-verify]").forEach(btn => {
      btn.onclick = async () => {
        if(!confirm("Mark this account as connected?")) return;

        try{
          await rpc("clipency_admin_verify_connected_account", {
            p_account_id: btn.dataset.verify
          });
          await load();
        }catch(error){
          alert("Verify failed: " + (error.message || error));
        }
      };
    });

    area.querySelectorAll("[data-reject]").forEach(btn => {
      btn.onclick = async () => {
        const reason = prompt("Reason for rejection:", "Verification code not found in profile/bio.");
        if(reason === null) return;

        try{
          await rpc("clipency_admin_reject_connected_account", {
            p_account_id: btn.dataset.reject,
            p_reason: reason
          });
          await load();
        }catch(error){
          alert("Reject failed: " + (error.message || error));
        }
      };
    });
  }

  async function load(){
    const area = document.getElementById("table-area");

    try{
      {
  const client = window.clipencySupabase||window.supabaseClient;
  const{data,error}=await client
    .from('connected_accounts')
    .select('id,user_id,platform,handle,username,verification_code,connected_accounts.status,rejection_reason,created_at,expires_at,verified_at,is_verified,profiles(email,full_name)')
    .order('created_at',{ascending:false});
  if(error)throw error;
  rows=(data||[]).map(r=>({...r,status:r.status,creator_email:r.profiles?.email,creator_name:r.profiles?.full_name}));
}
      render();
    }catch(error){
      area.className = "empty";
      area.innerHTML = "Could not load connected accounts: " + (error.message || error);
    }
  }

  function bind(){
    ["search","platform","status"].forEach(id => {
      const el = document.getElementById(id);
      if(el) el.addEventListener("input", render);
      if(el) el.addEventListener("change", render);
    });

    const refresh = document.getElementById("refresh");
    if(refresh) refresh.onclick = load;
  }

  bind();
  load();
})();
