(function () {
  if (window.__clipencyAdminCampaignsLoaded) return;
  window.__clipencyAdminCampaignsLoaded = true;

  if (window.location.pathname !== "/admin/campaigns") return;

  let supabaseClient = null;
  let campaigns = [];
  let editingCampaignId = null;

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForSupabase() {
    for (let i = 0; i < 80; i++) {
      if (window.supabaseClient) return window.supabaseClient;
      await wait(80);
    }

    throw new Error("Supabase client not loaded.");
  }

  async function waitForAdminContent() {
    for (let i = 0; i < 80; i++) {
      const content = document.querySelector(".cx-admin-content");
      if (content) return content;
      await wait(80);
    }

    throw new Error("Admin content shell not loaded.");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function money(value) {
    const n = Number(value || 0);
    return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }

  function statusBadge(status) {
    const value = String(status || "draft").toLowerCase();

    if (value === "active") return `<span class="cx-campaign-badge active">Active</span>`;
    if (value === "paused") return `<span class="cx-campaign-badge paused">Paused</span>`;
    if (value === "archived") return `<span class="cx-campaign-badge archived">Archived</span>`;
    return `<span class="cx-campaign-badge draft">Draft</span>`;
  }

  async function fetchCampaigns() {
    const { data, error } = await supabaseClient
      .from("campaigns")
      .select("id,title,category,campaign_type,status,rate_per_million_usd,budget_usd,spent_usd,creators_count,description,requirements,asset_url,content_assets_url,guidelines_url,created_at,updated_at")
      .order("updated_at", { ascending: false });

    if (error) throw error;

    campaigns = data || [];
    return campaigns;
  }

  function campaignStats() {
    const active = campaigns.filter((c) => c.status === "active").length;
    const paused = campaigns.filter((c) => c.status === "paused").length;
    const draft = campaigns.filter((c) => !c.status || c.status === "draft").length;
    const archived = campaigns.filter((c) => c.status === "archived").length;
    const budget = campaigns.reduce((sum, c) => sum + Number(c.budget_usd || 0), 0);
    const spent = campaigns.reduce((sum, c) => sum + Number(c.spent_usd || 0), 0);

    return { active, paused, draft, archived, budget, spent };
  }

  function page() {
    const stats = campaignStats();

    return `
      <div class="cx-admin-kicker">Campaign Control</div>
      <h1 class="cx-admin-title">Campaigns.</h1>
      <p class="cx-admin-subtitle">
        Create, edit and control which campaigns are visible to clippers. Active campaigns are the ones creators can submit to.
      </p>

      <section class="cx-admin-grid cx-campaign-summary-grid">
        <div class="cx-admin-card">
          <h3>Active</h3>
          <strong>${stats.active}</strong>
          <p>Visible to clippers.</p>
        </div>
        <div class="cx-admin-card">
          <h3>Draft / Paused</h3>
          <strong>${stats.draft + stats.paused}</strong>
          <p>Not ready for public submissions.</p>
        </div>
        <div class="cx-admin-card">
          <h3>Total Budget</h3>
          <strong>${money(stats.budget)}</strong>
          <p>Across all campaigns.</p>
        </div>
        <div class="cx-admin-card">
          <h3>Spent</h3>
          <strong>${money(stats.spent)}</strong>
          <p>Tracked campaign spend.</p>
        </div>
      </section>

      <section class="cx-admin-section">
        <div class="cx-admin-section-head cx-campaign-head">
          <div>
            <h2>Campaign library</h2>
            <p>Manage every campaign from one place. Archive instead of deleting when possible.</p>
          </div>

          <button class="cx-admin-button primary" id="cx-new-campaign-btn">Create campaign</button>
        </div>

        <div class="cx-campaign-toolbar">
          <input id="cx-campaign-search" type="search" placeholder="Search campaign, category or status..." />
          <select id="cx-campaign-status-filter">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="paused">Paused</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        <div class="cx-campaign-grid" id="cx-campaign-grid">
          ${campaignCards(campaigns)}
        </div>
      </section>

      <div class="cx-campaign-modal" id="cx-campaign-modal" aria-hidden="true">
        <div class="cx-campaign-modal-card">
          <div class="cx-campaign-modal-head">
            <div>
              <span>CAMPAIGN SETUP</span>
              <h2 id="cx-campaign-modal-title">Create campaign</h2>
              <p>Keep the brief clear. Clippers should instantly understand what to create and how they will be paid.</p>
            </div>
            <button id="cx-campaign-modal-close">×</button>
          </div>

          <form id="cx-campaign-form">
            <div class="cx-campaign-form-grid">
              <label>
                Campaign title
                <input name="title" required placeholder="WoT Heat" />
              </label>

              <label>
                Status
                <select name="status">
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="archived">Archived</option>
                </select>
              </label>

              <label>
                Category
                <input name="category" placeholder="Music" />
              </label>

              <label>
                Type
                <input name="campaign_type" placeholder="Clipping / Edits / Sports" />
              </label>

              <label>
                Rate per 1M views
                <input name="rate_per_million_usd" type="number" min="0" step="0.01" placeholder="1250" />
              </label>

              <label>
                Total budget
                <input name="budget_usd" type="number" min="0" step="0.01" placeholder="10000" />
              </label>

              <label>
                Spent
                <input name="spent_usd" type="number" min="0" step="0.01" placeholder="0" />
              </label>

              <label>
                Creators count
                <input name="creators_count" type="number" min="0" step="1" placeholder="0" />
              </label>

              <label class="wide">
                Asset / reference URL
                <input name="asset_url" placeholder="https://..." />
              </label>

              <label class="wide">
                📂 Content Assets URL (Google Drive)
                <input name="content_assets_url" placeholder="https://drive.google.com/..." />
              </label>

              <label class="wide">
                📜 Campaign Guidelines URL (Notion)
                <input name="guidelines_url" placeholder="https://notion.so/..." />
              </label>

              <label class="wide">
                Description
                <textarea name="description" placeholder="Explain the campaign in one clean paragraph."></textarea>
              </label>

              <label class="wide">
                Requirements
                <textarea name="requirements" placeholder="Mention format, platform, duration, hashtags, link requirements, proof rules, etc."></textarea>
              </label>
            </div>

            <div class="cx-campaign-form-actions">
              <button type="button" id="cx-campaign-cancel">Cancel</button>
              <button type="submit" class="primary">Save campaign</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  function campaignCards(list) {
    if (!list.length) {
      return `<div class="cx-admin-empty">No campaigns yet. Create your first campaign to make it available for operations.</div>`;
    }

    return list.map((campaign) => {
      const status = String(campaign.status || "draft").toLowerCase();
      const remaining = Math.max(Number(campaign.budget_usd || 0) - Number(campaign.spent_usd || 0), 0);
      const progress = Number(campaign.budget_usd || 0) > 0
        ? Math.min(100, (Number(campaign.spent_usd || 0) / Number(campaign.budget_usd || 0)) * 100)
        : 0;

      return `
        <article class="cx-campaign-admin-card" data-campaign-card data-status="${escapeHtml(status)}" data-search="${escapeHtml(`${campaign.title} ${campaign.category} ${campaign.campaign_type} ${status}`.toLowerCase())}">
          <div class="cx-campaign-card-top">
            <div class="cx-campaign-icon">♫</div>
            <div>
              <h3>${escapeHtml(campaign.title || "Untitled Campaign")}</h3>
              <div class="cx-campaign-tags">
                <span>${escapeHtml(campaign.category || "General")}</span>
                <span>${escapeHtml(campaign.campaign_type || "Campaign")}</span>
                ${statusBadge(status)}
              </div>
            </div>
          </div>

          <div class="cx-campaign-metrics">
            <div>
              <span>Rate / 1M views</span>
              <strong>${money(campaign.rate_per_million_usd)}</strong>
            </div>
            <div>
              <span>Remaining</span>
              <strong>${money(remaining)}</strong>
            </div>
          </div>

          <div class="cx-campaign-budget">
            <div>
              <span>Budget used</span>
              <span>${money(campaign.spent_usd)} / ${money(campaign.budget_usd)}</span>
            </div>
            <div class="cx-campaign-budget-bar">
              <i style="width:${progress}%"></i>
            </div>
          </div>

          <p>${escapeHtml(campaign.description || "No description added yet.")}</p>

          <div class="cx-campaign-actions">
            <button data-campaign-edit="${escapeHtml(campaign.id)}">Edit</button>
            ${status !== "active" ? `<button data-campaign-status="active" data-id="${escapeHtml(campaign.id)}">Activate</button>` : ``}
            ${status !== "paused" ? `<button data-campaign-status="paused" data-id="${escapeHtml(campaign.id)}">Pause</button>` : ``}
            ${status !== "archived" ? `<button class="danger" data-campaign-status="archived" data-id="${escapeHtml(campaign.id)}">Archive</button>` : ``}
          </div>
        </article>
      `;
    }).join("");
  }

  function openModal(campaign) {
    editingCampaignId = campaign?.id || null;

    const modal = document.getElementById("cx-campaign-modal");
    const form = document.getElementById("cx-campaign-form");
    const title = document.getElementById("cx-campaign-modal-title");

    if (!modal || !form || !title) return;

    title.textContent = editingCampaignId ? "Edit campaign" : "Create campaign";

    form.title.value = campaign?.title || "";
    form.status.value = campaign?.status || "draft";
    form.category.value = campaign?.category || "Music";
    form.campaign_type.value = campaign?.campaign_type || "Clipping";
    form.rate_per_million_usd.value = campaign?.rate_per_million_usd ?? "";
    form.budget_usd.value = campaign?.budget_usd ?? "";
    form.spent_usd.value = campaign?.spent_usd ?? "";
    form.creators_count.value = campaign?.creators_count ?? "";
    form.asset_url.value = campaign?.asset_url || "";
    form.content_assets_url.value = campaign?.content_assets_url || "";
    form.guidelines_url.value = campaign?.guidelines_url || "";
    form.description.value = campaign?.description || "";
    form.requirements.value = campaign?.requirements || "";

    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    editingCampaignId = null;

    const modal = document.getElementById("cx-campaign-modal");
    if (!modal) return;

    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  }

  async function saveCampaign(event) {
    event.preventDefault();

    const form = event.target;
    const button = form.querySelector("button[type='submit']");

    const payload = {
      title: form.title.value.trim(),
      status: form.status.value,
      category: form.category.value.trim() || "General",
      campaign_type: form.campaign_type.value.trim() || "Campaign",
      rate_per_million_usd: Number(form.rate_per_million_usd.value || 0),
      budget_usd: Number(form.budget_usd.value || 0),
      spent_usd: Number(form.spent_usd.value || 0),
      creators_count: Number(form.creators_count.value || 0),
      asset_url: form.asset_url.value.trim() || null,
      content_assets_url: form.content_assets_url.value.trim() || null,
      guidelines_url: form.guidelines_url.value.trim() || null,
      description: form.description.value.trim() || null,
      requirements: form.requirements.value.trim() || null
    };

    if (!payload.title) {
      alert("Campaign title is required.");
      return;
    }

    try {
      button.disabled = true;
      button.textContent = "Saving…";

      if (editingCampaignId) {
        const { error } = await supabaseClient
          .from("campaigns")
          .update(payload)
          .eq("id", editingCampaignId);

        if (error) throw error;
      } else {
        const { data: userData } = await supabaseClient.auth.getUser();

        const { error } = await supabaseClient
          .from("campaigns")
          .insert({
            ...payload,
            created_by: userData?.user?.id || null
          });

        if (error) throw error;
      }

      closeModal();
      await refresh();
    } catch (error) {
      alert(error.message || "Could not save campaign.");
      button.disabled = false;
      button.textContent = "Save campaign";
    }
  }

  async function updateCampaignStatus(id, status) {
    const { error } = await supabaseClient
      .from("campaigns")
      .update({ status })
      .eq("id", id);

    if (error) throw error;
  }

  function applyFilters() {
    const search = document.getElementById("cx-campaign-search")?.value?.toLowerCase() || "";
    const status = document.getElementById("cx-campaign-status-filter")?.value || "all";

    document.querySelectorAll("[data-campaign-card]").forEach((card) => {
      const matchesSearch = card.dataset.search.includes(search);
      const matchesStatus = status === "all" || card.dataset.status === status;

      card.style.display = matchesSearch && matchesStatus ? "" : "none";
    });
  }

  function bind() {
    document.getElementById("cx-new-campaign-btn")?.addEventListener("click", () => openModal(null));
    document.getElementById("cx-campaign-modal-close")?.addEventListener("click", closeModal);
    document.getElementById("cx-campaign-cancel")?.addEventListener("click", closeModal);
    document.getElementById("cx-campaign-form")?.addEventListener("submit", saveCampaign);

    document.getElementById("cx-campaign-search")?.addEventListener("input", applyFilters);
    document.getElementById("cx-campaign-status-filter")?.addEventListener("change", applyFilters);

    document.querySelectorAll("[data-campaign-edit]").forEach((button) => {
      button.addEventListener("click", () => {
        const campaign = campaigns.find((item) => item.id === button.dataset.campaignEdit);
        openModal(campaign);
      });
    });

    document.querySelectorAll("[data-campaign-status]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = button.dataset.id;
        const status = button.dataset.campaignStatus;

        try {
          if (status === "archived") {
            const ok = confirm("Archive this campaign? It will no longer be visible to clippers.");
            if (!ok) return;
          }

          button.disabled = true;
          await updateCampaignStatus(id, status);
          await refresh();
        } catch (error) {
          alert(error.message || "Could not update campaign.");
          button.disabled = false;
        }
      });
    });
  }

  async function refresh() {
    const content = await waitForAdminContent();

    content.innerHTML = `
      <div class="cx-admin-kicker">Campaign Control</div>
      <h1 class="cx-admin-title">Campaigns.</h1>
      <p class="cx-admin-subtitle">Loading campaign control…</p>
    `;

    try {
      await fetchCampaigns();
      content.innerHTML = page();
      bind();
    } catch (error) {
      content.innerHTML = `
        <section class="cx-admin-section">
          <h2>Campaigns could not load.</h2>
          <p>${escapeHtml(error.message || "Please refresh once.")}</p>
        </section>
      `;
    }
  }

  async function boot() {
    supabaseClient = await waitForSupabase();
    await refresh();
  }

  boot();
})();
