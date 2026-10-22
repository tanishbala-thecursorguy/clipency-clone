
(function () {
  const state = {
    campaigns: [],
    submissions: [],
    leaderboard: [],
    activeCampaignId: null,
    activeFilter: "All",
    user: null,
    loaded: false
  };

  function sb() {
    return window.supabaseClient || null;
  }

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function money(value) {
    return "$" + num(value).toLocaleString(undefined, {
      maximumFractionDigits: 2
    });
  }

  function shortNum(value) {
    const n = num(value);
    if (n >= 1000000000) return (n / 1000000000).toFixed(1).replace(".0", "") + "B";
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(".0", "") + "M";
    if (n >= 1000) return (n / 1000).toFixed(1).replace(".0", "") + "K";
    return String(Math.round(n));
  }

  function sameId(a, b) {
    return String(a ?? "").trim() === String(b ?? "").trim();
  }

  function isApproved(row) {
    const status = String(row?.status || "").toLowerCase();
    return status === "approved" || status === "paid" || status.includes("approved");
  }

  function initials(name) {
    return String(name || "Creator")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0])
      .join("")
      .toUpperCase() || "CR";
  }

  function normalizeCampaign(row) {
    return {
      raw: row,
      id: row.id,
      title: row.title || row.campaign_title || "Untitled Campaign",
      category: row.category || row.genre || "General",
      type: row.campaign_type || row.type || "Clipping",
      status: row.status || "active",
      rate: num(row.rate_per_million_usd ?? row.rate_per_1m_views ?? row.rpm ?? row.rate ?? 0),
      budget: num(row.budget_usd ?? row.total_budget ?? row.budget ?? 0),
      spent: num(row.spent_usd ?? row.spent ?? 0),
      manualCreators: num(row.creators_count ?? row.creators ?? 0),
      description: row.description || "No description added yet.",
      requirements: row.requirements || "No requirements added yet.",
      assetUrl: row.asset_url || row.reference_url || row.asset || "",
      platforms: row.platforms || row.platform || "Instagram, TikTok, YouTube Shorts",
      createdAt: row.created_at || row.updated_at || ""
    };
  }

  function campaignSubmissions(campaign) {
    return state.submissions.filter(row => {
      return sameId(row.campaign_id, campaign.id) ||
             sameId(row.campaign, campaign.id) ||
             String(row.campaign_title || "").trim().toLowerCase() === campaign.title.trim().toLowerCase();
    });
  }

  function approvedSubmissions(campaign) {
    return campaignSubmissions(campaign).filter(isApproved);
  }

  function submissionViews(row) {
    return num(row.views ?? row.total_views ?? row.view_count ?? row.approved_views ?? 0);
  }

  function submissionEarnings(row, campaign) {
    const stored = num(row.earnings ?? row.amount ?? row.payout_amount ?? row.approved_earnings ?? 0);
    if (stored > 0) return stored;
    return (submissionViews(row) * num(campaign.rate)) / 1000000;
  }

  function buildTopPerformers(campaign) {
    const fromView = state.leaderboard
      .filter(row => sameId(row.campaign_id, campaign.id))
      .map(row => ({
        name: row.creator_name || row.name || row.email || row.user_id || "Creator",
        handle: row.handle || row.creator_handle || "",
        views: num(row.total_views ?? row.views ?? 0),
        earnings: num(row.total_earnings ?? row.earnings ?? 0),
        avatar: initials(row.creator_name || row.name || row.email || row.user_id)
      }));

    if (fromView.length) {
      return fromView
        .sort((a, b) => b.views - a.views || b.earnings - a.earnings)
        .slice(0, 5);
    }

    const grouped = new Map();

    approvedSubmissions(campaign).forEach(row => {
      const key = String(
        row.user_id ||
        row.creator_id ||
        row.profile_id ||
        row.email ||
        row.user_email ||
        row.creator_email ||
        row.name ||
        row.id
      );

      if (!grouped.has(key)) {
        const displayName =
          row.creator_name ||
          row.full_name ||
          row.name ||
          row.user_name ||
          row.email ||
          row.user_email ||
          "Creator " + key.slice(0, 6);

        grouped.set(key, {
          name: displayName,
          handle: row.handle || row.username || row.email || "",
          views: 0,
          earnings: 0,
          avatar: initials(displayName)
        });
      }

      const item = grouped.get(key);
      item.views += submissionViews(row);
      item.earnings += submissionEarnings(row, campaign);
    });

    return Array.from(grouped.values())
      .sort((a, b) => b.views - a.views || b.earnings - a.earnings)
      .slice(0, 5);
  }

  function campaignStats(campaign) {
    const approved = approvedSubmissions(campaign);
    const all = campaignSubmissions(campaign);
    const top = buildTopPerformers(campaign);

    const totalViews = approved.reduce((sum, row) => sum + submissionViews(row), 0);
    const approvedEarnings = approved.reduce((sum, row) => sum + submissionEarnings(row, campaign), 0);

    const spent = campaign.spent > 0 ? campaign.spent : approvedEarnings;
    const progress = campaign.budget > 0
      ? Math.min(100, Math.max(0, (spent / campaign.budget) * 100))
      : 0;

    return {
      allSubmissions: all.length,
      approvedSubmissions: approved.length,
      totalViews,
      approvedEarnings,
      spent,
      progress,
      creatorsCount: top.length,
      top
    };
  }

  async function fetchCampaigns() {
    const client = sb();
    if (!client) return [];

    const { data, error } = await client
      .from("campaigns")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("Campaign fetch failed:", error.message);
      return [];
    }

    return (data || []).map(normalizeCampaign);
  }

  async function fetchSubmissions() {
    const client = sb();
    if (!client) return [];

    const { data, error } = await client
      .from("submissions")
      .select("*");

    if (error) {
      console.warn("Submissions fetch failed:", error.message);
      return [];
    }

    return data || [];
  }

  async function fetchLeaderboardView() {
    const client = sb();
    if (!client) return [];

    const { data, error } = await client
      .from("campaign_leaderboard_public")
      .select("*");

    if (error) {
      return [];
    }

    return data || [];
  }

  async function loadCampaignData() {
    const client = sb();
    if (!client) return;

    try {
      const sessionResult = await client.auth.getSession();
      state.user = sessionResult?.data?.session?.user || null;
    } catch (_) {}

    const [campaigns, submissions, leaderboard] = await Promise.all([
      fetchCampaigns(),
      fetchSubmissions(),
      fetchLeaderboardView()
    ]);

    state.campaigns = campaigns;
    state.submissions = submissions;
    state.leaderboard = leaderboard;
    state.loaded = true;
  }

  function renderCards() {
    const grid = document.getElementById("campaign-grid");
    const detail = document.getElementById("campaign-detail");
    const count = document.getElementById("campaign-count");

    if (!grid) return;

    if (detail) {
      detail.classList.add("hidden");
      detail.innerHTML = "";
    }

    grid.style.display = "";

    const campaigns = state.campaigns.filter(campaign => {
      if (state.activeFilter === "All") return true;

      const key = state.activeFilter.toLowerCase();
      return campaign.category.toLowerCase() === key ||
             campaign.type.toLowerCase() === key;
    });

    if (count) {
      count.textContent = `${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"}`;
    }

    if (!campaigns.length) {
      grid.innerHTML = `
        <div class="card" style="grid-column:1/-1;text-align:center;padding:40px">
          <h3>No campaigns found</h3>
          <p style="color:rgba(255,255,255,.55);margin-top:8px">Create or activate campaigns from the admin dashboard.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = campaigns.map(campaign => {
      const stats = campaignStats(campaign);
      const status = String(campaign.status || "active").toLowerCase();

      return `
        <div class="campaign-card" data-id="${esc(campaign.id)}">
          <div class="card-icon">♫</div>

          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px">
            <h3 class="campaign-title">${esc(campaign.title)}</h3>
            <span class="tag ${status === "active" ? "active" : ""}">${esc(campaign.status)}</span>
          </div>

          <p style="color:rgba(255,255,255,.48);font-weight:700;margin-bottom:18px">
            ${esc(campaign.category)} · ${esc(campaign.type)}
          </p>

          <div class="card-meta">
            <span>Rate per 1M views</span>
            <strong style="color:#22C55E">${money(campaign.rate)}</strong>
          </div>

          <div class="card-meta">
            <span>Total budget</span>
            <strong style="color:#FACC15">${money(campaign.budget)}</strong>
          </div>

          <div class="card-meta">
            <span>Approved creators</span>
            <strong style="color:#A78BFA">${stats.creatorsCount}</strong>
          </div>

          <div class="card-meta">
            <span>Spent</span>
            <strong>${money(stats.spent)}</strong>
          </div>

          <div style="height:8px;background:rgba(255,255,255,.08);border-radius:999px;margin-top:18px;overflow:hidden">
            <div style="height:100%;width:${stats.progress}%;background:linear-gradient(90deg,#7C3AED,#22C55E);border-radius:999px"></div>
          </div>

          <div style="display:flex;justify-content:space-between;color:rgba(255,255,255,.45);font-size:12px;margin-top:8px">
            <span>${Math.round(stats.progress)}% used</span>
            <span>${money(stats.spent)} / ${money(campaign.budget)}</span>
          </div>
        </div>
      `;
    }).join("");

    grid.querySelectorAll(".campaign-card").forEach(card => {
      card.addEventListener("click", () => {
        state.activeCampaignId = card.dataset.id;
        renderCampaigns();
      });
    });
  }

  function renderDetail(campaign) {
    const grid = document.getElementById("campaign-grid");
    const detail = document.getElementById("campaign-detail");
    if (!detail) return;

    const stats = campaignStats(campaign);
    const requirements = String(campaign.requirements || "")
      .split(/\n|•|,/)
      .map(item => item.trim())
      .filter(Boolean);

    if (grid) grid.style.display = "none";
    detail.classList.remove("hidden");

    detail.innerHTML = `
      <button class="back-btn" style="margin-bottom:24px">← Back to campaigns</button>

      <div style="display:grid;grid-template-columns:minmax(280px,.9fr) 1.4fr;gap:28px;margin-bottom:36px">
        <div class="card card-purple">
          <div class="card-icon">♫</div>
          <h2 style="margin-top:18px">${esc(campaign.title)}</h2>
          <p style="color:rgba(255,255,255,.48);font-weight:700">${esc(campaign.category)} · ${esc(campaign.type)}</p>

          <div style="margin-top:26px;display:grid;gap:14px">
            <div class="detail-stat"><span class="detail-stat-label">Rate per 1M Views</span><span class="detail-stat-value" style="color:#22C55E">${money(campaign.rate)}</span></div>
            <div class="detail-stat"><span class="detail-stat-label">Total Budget</span><span class="detail-stat-value" style="color:#FACC15">${money(campaign.budget)}</span></div>
            <div class="detail-stat"><span class="detail-stat-label">Spent</span><span class="detail-stat-value">${money(stats.spent)}</span></div>
            <div class="detail-stat"><span class="detail-stat-label">Approved Creators</span><span class="detail-stat-value" style="color:#A78BFA">${stats.creatorsCount}</span></div>
            <div class="detail-stat"><span class="detail-stat-label">Status</span><span class="detail-stat-value">${esc(campaign.status)}</span></div>
          </div>

          ${campaign.assetUrl ? `<a href="${esc(campaign.assetUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:20px">Open asset / reference</a>` : ""}
        </div>

        <div class="card card-purple">
          <p style="color:rgba(255,255,255,.45);font-size:12px;margin-bottom:4px">Total Views Generated</p>
          <h1 style="font-size:42px;margin-bottom:8px">${shortNum(stats.totalViews)}</h1>
          <p style="color:#22C55E;font-weight:800;margin-bottom:30px">Approved campaign performance</p>

          <svg viewBox="0 0 700 180" style="width:100%;height:180px;margin-bottom:24px" preserveAspectRatio="none">
            <defs>
              <linearGradient id="cxAlgoGradient" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stop-color="rgba(34,197,94,.4)"/>
                <stop offset="100%" stop-color="rgba(34,197,94,0)"/>
              </linearGradient>
            </defs>
            <polyline fill="none" stroke="rgba(34,197,94,.95)" stroke-width="4" points="0,145 90,132 180,118 270,96 360,80 450,62 560,40 700,22"/>
            <polygon fill="url(#cxAlgoGradient)" points="0,180 0,145 90,132 180,118 270,96 360,80 450,62 560,40 700,22 700,180"/>
          </svg>

          <button class="submit-btn" id="cx-submit-campaign" style="padding:14px 28px;font-size:15px">Submit Your Clip →</button>
        </div>
      </div>

      <div class="card card-purple" style="margin-bottom:28px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h4>Budget Progress</h4>
          <strong>${money(stats.spent)} / ${money(campaign.budget)}</strong>
        </div>

        <div style="height:10px;background:rgba(255,255,255,.08);border-radius:999px;overflow:hidden;margin-bottom:12px">
          <div style="height:100%;width:${stats.progress}%;background:linear-gradient(90deg,#7C3AED,#22C55E);border-radius:999px"></div>
        </div>

        <div style="display:flex;justify-content:space-between;color:rgba(255,255,255,.5);font-weight:800">
          <span>${Math.round(stats.progress)}% used</span>
          <span>RPM: ${money(campaign.rate)} / 1M views</span>
        </div>

        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:28px">
          <div class="mini-stat"><div class="mini-stat-label">Views This Campaign</div><div class="mini-stat-value">${shortNum(stats.totalViews)}</div></div>
          <div class="mini-stat"><div class="mini-stat-label">Approved Earnings</div><div class="mini-stat-value">${money(stats.approvedEarnings)}</div></div>
          <div class="mini-stat"><div class="mini-stat-label">Submissions</div><div class="mini-stat-value">${stats.allSubmissions}</div></div>
          <div class="mini-stat"><div class="mini-stat-label">Avg RPM</div><div class="mini-stat-value">${money(campaign.rate)}</div></div>
        </div>
      </div>

      <div class="card card-purple" style="margin-bottom:28px">
        <h4 style="text-align:center;margin-bottom:24px">Requirements</h4>
        <div style="max-width:760px;margin:0 auto;display:grid;gap:14px">
          ${
            requirements.length
              ? requirements.map(item => `<div style="font-weight:900;color:rgba(255,255,255,.82)">✅ ${esc(item)}</div>`).join("")
              : `<div style="font-weight:900;color:rgba(255,255,255,.65)">✅ ${esc(campaign.requirements)}</div>`
          }
        </div>
        <p style="color:rgba(255,255,255,.45);margin-top:18px;text-align:center">For full campaign rules, check the brief and reference asset.</p>
      </div>

      <div class="card card-purple">
        <h4 style="margin-bottom:16px">Top 5 Performers</h4>
        <div style="display:grid;gap:14px">
          ${
            stats.top.length
              ? stats.top.map((item, index) => `
                <div class="performer-row" style="display:grid;grid-template-columns:60px 58px 1fr auto;gap:16px;align-items:center;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:16px 20px">
                  <strong style="color:#FACC15">#${index + 1}</strong>
                  <div style="width:46px;height:46px;border-radius:999px;background:#4338CA;display:grid;place-items:center;font-weight:900">${esc(item.avatar)}</div>
                  <div>
                    <strong>${esc(item.name)}</strong>
                    <p style="color:rgba(255,255,255,.45);margin:2px 0 0">${esc(item.handle || "Approved creator")}</p>
                  </div>
                  <div style="text-align:right">
                    <strong>${shortNum(item.views)}</strong>
                    <p style="color:#22C55E;font-weight:900;margin:2px 0 0">${money(item.earnings)}</p>
                  </div>
                </div>
              `).join("")
              : `<div style="color:rgba(255,255,255,.55);text-align:center;padding:20px">No approved performers yet.</div>`
          }
        </div>
      </div>
    `;

    detail.querySelector(".back-btn")?.addEventListener("click", () => {
      state.activeCampaignId = null;
      renderCampaigns();
    });

    detail.querySelector("#cx-submit-campaign")?.addEventListener("click", () => {
      openSubmitModal(campaign);
    });
  }

  function openSubmitModal(campaign) {
    const modal = document.getElementById("submit-modal");
    const box = document.getElementById("modal-box");

    if (!modal || !box) {
      alert("Submit modal not found.");
      return;
    }

    box.innerHTML = `
      <button type="button" id="cx-close-submit" style="float:right;background:transparent;color:#fff;border:none;font-size:22px;cursor:pointer">×</button>
      <h2 style="margin-bottom:8px">Submit clip for ${esc(campaign.title)}</h2>
      <p style="color:rgba(255,255,255,.55);margin-bottom:20px">Paste your public post, reel, video or clip link. Review team will verify it before approval.</p>

      <form id="cx-submit-form" style="display:grid;gap:16px">
        <label>
          <span style="display:block;margin-bottom:8px;color:rgba(255,255,255,.65);font-weight:800">Platform</span>
          <select name="platform" required>
            <option value="">Select platform</option>
            <option>Instagram</option>
            <option>TikTok</option>
            <option>YouTube Shorts</option>
            <option>Other</option>
          </select>
        </label>

        <label>
          <span style="display:block;margin-bottom:8px;color:rgba(255,255,255,.65);font-weight:800">Clip URL</span>
          <input name="clip_url" type="url" required placeholder="https://..." />
        </label>

        <button class="submit-btn" type="submit">Submit for Review →</button>
      </form>
    `;

    modal.classList.remove("hidden");

    box.querySelector("#cx-close-submit")?.addEventListener("click", () => {
      modal.classList.add("hidden");
    });

    box.querySelector("#cx-submit-form")?.addEventListener("submit", async event => {
      event.preventDefault();

      const client = sb();
      if (!client) {
        alert("Supabase client not ready.");
        return;
      }

      const form = event.currentTarget;
      const button = form.querySelector("button[type='submit']");
      button.disabled = true;
      button.textContent = "Submitting...";

      if (!state.user) {
        try {
          const sessionResult = await client.auth.getSession();
          state.user = sessionResult?.data?.session?.user || null;
        } catch (_) {}
      }

      const payload = {
        user_id: state.user?.id,
        campaign_id: campaign.id,
        campaign_title: campaign.title,
        platform: form.platform.value,
        clip_url: form.clip_url.value,
        status: "pending",
        views: 0,
        earnings: 0
      };

      const { error } = await client.from("submissions").insert(payload);

      if (error) {
        console.error(error);
        alert("Submission failed: " + error.message);
        button.disabled = false;
        button.textContent = "Submit for Review →";
        return;
      }

      modal.classList.add("hidden");
      await loadCampaignData();
      renderCampaigns();
      alert("Clip submitted for review.");
    });
  }

  async function renderCampaigns() {
    const grid = document.getElementById("campaign-grid");

    if (!grid) return;

    if (!state.loaded) {
      grid.innerHTML = `<div class="card" style="grid-column:1/-1;text-align:center;padding:40px">Loading live campaigns...</div>`;
      await loadCampaignData();
    }

    const active = state.campaigns.find(campaign => sameId(campaign.id, state.activeCampaignId));

    if (active) {
      renderDetail(active);
    } else {
      renderCards();
    }
  }

  function bindFilters() {
    document.querySelectorAll("#genre-filters [data-genre]").forEach(button => {
      if (button.dataset.cxAlgorithmBound === "true") return;
      button.dataset.cxAlgorithmBound = "true";

      button.addEventListener("click", () => {
        document.querySelectorAll("#genre-filters [data-genre]").forEach(btn => btn.classList.remove("active"));
        button.classList.add("active");
        state.activeFilter = button.dataset.genre || "All";
        state.activeCampaignId = null;
        renderCampaigns();
      });
    });
  }

  function boot() {
    bindFilters();

    window.renderCampaigns = renderCampaigns;
    window.cxReloadCampaigns = async function () {
      state.loaded = false;
      await renderCampaigns();
    };

    const campaignSection = document.getElementById("section-campaigns");
    if (campaignSection) {
      renderCampaigns();
    }

    document.addEventListener("click", event => {
      const target = event.target.closest("#nav-campaigns, [data-section='campaigns'], a[href='#campaigns']");
      if (target) {
        setTimeout(() => {
          state.activeCampaignId = null;
          renderCampaigns();
        }, 120);
      }
    }, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  setTimeout(boot, 800);
})();
