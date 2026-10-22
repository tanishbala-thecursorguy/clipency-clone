(function () {
  let booted = false;

  function supabase() {
    return window.supabaseClient;
  }

  function setContent(html) {
    const target = document.getElementById("admin-content");
    if (target) target.innerHTML = html;
  }

  function setHeader(title, subtitle) {
    document.getElementById("admin-title").textContent = title;
    document.getElementById("admin-subtitle").textContent = subtitle;
  }

  function pathMode() {
    const path = window.location.pathname;

    if (path.includes("/campaigns")) return "campaigns";
    if (path.includes("/leads")) return "leads";
    if (path.includes("/payouts")) return "payouts";
    if (path.includes("/users")) return "users";

    return "home";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safe(value, fallback = "—") {
    return value === null || value === undefined || value === "" ? fallback : value;
  }

  function money(value) {
    const num = Number(value || 0);
    return `$${num.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }

  async function selectTable(table, columns = "*", options = {}) {
    try {
      let query = supabase().from(table).select(columns);

      if (options.order) {
        query = query.order(options.order.column, { ascending: options.order.ascending });
      }

      if (options.limit) {
        query = query.limit(options.limit);
      }

      const { data, error } = await query;
      if (error) return [];

      return data || [];
    } catch {
      return [];
    }
  }

  async function countTable(table) {
    try {
      const { count, error } = await supabase()
        .from(table)
        .select("*", { count: "exact", head: true });

      if (error) return 0;
      return count || 0;
    } catch {
      return 0;
    }
  }

  async function renderStats() {
    const [submissions, leads, campaigns, profiles] = await Promise.all([
      countTable("submissions"),
      countTable("contact_leads"),
      countTable("campaigns"),
      countTable("profiles")
    ]);

    document.getElementById("admin-stats").innerHTML = `
      <div class="staff-stat"><span>Submissions</span><strong>${submissions}</strong></div>
      <div class="staff-stat"><span>Client Leads</span><strong>${leads}</strong></div>
      <div class="staff-stat"><span>Campaigns</span><strong>${campaigns}</strong></div>
      <div class="staff-stat"><span>Users</span><strong>${profiles}</strong></div>
    `;
  }

  function setActiveNav(mode) {
    document.querySelectorAll(".staff-nav a").forEach((link) => {
      link.classList.remove("active");

      if (mode === "home" && link.getAttribute("href") === "/admin") link.classList.add("active");
      if (mode === "campaigns" && link.href.includes("/campaigns")) link.classList.add("active");
      if (mode === "leads" && link.href.includes("/leads")) link.classList.add("active");
      if (mode === "payouts" && link.href.includes("/payouts")) link.classList.add("active");
      if (mode === "users" && link.href.includes("/users")) link.classList.add("active");
    });
  }

  async function renderHome() {
    setHeader("Platform operations.", "A calm command center for the work that keeps Clipency moving.");

    const submissions = await selectTable("submissions", "*", {
      order: { column: "submitted_at", ascending: false },
      limit: 5
    });

    const leads = await selectTable("contact_leads", "*", {
      order: { column: "created_at", ascending: false },
      limit: 4
    });

    const pending = submissions.filter((s) => String(s.status || "pending").toLowerCase().includes("pending")).length;
    const approvedValue = submissions
      .filter((s) => String(s.status || "").toLowerCase().includes("approved"))
      .reduce((sum, s) => sum + Number(s.earnings || 0), 0);

    setContent(`
      <div class="staff-page-subnav">
        <a class="active" href="/admin">Overview</a>
        <a href="/review">Review Queue</a>
        <a href="/admin/leads">Client Leads</a>
        <a href="/admin/users">Access Control</a>
      </div>

      <section class="admin-panel">
        <div class="eyebrow">LIVE OPERATING LAYER</div>
        <h2>What needs attention today</h2>

        <div class="module-status-grid">
          <div class="module-status-card">
            <span>Pending review</span>
            <strong>${pending}</strong>
            <p>Clips waiting for someone to verify and clear them.</p>
          </div>

          <div class="module-status-card">
            <span>Approved value</span>
            <strong>${money(approvedValue)}</strong>
            <p>Approved creator value that finance can act on.</p>
          </div>

          <div class="module-status-card">
            <span>New leads</span>
            <strong>${leads.length}</strong>
            <p>Fresh client interest waiting for follow-up.</p>
          </div>
        </div>
      </section>

      <div class="admin-two" style="margin-top:18px">
        <a class="admin-panel" href="/review">
          <div class="eyebrow">REVIEW QUEUE</div>
          <h2>Review submitted clips</h2>
          <p>Verify proof, update metrics and clear the review queue with confidence.</p>
        </a>

        <a class="admin-panel" href="/admin/leads">
          <div class="eyebrow">CLIENT PIPELINE</div>
          <h2>View campaign inquiries</h2>
          <p>Every serious campaign inquiry lands here so the team can follow up quickly.</p>
        </a>

        <a class="admin-panel" href="/admin/campaigns">
          <div class="eyebrow">CAMPAIGNS</div>
          <h2>Campaign management</h2>
          <p>See the campaign layer now; creation and edit controls can be wired next.</p>
        </a>

        <a class="admin-panel" href="/admin/users">
          <div class="eyebrow">ACCESS</div>
          <h2>User roles</h2>
          <p>Invite reviewers, add admins and keep access clean before the team grows.</p>
        </a>
      </div>
    `);
  }

  async function renderLeads() {
    setHeader("Client leads.", "People who reached out from the website, organised for follow-up.");
    setContent(`<div class="staff-card loading-card">Loading leads securely…</div>`);

    const leads = await selectTable("contact_leads", "*", {
      order: { column: "created_at", ascending: false }
    });

    if (!leads.length) {
      setContent(`
        <section class="admin-panel">
          <div class="eyebrow">CLIENT PIPELINE</div>
          <h2>No leads yet.</h2>
          <p>When someone submits the contact form from the landing page, it will appear here.</p>
        </section>
      `);
      return;
    }

    setContent(`
      <section class="admin-list">
        ${leads.map((lead) => `
          <article class="admin-panel">
            <div class="review-head">
              <div>
                <h3>${escapeHtml(safe(lead.full_name, "Lead"))}</h3>
                <p>
                  ${escapeHtml(safe(lead.email, "No email"))}
                  · ${escapeHtml(safe(lead.company, "No company"))}
                  · ${escapeHtml(safe(lead.budget_range, "No budget"))}
                </p>
              </div>
              <span class="badge">${escapeHtml(safe(lead.status, "new"))}</span>
            </div>

            <p><strong>Goal:</strong> ${escapeHtml(safe(lead.campaign_goal, "Not specified"))}</p>
            <p>${escapeHtml(safe(lead.message, "No message added."))}</p>
            <p class="review-meta">Received: ${lead.created_at ? new Date(lead.created_at).toLocaleString() : "Unknown"}</p>
          </article>
        `).join("")}
      </section>
    `);
  }

  async function renderUsers() {
    setHeader("Access control.", "Invite reviewers or change existing user roles.");

    const profiles = await selectTable("profiles", "id,email,full_name,username,role,created_at", {
      order: { column: "created_at", ascending: false },
      limit: 20
    });

    setContent(`
      <section class="admin-panel">
        <div class="eyebrow">INVITE ACCESS</div>
        <h2>Add admin or reviewer email</h2>
        <p>Invite someone before they join, or update an existing teammate’s role instantly.</p>

        <div class="admin-two">
          <input class="admin-input" id="access-email" placeholder="person@example.com" />
          <select class="admin-select" id="access-role">
            <option value="reviewer">Reviewer</option>
            <option value="admin">Admin</option>
            <option value="clipper">Clipper</option>
          </select>
        </div>

        <div class="review-actions" style="margin-top:14px">
          <button class="action-btn primary" id="invite-btn">Save invite</button>
          <button class="action-btn" id="update-role-btn">Update existing user</button>
        </div>

        <p id="access-message"></p>
      </section>

      <section class="admin-panel" style="margin-top:18px">
        <div class="eyebrow">RECENT USERS</div>
        <h2>Role visibility</h2>

        <div class="admin-list" style="margin-top:16px">
          ${profiles.map((profile) => `
            <div class="module-status-card">
              <span>${escapeHtml(profile.role || "clipper")}</span>
              <strong>${escapeHtml(profile.full_name || profile.username || profile.email || "User")}</strong>
              <p>${escapeHtml(profile.email || "No email")}</p>
            </div>
          `).join("") || `<p>No users found.</p>`}
        </div>
      </section>
    `);

    document.getElementById("invite-btn").addEventListener("click", async () => {
      await saveAccess(false);
    });

    document.getElementById("update-role-btn").addEventListener("click", async () => {
      await saveAccess(true);
    });
  }

  async function saveAccess(updateExisting) {
    const email = document.getElementById("access-email").value.trim();
    const role = document.getElementById("access-role").value;
    const msg = document.getElementById("access-message");

    if (!email) {
      msg.textContent = "Enter an email first.";
      return;
    }

    msg.textContent = "Saving…";

    const rpc = updateExisting ? "set_user_role_by_email" : "invite_access";
    const args = updateExisting
      ? { target_email: email, new_role: role }
      : { invite_email: email, invite_role: role };

    const { data, error } = await supabase().rpc(rpc, args);

    if (error) {
      msg.textContent = error.message;
      return;
    }

    msg.textContent = data?.message || "Saved.";
  }

  async function renderCampaigns() {
    setHeader("Campaign management.", "Keep campaign finance, status and operations visible while we prepare full controls.");

    const campaigns = await selectTable("campaigns", "*", {
      order: { column: "created_at", ascending: false }
    });

    setContent(`
      <section class="admin-list">
        ${campaigns.map((campaign) => `
          <article class="admin-panel">
            <div class="review-head">
              <div>
                <h3>${escapeHtml(campaign.title || campaign.name || "Campaign")}</h3>
                <p>${escapeHtml(campaign.brand_name || campaign.client || "No brand")} · ${escapeHtml(campaign.currency || "USD")}</p>
              </div>
              <span class="badge">${escapeHtml(campaign.status || "active")}</span>
            </div>
            <p>${escapeHtml(campaign.description || campaign.rules || "No description added.")}</p>
          </article>
        `).join("") || `
          <article class="admin-panel">
            <div class="eyebrow">COMING NEXT</div>
            <h2>No campaigns found.</h2>
            <p>The campaign manager shell is ready. Next we can add create/edit campaign controls.</p>
          </article>
        `}
      </section>
    `);
  }

  async function renderPayouts() {
    setHeader("Payout operations.", "See approved creator value and what may need payout attention next.");

    const submissions = await selectTable("submissions", "*", {
      order: { column: "submitted_at", ascending: false }
    });

    const approved = submissions.filter((s) => String(s.status || "").toLowerCase().includes("approved"));

    setContent(`
      <section class="admin-list">
        ${approved.map((submission) => `
          <article class="admin-panel">
            <div class="review-head">
              <div>
                <h3>${escapeHtml(submission.campaign_title || submission.title || "Approved submission")}</h3>
                <p>${escapeHtml(submission.user_email || submission.creator_email || submission.clipper_id || "Creator")} · ${Number(submission.views || 0).toLocaleString()} views</p>
              </div>
              <span class="badge approved">${money(submission.earnings || 0)}</span>
            </div>
            <p>${escapeHtml(submission.review_note || "No admin note added.")}</p>
          </article>
        `).join("") || `
          <article class="admin-panel">
            <div class="eyebrow">PAYOUTS</div>
            <h2>No approved payouts yet.</h2>
            <p>Approved submissions with earnings will appear here.</p>
          </article>
        `}
      </section>
    `);
  }

  async function boot() {
    if (booted) return;
    booted = true;

    const mode = pathMode();
    setActiveNav(mode);

    const access = await window.ClipencyAccess.requireRole(["admin"]);
    if (!access) return;

    await renderStats();

    try {
      if (mode === "home") await renderHome();
      else if (mode === "leads") await renderLeads();
      else if (mode === "users") await renderUsers();
      else if (mode === "campaigns") await renderCampaigns();
      else if (mode === "payouts") await renderPayouts();
    } catch (error) {
      setContent(`
        <section class="admin-panel">
          <h2>Could not load this admin page.</h2>
          <p>${escapeHtml(error.message || "Unknown error.")}</p>
        </section>
      `);
    }
  }

  function bootWhenReady() {
    if (!window.ClipencyAccess || !window.supabaseClient) {
      setTimeout(bootWhenReady, 120);
      return;
    }

    boot();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootWhenReady);
  } else {
    bootWhenReady();
  }
})();
