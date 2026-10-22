(function () {
  if (window.__clipencyAdminReviewActionsLoaded) return;
  window.__clipencyAdminReviewActionsLoaded = true;

  if (window.location.pathname !== "/admin/reviews") return;

  let supabaseClient = null;
  let rejectTarget = null;

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

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function statusBadge(status) {
    const s = String(status || "pending").toLowerCase();

    if (s === "approved") return `<span class="cx-admin-badge approved">Approved</span>`;
    if (s === "rejected") return `<span class="cx-admin-badge rejected">Rejected</span>`;
    return `<span class="cx-admin-badge pending">Pending</span>`;
  }

  async function fetchQueue() {
    const { data, error } = await supabaseClient
      .from("admin_review_queue")
      .select("*")
      .order("created_at", { ascending: false, nullsFirst: false });

    if (error) throw error;

    return data || [];
  }

  function page(rows) {
    return `
      <div class="cx-admin-kicker">Review Queue</div>
      <h1 class="cx-admin-title">Creator proof review.</h1>
      <p class="cx-admin-subtitle">
        Approve valid creator proofs, reject invalid submissions with a clear reason, and keep payout status clean.
      </p>

      <section class="cx-admin-grid cx-review-summary-grid">
        <div class="cx-admin-card">
          <h3>Pending</h3>
          <strong>${rows.filter((r) => String(r.status).toLowerCase() === "pending").length}</strong>
          <p>Waiting for verification.</p>
        </div>
        <div class="cx-admin-card">
          <h3>Approved</h3>
          <strong>${rows.filter((r) => String(r.status).toLowerCase() === "approved").length}</strong>
          <p>Ready for payout logic.</p>
        </div>
        <div class="cx-admin-card">
          <h3>Rejected</h3>
          <strong>${rows.filter((r) => String(r.status).toLowerCase() === "rejected").length}</strong>
          <p>Returned with reason.</p>
        </div>
        <div class="cx-admin-card">
          <h3>Total</h3>
          <strong>${rows.length}</strong>
          <p>All submitted proofs.</p>
        </div>
      </section>

      <section class="cx-admin-section">
        <div class="cx-admin-section-head">
          <div>
            <h2>Submissions</h2>
            <p>Every decision here updates the creator-facing status after refresh.</p>
          </div>
        </div>

        <div class="cx-review-filterbar">
          <button class="active" data-review-filter="all">All</button>
          <button data-review-filter="pending">Pending</button>
          <button data-review-filter="approved">Approved</button>
          <button data-review-filter="rejected">Rejected</button>
        </div>

        <div class="cx-admin-table-wrap">
          <table class="cx-admin-table cx-review-table">
            <thead>
              <tr>
                <th>Creator</th>
                <th>Campaign</th>
                <th>Proof</th>
                <th>Status</th>
                <th>Reason</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${
                rows.length
                  ? rows.map((row) => {
                      const status = String(row.status || "pending").toLowerCase();
                      const proof = row.proof_url
                        ? `<a class="cx-proof-link" href="${escapeHtml(row.proof_url)}" target="_blank" rel="noopener noreferrer">Open proof ↗</a>`
                        : `<span class="cx-muted">No link</span>`;

                      return `
                        <tr data-review-row data-status="${escapeHtml(status)}">
                          <td>
                            <strong>${escapeHtml(row.creator_name || row.creator_email || "Creator")}</strong>
                            <div class="cx-muted">${escapeHtml(row.creator_email || "")}</div>
                          </td>
                          <td>
                            <strong>${escapeHtml(row.campaign_title || "Campaign")}</strong>
                            <div class="cx-muted">${escapeHtml(row.platform || "")}</div>
                          </td>
                          <td>${proof}</td>
                          <td>${statusBadge(status)}</td>
                          <td>
                            ${
                              row.rejection_reason
                                ? `<div class="cx-reject-reason">${escapeHtml(row.rejection_reason)}</div>`
                                : `<span class="cx-muted">—</span>`
                            }
                          </td>
                          <td>
                            <div class="cx-admin-actions">
                              <button data-review-action="approved" data-id="${escapeHtml(row.submission_id)}" ${status === "approved" ? "disabled" : ""}>Approve</button>
                              <button class="danger" data-review-action="rejected" data-id="${escapeHtml(row.submission_id)}">Reject</button>
                              <button data-review-action="pending" data-id="${escapeHtml(row.submission_id)}" ${status === "pending" ? "disabled" : ""}>Pending</button>
                            </div>
                          </td>
                        </tr>
                      `;
                    }).join("")
                  : `<tr><td colspan="6"><div class="cx-admin-empty">No creator submissions found yet.</div></td></tr>`
              }
            </tbody>
          </table>
        </div>
      </section>

      <div class="cx-reject-modal" id="cx-reject-modal" aria-hidden="true">
        <div class="cx-reject-card">
          <span>REJECTION REASON</span>
          <h2>Tell the creator what to fix.</h2>
          <p>This reason will be shown on the creator side, so keep it specific and professional.</p>
          <textarea id="cx-reject-reason" placeholder="Example: Proof link is inaccessible / wrong platform / campaign requirements not followed."></textarea>
          <div class="cx-reject-actions">
            <button id="cx-reject-cancel">Cancel</button>
            <button class="danger" id="cx-reject-confirm">Reject submission</button>
          </div>
        </div>
      </div>
    `;
  }

  async function reviewSubmission(id, status, reason) {
    const { error } = await supabaseClient.rpc("admin_review_submission", {
      p_submission_id: id,
      p_status: status,
      p_rejection_reason: reason || null
    });

    if (error) throw error;
  }

  function openRejectModal(id) {
    rejectTarget = id;

    const modal = document.getElementById("cx-reject-modal");
    const textarea = document.getElementById("cx-reject-reason");

    if (!modal || !textarea) return;

    textarea.value = "";
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    setTimeout(() => textarea.focus(), 80);
  }

  function closeRejectModal() {
    rejectTarget = null;

    const modal = document.getElementById("cx-reject-modal");

    if (!modal) return;

    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  }

  function bind() {
    document.querySelectorAll("[data-review-action]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = button.dataset.id;
        const action = button.dataset.reviewAction;

        try {
          if (!id) throw new Error("Submission id missing.");

          if (action === "rejected") {
            openRejectModal(id);
            return;
          }

          button.disabled = true;
          button.textContent = action === "approved" ? "Approving…" : "Updating…";

          await reviewSubmission(id, action, null);
          await refresh();
        } catch (error) {
          alert(error.message || "Could not update review status.");
          await refresh();
        }
      });
    });

    document.querySelectorAll("[data-review-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        const filter = button.dataset.reviewFilter;

        document.querySelectorAll("[data-review-filter]").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");

        document.querySelectorAll("[data-review-row]").forEach((row) => {
          const visible = filter === "all" || row.dataset.status === filter;
          row.style.display = visible ? "" : "none";
        });
      });
    });

    document.getElementById("cx-reject-cancel")?.addEventListener("click", closeRejectModal);

    document.getElementById("cx-reject-confirm")?.addEventListener("click", async () => {
      const textarea = document.getElementById("cx-reject-reason");
      const reason = textarea?.value?.trim();

      if (!reason || reason.length < 3) {
        alert("Please add a clear rejection reason.");
        return;
      }

      try {
        await reviewSubmission(rejectTarget, "rejected", reason);
        closeRejectModal();
        await refresh();
      } catch (error) {
        alert(error.message || "Could not reject submission.");
      }
    });
  }

  async function refresh() {
    const content = document.querySelector(".cx-admin-content");

    if (!content) return;

    content.innerHTML = `
      <div class="cx-admin-kicker">Review Queue</div>
      <h1 class="cx-admin-title">Creator proof review.</h1>
      <p class="cx-admin-subtitle">Loading submissions…</p>
    `;

    try {
      const rows = await fetchQueue();
      content.innerHTML = page(rows);
      bind();
    } catch (error) {
      content.innerHTML = `
        <section class="cx-admin-section">
          <h2>Reviews could not load.</h2>
          <p>${escapeHtml(error.message || "Please refresh once.")}</p>
        </section>
      `;
    }
  }

  async function boot() {
    supabaseClient = await waitForSupabase();

    for (let i = 0; i < 40; i++) {
      if (document.querySelector(".cx-admin-content")) break;
      await wait(100);
    }

    await refresh();
  }

  boot();
})();
