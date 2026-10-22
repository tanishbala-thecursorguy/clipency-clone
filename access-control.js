(function () {
  const ADMIN_ROUTES = [
    "/workspace",
    "/review",
    "/admin",
    "/admin/reviews",
    "/admin/campaigns",
    "/admin/leads",
    "/admin/payouts",
    "/admin/finance",
    "/admin/users"
  ];

  const CREATOR_ROUTES = [
    "/dashboard",
    "/campaigns",
    "/stats",
    "/payouts",
    "/wallet",
    "/profile"
  ];

  async function waitForSupabase() {
    let attempts = 0;

    while (!window.supabaseClient && attempts < 80) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      attempts++;
    }

    if (!window.supabaseClient) {
      throw new Error("Supabase client failed to load.");
    }

    return window.supabaseClient;
  }

  async function getSession() {
    const supabase = await waitForSupabase();
    const { data, error } = await supabase.auth.getSession();

    if (error) throw error;

    return data?.session || null;
  }

  async function getRole() {
    const supabase = await waitForSupabase();
    const session = await getSession();

    if (!session?.user) {
      return {
        user: null,
        profile: null,
        role: null
      };
    }

    let profile = null;
    let role = null;

    const profileResult = await supabase
      .from("profiles")
      .select("id,email,full_name,username,avatar_url,role")
      .eq("id", session.user.id)
      .maybeSingle();

    if (!profileResult.error && profileResult.data) {
      profile = profileResult.data;
      role = profile.role;
    }

    if (!role) {
      const rpcResult = await supabase.rpc("current_user_role");

      if (!rpcResult.error && rpcResult.data) {
        role = rpcResult.data;
      }
    }

    role = role || "clipper";

    return {
      user: session.user,
      profile,
      role
    };
  }

  function renderAccessDenied(requiredRoles, currentRole) {
    document.body.innerHTML = `
      <main class="access-denied-shell">
        <section class="access-denied-card">
          <div class="access-denied-mark">!</div>
          <h1>Access denied</h1>
          <p>This area is protected for <strong>${requiredRoles.join(" / ")}</strong>. Your current role is <strong>${currentRole || "not signed in"}</strong>.</p>
          <div class="access-denied-actions">
            <a href="/dashboard">Go to dashboard</a>
            <a href="/login">Login again</a>
          </div>
        </section>
      </main>
    `;
  }

  function renderAccessError(error) {
    document.body.innerHTML = `
      <main class="access-denied-shell">
        <section class="access-denied-card">
          <div class="access-denied-mark">!</div>
          <h1>Security check failed</h1>
          <p>${error.message || "Could not verify your access. Please refresh once."}</p>
          <div class="access-denied-actions">
            <a href="/login">Login again</a>
          </div>
        </section>
      </main>
    `;
  }

  async function requireRole(allowedRoles) {
    try {
      const context = await getRole();

      if (!context.user) {
        window.location.replace("/login");
        return null;
      }

      if (!allowedRoles.includes(context.role)) {
        renderAccessDenied(allowedRoles, context.role);
        return null;
      }

      return context;
    } catch (error) {
      renderAccessError(error);
      return null;
    }
  }

  async function redirectByRole() {
    const context = await getRole();

    if (!context.user) {
      window.location.replace("/login");
      return;
    }

    if (context.role === "admin") {
      window.location.replace("/workspace");
      return;
    }

    if (context.role === "reviewer") {
      window.location.replace("/review");
      return;
    }

    window.location.replace("/campaigns");
  }

  async function protectCurrentRoute() {
    const path = window.location.pathname;

    if (!ADMIN_ROUTES.includes(path) && !CREATOR_ROUTES.includes(path)) {
      return;
    }

    const context = await getRole();

    if (!context.user) {
      window.location.replace("/login");
      return;
    }

    if (path === "/workspace" && context.role !== "admin") {
      renderAccessDenied(["admin"], context.role);
      return;
    }

    if (path.startsWith("/admin") && context.role !== "admin") {
      renderAccessDenied(["admin"], context.role);
      return;
    }

    if (path === "/review" && !["admin", "reviewer"].includes(context.role)) {
      renderAccessDenied(["admin", "reviewer"], context.role);
      return;
    }

    if (CREATOR_ROUTES.includes(path) && context.role === "reviewer") {
      window.location.replace("/review");
    }
  }

  window.ClipencyAccess = {
    getRole,
    getSession,
    requireRole,
    redirectByRole,
    protectCurrentRoute
  };
})();
