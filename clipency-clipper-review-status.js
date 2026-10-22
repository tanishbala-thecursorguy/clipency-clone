(function () {
  if (window.__clipencyClipperReviewStatusLoaded) return;
  window.__clipencyClipperReviewStatusLoaded = true;

  const routes = ["/stats", "/payouts", "/profile"];
  if (!routes.includes(window.location.pathname)) return;

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForSupabase() {
    for (let i = 0; i < 80; i++) {
      if (window.supabaseClient) return window.supabaseClient;
      await wait(80);
    }

    return null;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function badge(status) {
    const s = String(status || "pending").toLowerCase();

    if (s === "approved") return `<span class="cx-review-status-badge approved">Approved</span>`;
    /* Flagged by the brand: still approved, just says so. */
    if (s === "flagged") return `<span class="cx-review-status-badge approved">Flagged</span>`;
    if (s === "rejected") return `<span class="cx-review-status-badge rejected">Rejected</span>`;
    return `<span class="cx-review-status-badge pending">Pending review</span>`;
  }

  function root() {
    return (
      document.querySelector(".dashboard-content") ||
      document.querySelector(".main-content") ||
      document.querySelector(".page-content") ||
      document.querySelector("main")
    );
  }

  async function boot() {
    const supabase = await waitForSupabase();
    const target = root();

    if (!supabase || !target) return;

    const { data, error } = await supabase.rpc("my_submission_review_statuses");

    if (error || !data || !data.length) return;

    const existing = document.getElementById("cx-clipper-review-status-panel");
    if (existing) existing.remove();

    const panel = document.createElement("section");
    panel.id = "cx-clipper-review-status-panel";
    panel.className = "cx-clipper-review-status-panel";

    panel.innerHTML = `
      <div class="cx-clipper-review-head">
        <div>
          <span>REVIEW STATUS</span>
          <h2>Submission decisions</h2>
          <p>Latest admin decisions on your submitted campaign proofs.</p>
        </div>
      </div>

      <div class="cx-clipper-review-list">
        ${data.slice(0, 6).map((row) => `
          <div class="cx-clipper-review-row">
            <div>
              <strong>${escapeHtml(row.campaign_title || "Campaign")}</strong>
              <small>${escapeHtml(row.platform || "Proof submission")}</small>
            </div>
            <div>${badge(row.status)}</div>
            <div class="cx-clipper-review-note">
              ${
                row.rejection_reason
                  ? escapeHtml(row.rejection_reason)
                  : row.status === "approved"
                    ? "Approved by review team."
                    : row.status === "flagged"
                      ? "Approved. The brand flagged this clip; it still counts as approved."
                      : "Waiting for review team verification."
              }
            </div>
          </div>
        `).join("")}
      </div>
    `;

    const firstCard = target.querySelector(".cx-core-card, .classic-details-card, section");
    if (firstCard) {
      firstCard.insertAdjacentElement("beforebegin", panel);
    } else {
      target.prepend(panel);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 700));
  } else {
    setTimeout(boot, 700);
  }
})();
