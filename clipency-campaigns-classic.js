(function () {
  if (window.__clipencyCampaignsClassicLoaded) return;
  window.__clipencyCampaignsClassicLoaded = true;

  if (window.location.pathname !== "/campaigns") return;

  const state = {
    user: null,
    profile: null,
    campaigns: [],
    submissions: [],
    filter: "all",
    selected: null
  };

  const creatorFallbacks = {
    "wot heat": 13,
    "we do what we want": 20,
    "la isla bonita": 61,
    "dom dolla [sports]": 16,
    "something 'bout": 12,
    "geometry dash - slowed": 79
  };

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForSupabase() {
    let tries = 0;
    while (!window.supabaseClient && tries < 80) {
      await wait(100);
      tries++;
    }
    if (!window.supabaseClient) throw new Error("Supabase client not ready.");
    return window.supabaseClient;
  }

  function root() {
    return (
      document.querySelector("[data-page-root]") ||
      document.querySelector(".dashboard-content") ||
      document.querySelector(".main-content") ||
      document.querySelector(".page-content") ||
      document.querySelector("main")
    );
  }

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

  function tags(campaign) {
    const raw = [];

    if (campaign.category) raw.push(campaign.category);
    if (campaign.platform) raw.push(campaign.platform);

    if (Array.isArray(campaign.tags)) raw.push(...campaign.tags);

    if (typeof campaign.tags === "string") {
      try {
        const parsed = JSON.parse(campaign.tags);
        if (Array.isArray(parsed)) raw.push(...parsed);
        else raw.push(campaign.tags);
      } catch {
        raw.push(campaign.tags);
      }
    }

    const cleaned = [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))];

    return cleaned.length ? cleaned : ["Music"];
  }

  function creatorCount(campaign) {
    const title = String(campaign.title || "").toLowerCase().trim();

    return (
      campaign.creators_count ||
      campaign.creator_count ||
      campaign.creators ||
      campaign.total_creators ||
      creatorFallbacks[title] ||
      12
    );
  }

  async function load() {
    const supabase = await waitForSupabase();

    const { data: sessionData } = await supabase.auth.getSession();

    if (!sessionData?.session?.user) {
      window.location.href = "/login";
      return;
    }

    state.user = sessionData.session.user;

    const { data: profile } = await supabase
      .from("profiles")
      .select("id,email,full_name,username,avatar_url,role")
      .eq("id", state.user.id)
      .maybeSingle();

    state.profile = profile || null;

    const { data: campaigns, error: campaignError } = await supabase
      .from("campaigns")
      .select("*")
      .order("created_at", { ascending: false });

    if (campaignError) throw campaignError;

    state.campaigns = (campaigns || []).filter((c) => {
      return String(c.status || "active").toLowerCase() === "active";
    });

    const { data: submissions } = await supabase
      .from("submissions")
      .select("*")
      .or(`clipper_id.eq.${state.user.id},user_id.eq.${state.user.id}`)
      .order("submitted_at", { ascending: false });

    state.submissions = submissions || [];
  }

  function filteredCampaigns() {
    if (state.filter === "all") return state.campaigns;

    return state.campaigns.filter((campaign) => {
      return tags(campaign).map((x) => x.toLowerCase()).includes(state.filter);
    });
  }

  function categories() {
    const all = state.campaigns.flatMap(tags).map((x) => x.toLowerCase());
    return ["all", ...new Set(all)];
  }

  function titleCase(value) {
    return String(value)
      .split(/[\s_-]+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  function render() {
    const container = root();
    if (!container) return;

    const campaigns = filteredCampaigns();

    container.innerHTML = `
      <section class="classic-campaigns-shell">
        <div class="classic-campaigns-header">
          <div>
            <div class="classic-eyebrow">CLIPENCY</div>
            <h1>Campaigns</h1>
          </div>
          <div class="classic-campaign-count">${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"}</div>
        </div>

        <div class="classic-filter-row">
          ${categories().map((cat) => `
            <button class="${state.filter === cat ? "active" : ""}" data-classic-filter="${escapeHtml(cat)}">
              ${cat === "all" ? "All" : escapeHtml(titleCase(cat))}
            </button>
          `).join("")}
        </div>

        <div class="classic-campaign-grid">
          ${campaigns.map(cardHtml).join("")}
        </div>

        ${detailsModalHtml()}
        ${submitModalHtml()}
      </section>
    `;

    bind();
    window.ClipencyRevealPage?.();
  }

  function cardHtml(campaign) {
    const campaignTags = tags(campaign);
    const currency = campaign.currency || "USD";
    const budget = Number(campaign.budget || 0);
    const used = Number(campaign.budget_used || 0);
    const remaining = budget ? Math.max(budget - used, 0) : 0;
    const percent = budget ? Math.min(100, Math.max(0, Math.round((used / budget) * 100))) : 0;

    const submitted = state.submissions.some((s) => s.campaign_id === campaign.id);

    return `
      <article class="classic-campaign-card" data-campaign-id="${escapeHtml(campaign.id)}" tabindex="0" role="button">
        <div class="classic-card-top">
          <div class="classic-music-box">♫</div>
          <div class="classic-card-title">
            <h3>${escapeHtml(campaign.title || "Campaign")}</h3>
            <div class="classic-tags">
              ${campaignTags.slice(0, 2).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
              <span class="new">${submitted ? "Submitted" : "New"}</span>
            </div>
          </div>
        </div>

        <div class="classic-sparkline">
          <svg viewBox="0 0 170 90" aria-hidden="true">
            <path d="M14 74 C 38 66, 56 54, 76 36 C 96 18, 110 16, 128 20 C 145 24, 154 19, 162 10"
              fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
            <path d="M14 74 C 38 66, 56 54, 76 36 C 96 18, 110 16, 128 20 C 145 24, 154 19, 162 10 L162 90 L14 90 Z"
              fill="currentColor" opacity="0.12"/>
          </svg>
        </div>

        <div class="classic-card-bottom">
          <div>
            <span>Rate per 1M Views</span>
            <strong>${money(campaign.rpm || 0, currency)}</strong>
          </div>
          <div class="classic-creators">
            <span>Creators</span>
            <strong>${creatorCount(campaign)}</strong>
          </div>
        </div>

        <div class="classic-budget-hover">
          ${
            budget
              ? `
                <div class="classic-budget-row">
                  <span>Remaining budget</span>
                  <strong>${money(remaining, currency)}</strong>
                </div>
                <div class="classic-budget-track">
                  <i style="width:${percent}%"></i>
                </div>
                <div class="classic-budget-meta">
                  <span>Used ${money(used, currency)}</span>
                  <span>Total ${money(budget, currency)}</span>
                </div>
              `
              : `
                <div class="classic-budget-row">
                  <span>Budget</span>
                  <strong>Not published</strong>
                </div>
              `
          }
        </div>
      </article>
    `;
  }

  function detailsModalHtml() {
    return `
      <div class="classic-modal" id="classic-details-modal">
        <div class="classic-details-card">
          <button class="classic-close" type="button" data-close-details>×</button>
          <div id="classic-details-body"></div>
        </div>
      </div>
    `;
  }

  function submitModalHtml() {
    return `
      <div class="classic-modal" id="classic-submit-modal">
        <div class="classic-details-card classic-submit-card">
          <button class="classic-close" type="button" data-close-submit>×</button>
          <h2>Submit proof</h2>
          <p class="classic-muted">Paste the public post, reel, video or clip link. The review team will verify it before earnings are approved.</p>

          <form id="classic-submit-form" class="classic-form">
            <label>
              Platform
              <select name="platform" required>
                <option value="Instagram">Instagram</option>
                <option value="TikTok">TikTok</option>
                <option value="YouTube">YouTube</option>
                <option value="X">X</option>
                <option value="Other">Other</option>
              </select>
            </label>

            <label>
              Proof URL
              <input name="post_url" type="url" placeholder="https://..." required />
            </label>

            <label>
              Note optional
              <textarea name="note" placeholder="Anything the reviewer should know?"></textarea>
            </label>

            <div class="classic-actions">
              <button class="classic-primary" type="submit">Submit proof</button>
              <button class="classic-secondary" type="button" data-close-submit>Cancel</button>
            </div>

            <p class="classic-muted" id="classic-submit-notice"></p>
          </form>
        </div>
      </div>
    `;
  }

  function detailsContent(campaign) {
    const currency = campaign.currency || "USD";
    const budget = Number(campaign.budget || 0);
    const used = Number(campaign.budget_used || 0);
    const remaining = budget ? Math.max(budget - used, 0) : 0;
    const percent = budget ? Math.min(100, Math.max(0, Math.round((used / budget) * 100))) : 0;

    return `
      <div class="classic-detail-head">
        <div class="classic-music-box">♫</div>
        <div>
          <div class="classic-eyebrow">CAMPAIGN DETAILS</div>
          <h2>${escapeHtml(campaign.title || "Campaign")}</h2>
          <div class="classic-tags">
            ${tags(campaign).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
            <span class="new">Active</span>
          </div>
        </div>
      </div>

      <div class="classic-detail-grid">
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
            <div class="classic-detail-budget">
              <div class="classic-budget-track">
                <i style="width:${percent}%"></i>
              </div>
              <div class="classic-budget-meta">
                <span>Used ${money(used, currency)}</span>
                <span>Total ${money(budget, currency)}</span>
              </div>
            </div>
          `
          : ""
      }

      <div class="classic-section">
        <span>Description</span>
        <p>${escapeHtml(campaign.description || "No description has been added yet.")}</p>
      </div>

      <div class="classic-section">
        <span>Requirements</span>
        <p>${escapeHtml(campaign.requirements || "Submit a valid public proof link. Keep the post live until review is complete.")}</p>
      </div>

      <div class="classic-actions">
        <button class="classic-primary" data-open-submit>Submit proof</button>
        <button class="classic-secondary" data-close-details>Close</button>
      </div>
    `;
  }

  function openDetails(campaignId) {
    const campaign = state.campaigns.find((c) => String(c.id) === String(campaignId));
    if (!campaign) return;

    state.selected = campaign;

    const modal = document.getElementById("classic-details-modal");
    const body = document.getElementById("classic-details-body");

    body.innerHTML = detailsContent(campaign);
    modal.classList.add("open");

    body.querySelectorAll("[data-close-details]").forEach((btn) => {
      btn.addEventListener("click", closeDetails);
    });

    body.querySelector("[data-open-submit]")?.addEventListener("click", () => {
      closeDetails();
      openSubmit();
    });
  }

  function closeDetails() {
    document.getElementById("classic-details-modal")?.classList.remove("open");
  }

  function openSubmit() {
    document.getElementById("classic-submit-notice").textContent = "";
    document.getElementById("classic-submit-modal")?.classList.add("open");
  }

  function closeSubmit() {
    document.getElementById("classic-submit-modal")?.classList.remove("open");
  }

  async function submitProof(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const notice = document.getElementById("classic-submit-notice");
    const button = form.querySelector("button[type='submit']");

    if (!state.selected) {
      notice.textContent = "Choose a campaign first.";
      return;
    }

    const url = form.post_url.value.trim();

    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Invalid URL");
    } catch {
      notice.textContent = "Please paste a valid public URL.";
      return;
    }

    button.disabled = true;
    button.textContent = "Submitting…";

    const supabase = await waitForSupabase();

    const payload = {
      campaign_id: state.selected.id,
      campaign_title: state.selected.title || "Campaign",
      clipper_id: state.user.id,
      user_id: state.user.id,
      platform: form.platform.value,
      post_url: url,
      video_url: url,
      status: "pending",
      payout_status: "not_ready",
      review_note: form.note.value.trim() || null,
      submitted_at: new Date().toISOString()
    };

    const { error } = await supabase.from("submissions").insert(payload);

    if (error) {
      notice.textContent = error.message || "Submission failed.";
      button.disabled = false;
      button.textContent = "Submit proof";
      return;
    }

    notice.textContent = "Submitted successfully. Waiting for review.";
    form.reset();

    await load();

    setTimeout(() => {
      closeSubmit();
      render();
    }, 700);
  }

  function bind() {
    document.querySelectorAll("[data-classic-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        state.filter = button.dataset.classicFilter;
        render();
      });
    });

    document.querySelectorAll(".classic-campaign-card").forEach((card) => {
      card.addEventListener("click", () => openDetails(card.dataset.campaignId));

      card.addEventListener("keydown", (event) => {
        if (!["Enter", " "].includes(event.key)) return;
        event.preventDefault();
        openDetails(card.dataset.campaignId);
      });
    });

    document.querySelectorAll("[data-close-details]").forEach((button) => {
      button.addEventListener("click", closeDetails);
    });

    document.querySelectorAll("[data-close-submit]").forEach((button) => {
      button.addEventListener("click", closeSubmit);
    });

    document.getElementById("classic-details-modal")?.addEventListener("click", (event) => {
      if (event.target.id === "classic-details-modal") closeDetails();
    });

    document.getElementById("classic-submit-modal")?.addEventListener("click", (event) => {
      if (event.target.id === "classic-submit-modal") closeSubmit();
    });

    document.getElementById("classic-submit-form")?.addEventListener("submit", submitProof);
  }

  async function boot() {
    const container = root();
    if (!container) return;

    container.innerHTML = `
      <section class="classic-campaigns-shell">
        <div class="classic-loading">Loading campaigns…</div>
      </section>
    `;

    try {
      await load();
      render();
    } catch (error) {
      container.innerHTML = `
        <section class="classic-campaigns-shell">
          <div class="classic-error">
            <h2>Could not load campaigns.</h2>
            <p>${escapeHtml(error.message || "Please refresh once.")}</p>
          </div>
        </section>
      `;
      console.error("Classic campaigns error:", error);
      window.ClipencyRevealPage?.();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 80));
  } else {
    setTimeout(boot, 80);
  }
})();
