(function () {
  if (window.__clipencyAdminUsersLoaded) return;
  window.__clipencyAdminUsersLoaded = true;

  if (window.location.pathname !== "/admin/users") return;

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForSupabase() {
    let tries = 0;

    while (!window.supabaseClient && tries < 80) {
      await wait(100);
      tries++;
    }

    if (!window.supabaseClient) {
      throw new Error("Supabase client not loaded.");
    }

    return window.supabaseClient;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function appRoot() {
    return (
      document.querySelector(".dashboard-content") ||
      document.querySelector(".main-content") ||
      document.querySelector(".page-content") ||
      document.querySelector("main") ||
      document.body
    );
  }

  async function getSessionEmail() {
    const supabase = await waitForSupabase();
    const { data } = await supabase.auth.getUser();
    return data?.user?.email || "";
  }

  async function fetchRoles() {
    const supabase = await waitForSupabase();

    const [{ data: admins, error: adminError }, { data: reviewers, error: reviewerError }] = await Promise.all([
      supabase.from("admin_users").select("id,email,user_id,created_at").order("created_at", { ascending: false }),
      supabase.from("reviewer_users").select("id,email,user_id,created_at").order("created_at", { ascending: false })
    ]);

    if (adminError) throw adminError;
    if (reviewerError) throw reviewerError;

    const map = new Map();

    (admins || []).forEach((row) => {
      map.set(normalizeEmail(row.email), {
        email: normalizeEmail(row.email),
        role: "admin",
        created_at: row.created_at
      });
    });

    (reviewers || []).forEach((row) => {
      const email = normalizeEmail(row.email);

      if (!map.has(email)) {
        map.set(email, {
          email,
          role: "reviewer",
          created_at: row.created_at
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => {
      if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
      return a.email.localeCompare(b.email);
    });
  }

  async function setRole(email, role) {
    const supabase = await waitForSupabase();
    const cleanEmail = normalizeEmail(email);

    if (!cleanEmail || !cleanEmail.includes("@")) {
      throw new Error("Enter a valid email address.");
    }

    if (role === "admin") {
      const { error: addAdminError } = await supabase
        .from("admin_users")
        .upsert({ email: cleanEmail }, { onConflict: "email" });

      if (addAdminError) throw addAdminError;

      await supabase.from("reviewer_users").delete().eq("email", cleanEmail);
      return;
    }

    if (role === "reviewer") {
      const { error: addReviewerError } = await supabase
        .from("reviewer_users")
        .upsert({ email: cleanEmail }, { onConflict: "email" });

      if (addReviewerError) throw addReviewerError;

      await supabase.from("admin_users").delete().eq("email", cleanEmail);
      return;
    }

    throw new Error("Invalid role.");
  }

  async function revokeRole(email) {
    const supabase = await waitForSupabase();
    const cleanEmail = normalizeEmail(email);

    await supabase.from("reviewer_users").delete().eq("email", cleanEmail);
    await supabase.from("admin_users").delete().eq("email", cleanEmail);
  }

  function roleBadge(role) {
    if (role === "admin") return `<span class="cx-role-badge admin">Admin</span>`;
    return `<span class="cx-role-badge reviewer">Reviewer</span>`;
  }

  function renderUsers(users, currentEmail) {
    const rows = users.map((user) => {
      const isSelf = normalizeEmail(user.email) === normalizeEmail(currentEmail);

      return `
        <tr>
          <td>
            <div class="cx-user-email">${escapeHtml(user.email)}</div>
            ${isSelf ? `<div class="cx-user-note">Current signed-in admin</div>` : ``}
          </td>
          <td>${roleBadge(user.role)}</td>
          <td>${user.created_at ? new Date(user.created_at).toLocaleString() : "—"}</td>
          <td>
            <div class="cx-user-actions">
              <button data-role-action="admin" data-email="${escapeHtml(user.email)}" ${user.role === "admin" ? "disabled" : ""}>Make admin</button>
              <button data-role-action="reviewer" data-email="${escapeHtml(user.email)}" ${user.role === "reviewer" ? "disabled" : ""}>Make reviewer</button>
              <button class="danger" data-role-action="revoke" data-email="${escapeHtml(user.email)}" ${isSelf ? "disabled title='You cannot revoke yourself here.'" : ""}>Revoke</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    return `
      <div class="cx-admin-users-shell">
        <div class="cx-admin-users-hero">
          <span>ACCESS CONTROL</span>
          <h1>Users & roles</h1>
          <p>Add, upgrade, downgrade or revoke access for the people who operate Clipency. Admins control the workspace. Reviewers only verify submissions.</p>
        </div>

        <section class="cx-role-create-card">
          <div>
            <h2>Add or update access</h2>
            <p>Enter the person’s email, choose the role, and save. Changes apply the next time they sign in or refresh.</p>
          </div>

          <form id="cx-role-form">
            <input id="cx-role-email" type="email" placeholder="name@example.com" autocomplete="email" required />
            <select id="cx-role-select">
              <option value="reviewer">Reviewer</option>
              <option value="admin">Admin</option>
            </select>
            <button type="submit">Save access</button>
          </form>
        </section>

        <section class="cx-role-table-card">
          <div class="cx-role-table-head">
            <h2>Current access</h2>
            <span>${users.length} users</span>
          </div>

          <div class="cx-role-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Added</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${rows || `<tr><td colspan="4"><div class="cx-admin-empty">No admin or reviewer access has been added yet.</div></td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;
  }

  async function refresh() {
    const root = appRoot();

    root.innerHTML = `
      <div class="cx-admin-users-shell">
        <div class="cx-admin-users-hero">
          <span>ACCESS CONTROL</span>
          <h1>Users & roles</h1>
          <p>Loading role control…</p>
        </div>
      </div>
    `;

    try {
      const [users, currentEmail] = await Promise.all([
        fetchRoles(),
        getSessionEmail()
      ]);

      root.innerHTML = renderUsers(users, currentEmail);

      document.getElementById("cx-role-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();

        const email = document.getElementById("cx-role-email").value;
        const role = document.getElementById("cx-role-select").value;
        const button = event.target.querySelector("button");

        try {
          button.disabled = true;
          button.textContent = "Saving…";
          await setRole(email, role);
          await refresh();
        } catch (error) {
          alert(error.message || "Could not save role.");
          button.disabled = false;
          button.textContent = "Save access";
        }
      });

      document.querySelectorAll("[data-role-action]").forEach((button) => {
        button.addEventListener("click", async () => {
          const action = button.dataset.roleAction;
          const email = button.dataset.email;

          try {
            button.disabled = true;

            if (action === "revoke") {
              const ok = confirm(`Revoke access for ${email}?`);
              if (!ok) {
                button.disabled = false;
                return;
              }

              await revokeRole(email);
            } else {
              await setRole(email, action);
            }

            await refresh();
          } catch (error) {
            alert(error.message || "Could not update access.");
            button.disabled = false;
          }
        });
      });
    } catch (error) {
      root.innerHTML = `
        <div class="cx-admin-users-shell">
          <section class="cx-role-create-card">
            <h2>Access control could not load.</h2>
            <p>${escapeHtml(error.message || "Please refresh once.")}</p>
          </section>
        </div>
      `;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refresh);
  } else {
    refresh();
  }
})();
