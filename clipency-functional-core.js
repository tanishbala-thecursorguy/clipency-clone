(function () {
  if (window.__clipencyFunctionalCoreLoaded) return;
  window.__clipencyFunctionalCoreLoaded = true;

  const creatorRoutes = ["/dashboard", "/stats", "/payouts"];

  const state = {
    user: null,
    profile: null,
    campaigns: [],
    submissions: [],
    activeFilter: "all",
    selectedCampaign: null
  };

  function isCreatorRoute() {
    return creatorRoutes.includes(window.location.pathname);
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForSupabase() {
    let attempts = 0;

    while (!window.supabaseClient && attempts < 80) {
      await wait(100);
      attempts++;
    }

    if (!window.supabaseClient) {
      throw new Error("Supabase client is not available.");
    }

    return window.supabaseClient;
  }

  function pageRoot() {
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

  function shortNumber(value) {
    const n = Number(value || 0);

    if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 ? 1 : 0)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}K`;

    return String(n);
  }

  function statusBadge(status, row) {
    const value = String(status || "pending").toLowerCase();

    /* A flagged clip is an approved clip with a note from the brand: it sits
       with the approved ones and counts as approved, but says so. */
    if (value === "flagged" || (value === "approved" && row && row.flagged_at)) {
      return `<span class="cx-core-badge green" title="The brand flagged this clip. It still counts as approved.">Flagged</span>`;
    }
    if (value === "approved") return `<span class="cx-core-badge green">Approved</span>`;
    if (value === "rejected") return `<span class="cx-core-badge red">Rejected</span>`;
    if (value === "on_hold") return `<span class="cx-core-badge yellow">On hold</span>`;

    return `<span class="cx-core-badge yellow">Pending review</span>`;
  }

  function payoutBadge(status) {
    const value = String(status || "not_ready").toLowerCase();

    if (value === "paid") return `<span class="cx-core-badge green">Paid</span>`;
    if (value === "payout_pending") return `<span class="cx-core-badge yellow">Payout pending</span>`;
    if (value === "processing") return `<span class="cx-core-badge yellow">Processing</span>`;
    if (value === "failed") return `<span class="cx-core-badge red">Failed</span>`;
    if (value === "rejected") return `<span class="cx-core-badge red">Rejected</span>`;

    return `<span class="cx-core-badge">Not ready</span>`;
  }

  function campaignCategory(campaign) {
    return (
      campaign.category ||
      campaign.platform ||
      (Array.isArray(campaign.tags) && campaign.tags[0]) ||
      "Music"
    );
  }

  function campaignTags(campaign) {
    const raw = [
      campaign.category,
      campaign.platform,
      ...(Array.isArray(campaign.tags) ? campaign.tags : [])
    ].filter(Boolean);

    const unique = [...new Set(raw.map((tag) => String(tag).trim()).filter(Boolean))];

    return unique.length ? unique : ["Music"];
  }

  async function loadContext() {
    const supabase = await waitForSupabase();

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) throw sessionError;

    const session = sessionData?.session;

    if (!session?.user) {
      window.location.href = "/login";
      return;
    }

    state.user = session.user;

    const { data: profile } = await supabase
      .from("profiles")
      .select("id,email,full_name,username,avatar_url,role")
      .eq("id", session.user.id)
      .maybeSingle();

    state.profile = profile || null;

    await Promise.all([loadCampaigns(), loadSubmissions()]);
  }

  async function loadCampaigns() {
    const supabase = await waitForSupabase();

    const { data, error } = await supabase
      .from("campaigns")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    state.campaigns = (data || []).filter((campaign) => {
      return String(campaign.status || "active").toLowerCase() === "active";
    });
  }

  async function loadSubmissions() {
    const supabase = await waitForSupabase();
    const uid = state.user.id;

    const { data, error } = await supabase
      .from("submissions")
      .select("*")
      .or(`clipper_id.eq.${uid},user_id.eq.${uid}`)
      .order("submitted_at", { ascending: false });

    if (error) throw error;

    state.submissions = data || [];
  }

  function totals() {
    const submissions = state.submissions;
    const approved = submissions.filter((s) => s.status === "approved" || s.status === "flagged");
    const pending = submissions.filter((s) => s.status === "pending");
    const rejected = submissions.filter((s) => s.status === "rejected");
    const paid = approved.filter((s) => s.payout_status === "paid");
    const payoutPending = approved.filter((s) => s.payout_status !== "paid");

    return {
      totalSubmissions: submissions.length,
      totalViews: submissions.reduce((sum, s) => sum + Number(s.views || 0), 0),
      approvedViews: approved.reduce((sum, s) => sum + Number(s.views || 0), 0),
      approvedEarnings: approved.reduce((sum, s) => sum + Number(s.earnings || 0), 0),
      paidEarnings: paid.reduce((sum, s) => sum + Number(s.earnings || 0), 0),
      pendingPayout: payoutPending.reduce((sum, s) => sum + Number(s.earnings || 0), 0),
      pendingCount: pending.length,
      approvedCount: approved.length,
      rejectedCount: rejected.length,
      activeCampaigns: new Set(submissions.map((s) => s.campaign_id).filter(Boolean)).size
    };
  }

  function bestCampaigns() {
    const submittedCampaignIds = new Set(state.submissions.map((s) => s.campaign_id).filter(Boolean));

    return [...state.campaigns]
      .sort((a, b) => Number(b.rpm || 0) - Number(a.rpm || 0))
      .filter((campaign) => !submittedCampaignIds.has(campaign.id))
      .slice(0, 3);
  }


  function bindFunctionalSidebarActions() {
    document.querySelectorAll('[data-logout], .logout, .logout-btn, [aria-label="Logout"]').forEach((button) => {
      if (button.dataset.cxLogoutBound) return;
      button.dataset.cxLogoutBound = "true";

      button.addEventListener("click", async (event) => {
        event.preventDefault();

        try {
          const supabase = await waitForSupabase();
          await supabase.auth.signOut();
        } finally {
          window.location.href = "/login";
        }
      });
    });
  }

  function renderShell(root, html) {
    root.innerHTML = `<section class="cx-core-shell">${html}</section>`;
  }

  function renderDashboard(root) {
    const profileName =
      state.profile?.full_name ||
      state.profile?.username ||
      state.user.email?.split("@")[0] ||
      "Creator";

    const handle =
      state.profile?.username ||
      profileName;

    const t = totals();
    const recommended = bestCampaigns();

    renderShell(root, `
      <div class="cx-core-header">
        <div>
          <span class="cx-core-pill">Creator Intelligence</span>
          <h1>Good ${getGreeting()}, ${escapeHtml(profileName)}</h1>
          <p>Track your campaigns, submissions, reviews and payouts from one clean creator workspace.</p>
          <div class="cx-core-actions">
            <a class="cx-core-btn primary" href="/campaigns">Explore campaigns</a>
            <a class="cx-core-btn" href="/stats">Review performance</a>
            <a class="cx-core-btn" href="/profile">Edit profile</a>
          </div>
        </div>

        <div class="cx-core-card" style="min-width:min(360px,100%)">
          <div class="cx-core-campaign-top">
            <div class="cx-core-icon">${profileName[0]?.toUpperCase() || "C"}</div>
            <div>
              <h3>${escapeHtml(profileName)}</h3>
              <p class="cx-core-muted">@${escapeHtml(handle)}</p>
            </div>
          </div>
          <div class="cx-core-grid two" style="margin-top:18px">
            <div class="cx-core-card"><span class="cx-core-muted">Views</span><strong class="cx-core-value">${shortNumber(t.totalViews)}</strong></div>
            <div class="cx-core-card"><span class="cx-core-muted">Earned</span><strong class="cx-core-value">${money(t.approvedEarnings)}</strong></div>
          </div>
        </div>
      </div>

      <div class="cx-core-grid four">
        <div class="cx-core-card"><span class="cx-core-muted">Total views</span><strong class="cx-core-value">${shortNumber(t.totalViews)}</strong><p>Across submitted clips.</p></div>
        <div class="cx-core-card"><span class="cx-core-muted">Approved earnings</span><strong class="cx-core-value">${money(t.approvedEarnings)}</strong><p>Cleared from approved submissions.</p></div>
        <div class="cx-core-card"><span class="cx-core-muted">Pending review</span><strong class="cx-core-value">${t.pendingCount}</strong><p>Clips waiting for review.</p></div>
        <div class="cx-core-card"><span class="cx-core-muted">Campaigns joined</span><strong class="cx-core-value">${t.activeCampaigns}</strong><p>Campaigns you submitted to.</p></div>
      </div>

      <div class="cx-core-grid two" style="margin-top:22px">
        <div class="cx-core-card">
          <div class="cx-core-header" style="margin-bottom:12px">
            <div>
              <span class="cx-core-pill">Recommended</span>
              <h2>Best campaigns</h2>
              <p>Sorted by highest rate per 1M views and campaigns you have not submitted to yet.</p>
            </div>
            <a class="cx-core-btn" href="/campaigns">View all</a>
          </div>
          ${recommended.length ? recommended.map(renderMiniCampaign).join("") : `<div class="cx-core-empty">No new recommendations yet.</div>`}
        </div>

        <div class="cx-core-card">
          <span class="cx-core-pill">Next step</span>
          <h2>What to do now</h2>
          ${nextStepHtml(t)}
        </div>
      </div>
    `);
  }

  function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return "morning";
    if (hour < 17) return "afternoon";
    return "evening";
  }

  function nextStepHtml(t) {
    if (!state.submissions.length) {
      return `
        <p>You have not submitted to any campaign yet. Start with one active campaign and submit a valid proof link.</p>
        <a class="cx-core-btn primary" href="/campaigns">Submit your first clip</a>
      `;
    }

    if (t.pendingCount > 0) {
      return `
        <p>${t.pendingCount} submission${t.pendingCount === 1 ? "" : "s"} are waiting for review. Keep your proof links active until the team verifies them.</p>
        <a class="cx-core-btn" href="/stats">View submissions</a>
      `;
    }

    if (t.pendingPayout > 0) {
      return `
        <p>You have ${money(t.pendingPayout)} approved and waiting for payout processing.</p>
        <a class="cx-core-btn primary" href="/payouts">Track payout</a>
      `;
    }

    return `
      <p>Your current submissions are cleared. The best next move is to submit to another high-RPM campaign.</p>
      <a class="cx-core-btn primary" href="/campaigns">Find next campaign</a>
    `;
  }

  function renderMiniCampaign(campaign) {
    return `
      <div class="cx-core-card" style="margin-top:12px">
        <h3>${escapeHtml(campaign.title || "Campaign")}</h3>
        <div class="cx-core-badges">
          ${campaignTags(campaign).map((tag) => `<span class="cx-core-badge">${escapeHtml(tag)}</span>`).join("")}
          <span class="cx-core-badge green">Active</span>
        </div>
        <p>Rate: <strong>${money(campaign.rpm || 0, campaign.currency || "USD")}</strong> per 1M views</p>
      </div>
    `;
  }

  function renderCampaigns(root) {
    const categories = ["all", ...new Set(state.campaigns.flatMap(campaignTags).map((x) => String(x).toLowerCase()))];

    const filtered = state.activeFilter === "all"
      ? state.campaigns
      : state.campaigns.filter((campaign) => {
          return campaignTags(campaign).map((x) => String(x).toLowerCase()).includes(state.activeFilter);
        });

    renderShell(root, `
      <div class="cx-core-header">
        <div>
          <span class="cx-core-pill">Clipency</span>
          <h1>Campaigns</h1>
          <p>Choose a campaign, submit a valid proof link, and track review status from your stats and payouts pages.</p>
        </div>
        <span class="cx-core-pill">${filtered.length} campaign${filtered.length === 1 ? "" : "s"}</span>
      </div>

      <div class="cx-core-filter-row">
        ${categories.map((category) => `
          <button data-filter="${escapeHtml(category)}" class="${state.activeFilter === category ? "active" : ""}">
            ${category === "all" ? "All" : escapeHtml(titleCase(category))}
          </button>
        `).join("")}
      </div>

      ${filtered.length ? `
        <div class="cx-core-grid">
          ${filtered.map(renderCampaignCard).join("")}
        </div>
      ` : `<div class="cx-core-empty">No active campaigns found in this category.</div>`}

      ${submissionModalHtml()}
    `);

    bindCampaignEvents(root);
  }

  function renderCampaignCard(campaign) {
    const campaignCurrency = campaign.currency || "USD";
    const budget = Number(campaign.budget || 0);
    const budgetUsed = Number(campaign.budget_used || 0);
    const remainingBudget = budget ? Math.max(budget - budgetUsed, 0) : 0;
    const budgetPercent = budget ? Math.min(100, Math.max(0, Math.round((budgetUsed / budget) * 100))) : 0;

    const alreadySubmitted = state.submissions.some((s) => s.campaign_id === campaign.id);

    return `
      <article class="cx-core-card cx-core-campaign-card">
        <div class="cx-core-campaign-top">
          <div class="cx-core-icon">♫</div>
          <div>
            <h3>${escapeHtml(campaign.title || "Campaign")}</h3>
            <div class="cx-core-badges">
              ${campaignTags(campaign).map((tag) => `<span class="cx-core-badge">${escapeHtml(tag)}</span>`).join("")}
              <span class="cx-core-badge green">Active</span>
            </div>
          </div>
        </div>

        <div class="cx-core-spark">
          <svg viewBox="0 0 180 80" aria-hidden="true">
            <path d="M10 62 C 42 54, 62 42, 88 20 S 138 34, 170 8" fill="none" stroke="currentColor" stroke-width="3" opacity=".9"></path>
            <path d="M10 62 C 42 54, 62 42, 88 20 S 138 34, 170 8 L170 80 L10 80 Z" fill="currentColor" opacity=".08"></path>
          </svg>
        </div>

        <p class="cx-core-muted">Rate per 1M views</p>
        <strong class="cx-core-value">${money(campaign.rpm || 0, campaign.currency || "USD")}</strong>

        ${campaign.description ? `<p>${escapeHtml(campaign.description)}</p>` : ""}

        <div class="cx-core-budget-hover">
          ${
            budget
              ? `
                <div class="cx-core-budget-row">
                  <span>Remaining budget</span>
                  <strong>${money(remainingBudget, campaignCurrency)}</strong>
                </div>

                <div class="cx-core-budget-track">
                  <i style="width:${budgetPercent}%"></i>
                </div>

                <div class="cx-core-budget-meta">
                  <span>Used ${money(budgetUsed, campaignCurrency)}</span>
                  <span>Total ${money(budget, campaignCurrency)}</span>
                </div>
              `
              : `
                <div class="cx-core-budget-row">
                  <span>Budget</span>
                  <strong>Not published</strong>
                </div>
              `
          }
        </div>

        <div class="cx-core-actions">
          <button class="cx-core-btn primary" data-submit-campaign="${escapeHtml(campaign.id)}">
            ${alreadySubmitted ? "Submit again" : "Submit proof"}
          </button>
        </div>
      </article>
    `;
  }

  function bindCampaignEvents(root) {
    root.querySelectorAll("[data-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        state.activeFilter = button.dataset.filter;
        renderCampaigns(root);
      });
    });

    root.querySelectorAll("[data-submit-campaign]").forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedCampaign = state.campaigns.find((campaign) => campaign.id === button.dataset.submitCampaign);
        openSubmissionModal();
      });
    });

    const modal = root.querySelector("#cx-submission-modal");
    const form = root.querySelector("#cx-submission-form");

    root.querySelector("[data-close-modal]")?.addEventListener("click", closeSubmissionModal);

    modal?.addEventListener("click", (event) => {
      if (event.target === modal) closeSubmissionModal();
    });

    form?.addEventListener("submit", submitProof);
  }

  function submissionModalHtml() {
    return `
      <div class="cx-core-modal" id="cx-submission-modal">
        <div class="cx-core-modal-card">
          <h2>Submit campaign proof</h2>
          <p class="cx-core-muted">Paste the public link to your post, reel, video or clip. The review team will verify the proof before earnings are approved.</p>

          <form class="cx-core-form" id="cx-submission-form">
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

            <div class="cx-core-actions">
              <button class="cx-core-btn primary" type="submit">Submit proof</button>
              <button class="cx-core-btn" type="button" data-close-modal>Cancel</button>
            </div>

            <div class="cx-core-notice" id="cx-submission-notice"></div>
          </form>
        </div>
      </div>
    `;
  }

  function openSubmissionModal() {
    const modal = document.querySelector("#cx-submission-modal");
    const notice = document.querySelector("#cx-submission-notice");
    if (notice) notice.textContent = "";
    modal?.classList.add("open");
  }

  function closeSubmissionModal() {
    document.querySelector("#cx-submission-modal")?.classList.remove("open");
  }

  async function submitProof(event) {
    event.preventDefault();

    const supabase = await waitForSupabase();
    const form = event.currentTarget;
    const notice = document.querySelector("#cx-submission-notice");
    const button = form.querySelector("button[type='submit']");
    const campaign = state.selectedCampaign;

    if (!campaign) {
      notice.textContent = "Choose a campaign first.";
      return;
    }

    const postUrl = form.post_url.value.trim();

    try {
      const url = new URL(postUrl);

      if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error("Invalid URL.");
      }
    } catch {
      notice.textContent = "Please paste a valid public URL.";
      return;
    }

    button.disabled = true;
    button.textContent = "Submitting…";

    const payload = {
      campaign_id: campaign.id,
      campaign_title: campaign.title || "Campaign",
      clipper_id: state.user.id,
      user_id: state.user.id,
      platform: form.platform.value,
      post_url: postUrl,
      video_url: postUrl,
      status: "pending",
      payout_status: "not_ready",
      review_note: form.note.value.trim() || null,
      submitted_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from("submissions")
      .insert(payload);

    if (error) {
      notice.textContent = error.message || "Submission failed.";
      button.disabled = false;
      button.textContent = "Submit proof";
      return;
    }

    notice.textContent = "Submitted successfully. It is now waiting for review.";
    form.reset();

    await loadSubmissions();

    setTimeout(() => {
      closeSubmissionModal();
      renderCampaigns(pageRoot());
    }, 800);
  }

  function renderStats(root) {
    const t = totals();
    const approvalRate = state.submissions.length
      ? Math.round((t.approvedCount / state.submissions.length) * 100)
      : 0;

    renderShell(root, `
      <div class="cx-core-header">
        <div>
          <span class="cx-core-pill">Performance</span>
          <h1>Your Stats</h1>
          <p>Everything here is calculated from your actual submitted clips and reviewer-approved numbers.</p>
        </div>
      </div>

      <div class="cx-core-grid four">
        <div class="cx-core-card"><span class="cx-core-muted">Total views</span><strong class="cx-core-value">${shortNumber(t.totalViews)}</strong><p>Across all submissions.</p></div>
        <div class="cx-core-card"><span class="cx-core-muted">Approved earnings</span><strong class="cx-core-value">${money(t.approvedEarnings)}</strong><p>From approved clips.</p></div>
        <div class="cx-core-card"><span class="cx-core-muted">Approval rate</span><strong class="cx-core-value">${approvalRate}%</strong><p>Approved submissions ratio.</p></div>
        <div class="cx-core-card"><span class="cx-core-muted">Pending review</span><strong class="cx-core-value">${t.pendingCount}</strong><p>Waiting for verification.</p></div>
      </div>

      <div class="cx-core-card" style="margin-top:22px">
        <h2>Monthly Earnings Breakdown</h2>
        ${earningsChartHtml()}
      </div>

      <div class="cx-core-card" style="margin-top:22px">
        <h2>My Submissions</h2>
        ${submissionTableHtml()}
      </div>
    `);
  }

  function earningsChartHtml() {
    const months = Array.from({ length: 12 }, (_, index) => {
      const d = new Date();
      d.setMonth(d.getMonth() - (11 - index));
      return {
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        label: d.toLocaleString(undefined, { month: "short" }),
        value: 0
      };
    });

    state.submissions
      .filter((s) => s.status === "approved" || s.status === "flagged")
      .forEach((s) => {
        const d = new Date(s.submitted_at || s.created_at || Date.now());
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const item = months.find((m) => m.key === key);
        if (item) item.value += Number(s.earnings || 0);
      });

    const max = Math.max(...months.map((m) => m.value), 1);
    const points = months.map((m, index) => {
      const x = 30 + index * 70;
      const y = 220 - (m.value / max) * 170;
      return `${x},${y}`;
    }).join(" ");

    return `
      <svg class="cx-core-chart" viewBox="0 0 850 260" preserveAspectRatio="none">
        <line x1="30" y1="220" x2="820" y2="220" stroke="rgba(255,255,255,.08)" />
        <line x1="30" y1="150" x2="820" y2="150" stroke="rgba(255,255,255,.08)" />
        <line x1="30" y1="80" x2="820" y2="80" stroke="rgba(255,255,255,.08)" />
        <polyline points="${points}" fill="none" stroke="#8b5cf6" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
        ${points.split(" ").map((point) => {
          const [x, y] = point.split(",");
          return `<circle cx="${x}" cy="${y}" r="5" fill="#a78bfa" />`;
        }).join("")}
        ${months.map((m, i) => `<text x="${30 + i * 70}" y="250" fill="rgba(255,255,255,.45)" font-size="12" text-anchor="middle">${m.label}</text>`).join("")}
      </svg>
    `;
  }

  function submissionTableHtml() {
    if (!state.submissions.length) {
      return `<div class="cx-core-empty">No submissions yet. Submit to a campaign first.</div>`;
    }

    return `
      <div class="cx-core-table-wrap">
        <table class="cx-core-table">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Platform</th>
              <th>Status</th>
              <th>Views</th>
              <th>Earnings</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            ${state.submissions.map((s) => `
              <tr>
                <td>${escapeHtml(s.campaign_title || "Campaign")}</td>
                <td>${escapeHtml(s.platform || "—")}</td>
                <td>${statusBadge(s.status, s)}</td>
                <td>${shortNumber(s.views || 0)}</td>
                <td>${money(s.earnings || 0)}</td>
                <td>${s.submitted_at ? new Date(s.submitted_at).toLocaleDateString() : "—"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderPayouts(root) {
    const t = totals();
    const payoutRows = state.submissions.filter((s) => {
      return s.status === "approved" || s.status === "flagged" || s.status === "rejected";
    });

    renderShell(root, `
      <div class="cx-core-header">
        <div>
          <span class="cx-core-pill">Payouts</span>
          <h1>Payouts</h1>
          <p>Approved clips become payout-ready. Paid payouts appear with their final status once finance clears them.</p>
        </div>
      </div>

      <div class="cx-core-grid three">
        <div class="cx-core-card"><span class="cx-core-muted">Approved earnings</span><strong class="cx-core-value">${money(t.approvedEarnings)}</strong><p>Total approved creator earnings.</p></div>
        <div class="cx-core-card"><span class="cx-core-muted">Pending payout</span><strong class="cx-core-value">${money(t.pendingPayout)}</strong><p>Approved but not marked paid.</p></div>
        <div class="cx-core-card"><span class="cx-core-muted">Paid</span><strong class="cx-core-value">${money(t.paidEarnings)}</strong><p>Already cleared by finance.</p></div>
      </div>

      <div class="cx-core-card" style="margin-top:22px">
        <h2>Payout history</h2>
        ${payoutTableHtml(payoutRows)}
      </div>
    `);
  }

  function payoutTableHtml(rows) {
    if (!rows.length) {
      return `<div class="cx-core-empty">No approved or rejected payout records yet.</div>`;
    }

    return `
      <div class="cx-core-table-wrap">
        <table class="cx-core-table">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Status</th>
              <th>Payout</th>
              <th>Views</th>
              <th>Earnings</th>
              <th>Reviewed</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((s) => `
              <tr>
                <td>${escapeHtml(s.campaign_title || "Campaign")}</td>
                <td>${statusBadge(s.status, s)}</td>
                <td>${payoutBadge(s.payout_status)}</td>
                <td>${shortNumber(s.views || 0)}</td>
                <td>${money(s.earnings || 0)}</td>
                <td>${s.reviewed_at ? new Date(s.reviewed_at).toLocaleDateString() : "—"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function titleCase(value) {
    return String(value)
      .split(/[\s_-]+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  async function boot() {
    if (!isCreatorRoute()) return;

    const root = pageRoot();
    if (!root) return;

    try {
      await loadContext();
      bindFunctionalSidebarActions();

      if (window.location.pathname === "/dashboard") { window.location.replace("/stats"); return; }
      if (window.location.pathname === "/campaigns") renderCampaigns(root);
      if (window.location.pathname === "/stats") renderStats(root);
      if (window.location.pathname === "/payouts") renderPayouts(root);

      window.ClipencyRevealPage?.();
    } catch (error) {
      root.innerHTML = `
        <section class="cx-core-shell">
          <div class="cx-core-card">
            <h2>Could not load this page.</h2>
            <p>${escapeHtml(error.message || "Please refresh once.")}</p>
            <p class="cx-core-muted">Open Console if this repeats. Most likely cause: table field, RLS policy, or auth session mismatch.</p>
          </div>
        </section>
      `;
      console.error("Clipency functional core error:", error);
      window.ClipencyRevealPage?.();
    }
  }

  window.ClipencyFunctionalCore = {
    reload: boot
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 80));
  } else {
    setTimeout(boot, 80);
  }
})();
