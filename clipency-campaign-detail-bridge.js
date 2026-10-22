(function () {
  if (window.__clipencyCampaignDetailBridgeLoaded) return;
  window.__clipencyCampaignDetailBridgeLoaded = true;

  if (window.location.pathname !== "/campaigns") return;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function money(value, currency = "USD") {
    const amount = Number(value || 0);

    if (currency === "INR") {
      return `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
    }

    return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }

  function normaliseTags(campaign) {
    const tags = [];

    if (campaign.category) tags.push(campaign.category);
    if (campaign.platform) tags.push(campaign.platform);

    if (Array.isArray(campaign.tags)) {
      tags.push(...campaign.tags);
    }

    if (typeof campaign.tags === "string") {
      try {
        const parsed = JSON.parse(campaign.tags);
        if (Array.isArray(parsed)) tags.push(...parsed);
      } catch {
        tags.push(campaign.tags);
      }
    }

    const unique = [...new Set(tags.map((tag) => String(tag).trim()).filter(Boolean))];

    return unique.length ? unique : ["Music"];
  }

  function ensureModal() {
    let modal = document.getElementById("cx-old-campaign-detail-modal");

    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "cx-old-campaign-detail-modal";
    modal.className = "cx-old-campaign-detail-modal";
    modal.innerHTML = `
      <div class="cx-old-campaign-detail-card">
        <button class="cx-old-campaign-close" type="button" aria-label="Close campaign details">×</button>
        <div id="cx-old-campaign-detail-body"></div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.addEventListener("click", (event) => {
      if (event.target === modal || event.target.closest(".cx-old-campaign-close")) {
        closeModal();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeModal();
    });

    return modal;
  }

  function openModal() {
    ensureModal().classList.add("open");
  }

  function closeModal() {
    document.getElementById("cx-old-campaign-detail-modal")?.classList.remove("open");
  }

  async function fetchCampaign(campaignId) {
    if (!window.supabaseClient) {
      throw new Error("Supabase client is not ready.");
    }

    const { data, error } = await window.supabaseClient
      .from("campaigns")
      .select("*")
      .eq("id", campaignId)
      .maybeSingle();

    if (error) throw error;

    return data;
  }

  function renderCampaignDetails(campaign, campaignId) {
    const modal = ensureModal();
    const body = modal.querySelector("#cx-old-campaign-detail-body");

    if (!campaign) {
      body.innerHTML = `
        <h2>Campaign details</h2>
        <p class="cx-old-muted">Could not load this campaign. Please refresh once.</p>
      `;
      openModal();
      return;
    }

    const currency = campaign.currency || "USD";
    const budget = Number(campaign.budget || 0);
    const used = Number(campaign.budget_used || 0);
    const remaining = budget ? Math.max(budget - used, 0) : 0;
    const progress = budget ? Math.min(100, Math.max(0, Math.round((used / budget) * 100))) : 0;
    const tags = normaliseTags(campaign);

    body.innerHTML = `
      <div class="cx-old-campaign-head">
        <div class="cx-old-campaign-icon">♫</div>
        <div>
          <span class="cx-old-eyebrow">Campaign details</span>
          <h2>${escapeHtml(campaign.title || "Campaign")}</h2>
          <div class="cx-old-tags">
            ${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
            <span class="green">Active</span>
          </div>
        </div>
      </div>

      <div class="cx-old-campaign-metrics">
        <div>
          <span>Rate per 1M views</span>
          <strong>${money(campaign.rpm || 0, currency)}</strong>
        </div>
        <div>
          <span>Remaining budget</span>
          <strong>${budget ? money(remaining, currency) : "Not published"}</strong>
        </div>
      </div>

      ${
        budget
          ? `
            <div class="cx-old-budget-block">
              <div class="cx-old-budget-track">
                <i style="width:${progress}%"></i>
              </div>
              <div class="cx-old-budget-meta">
                <span>Used ${money(used, currency)}</span>
                <span>Total ${money(budget, currency)}</span>
              </div>
            </div>
          `
          : ""
      }

      <div class="cx-old-section">
        <span>Description</span>
        <p>${escapeHtml(campaign.description || "No description has been added yet.")}</p>
      </div>

      <div class="cx-old-section">
        <span>Requirements</span>
        <p>${escapeHtml(campaign.requirements || "Submit a valid public proof link. Keep the post live until review is complete.")}</p>
      </div>

      <div class="cx-old-actions">
        <button class="cx-old-primary" type="button" data-submit-from-details="${escapeHtml(campaignId)}">Submit proof</button>
        <button class="cx-old-secondary" type="button" data-close-details>Close</button>
      </div>
    `;

    body.querySelector("[data-close-details]")?.addEventListener("click", closeModal);

    body.querySelector("[data-submit-from-details]")?.addEventListener("click", () => {
      closeModal();

      const submitButton = document.querySelector(`[data-submit-campaign="${CSS.escape(campaignId)}"]`);

      if (submitButton) {
        submitButton.click();
      }
    });

    openModal();
  }

  function campaignIdFromCard(card) {
    return (
      card.getAttribute("data-open-campaign") ||
      card.getAttribute("data-campaign-id") ||
      card.querySelector("[data-submit-campaign]")?.getAttribute("data-submit-campaign")
    );
  }

  async function handleCardClick(card) {
    const campaignId = campaignIdFromCard(card);

    if (!campaignId) return;

    const modal = ensureModal();
    modal.querySelector("#cx-old-campaign-detail-body").innerHTML = `
      <h2>Loading campaign…</h2>
      <p class="cx-old-muted">Fetching campaign details.</p>
    `;

    openModal();

    try {
      const campaign = await fetchCampaign(campaignId);
      renderCampaignDetails(campaign, campaignId);
    } catch (error) {
      modal.querySelector("#cx-old-campaign-detail-body").innerHTML = `
        <h2>Could not load details</h2>
        <p class="cx-old-muted">${escapeHtml(error.message || "Please refresh once.")}</p>
      `;
    }
  }

  function bindCards() {
    document.querySelectorAll(".cx-core-campaign-card").forEach((card) => {
      if (card.dataset.cxOldDetailsReady) return;

      card.dataset.cxOldDetailsReady = "true";
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");

      card.addEventListener("click", (event) => {
        if (event.target.closest("button, a, input, select, textarea")) return;
        handleCardClick(card);
      });

      card.addEventListener("keydown", (event) => {
        if (!["Enter", " "].includes(event.key)) return;
        event.preventDefault();
        handleCardClick(card);
      });
    });
  }

  function boot() {
    bindCards();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  new MutationObserver(bindCards).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
