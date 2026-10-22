// LEGACY APP WRAPPED FOR FUNCTIONAL CORE
(function () {
  const functionalCoreRoutes = ["/dashboard", "/stats", "/payouts"];

  if (functionalCoreRoutes.includes(window.location.pathname)) {
    console.info("Legacy app.js skipped. Functional core owns this route:", window.location.pathname);
    return;
  }


// Functional core owns creator routes now.
// Prevent legacy dashboard rendering/toasts from fighting the new operating loop.
if (window.CLIPENCY_FUNCTIONAL_CORE_ACTIVE) {
  window.__CLIPENCY_LEGACY_RENDER_DISABLED = true;
}

/* ── Toast Notification System ──────────────────────── */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = {
    success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>'
  };

  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${message}</span>
    <div class="toast-progress"></div>
  `;

  container.appendChild(toast);

  // Auto-dismiss after 4 seconds
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 350);
  }, 4000);
}

/* ── Button Loading Helpers ────────────────────────── */
function setButtonLoading(btn, loadingText) {
  btn._originalHTML = btn.innerHTML;
  btn.innerHTML = `<span class="btn-spinner"></span> ${loadingText}`;
  btn.classList.add('loading');
  btn.disabled = true;
}

function resetButton(btn) {
  btn.innerHTML = btn._originalHTML || btn.innerHTML;
  btn.classList.remove('loading');
  btn.disabled = false;
}

/* ── Tab Switching ───────────────────────────────────── */
function switchTab(panelId, btn) {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.remove('active');
    t.setAttribute('aria-selected', 'false');
  });
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  btn.setAttribute('aria-selected', 'true');
  document.getElementById(panelId).classList.add('active');
}
// Expose globally so onclick="switchTab(...)" in HTML can find it
window.switchTab = switchTab;

/* ── Redirect to Dashboard ─────────────────────────── */
function showSuccessView(user) {
  window.ClipencyRedirectAfterAuth ? window.ClipencyRedirectAfterAuth() : (window.location.href = '/campaigns');
}

/* ── Show Auth View (restore forms) ────────────────── */
function showAuthView() {
  document.querySelector('.tabs').style.display = 'flex';
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-signup').classList.add('active');
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.remove('active');
    t.setAttribute('aria-selected', 'false');
  });
  document.getElementById('tab-signup').classList.add('active');
  document.getElementById('tab-signup').setAttribute('aria-selected', 'true');
}

/* ── "Create an account" link in Sign In panel ──────── */
document.getElementById('switch-to-signup')?.addEventListener('click', (e) => {
  e.preventDefault();
  const btn = document.getElementById('tab-signup');
  switchTab('panel-signup', btn);
});

/* ── Validation Helpers ─────────────────────────────── */
function showError(inputId, message) {
  const input = document.getElementById(inputId);
  const error = document.getElementById(inputId + '-error');
  if (input) input.classList.add('error');
  if (error) error.textContent = message;
}

function clearError(inputId) {
  const input = document.getElementById(inputId);
  const error = document.getElementById(inputId + '-error');
  if (input) input.classList.remove('error');
  if (error) error.textContent = '';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/* ── Clear errors on input ──────────────────────────── */
document.querySelectorAll('.field input').forEach(input => {
  input.addEventListener('input', () => clearError(input.id));
});

/* ── Sign Up Form (Supabase) ────────────────────────── */
document.getElementById('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  let valid = true;

  const firstName = document.getElementById('signup-firstname').value.trim();
  const lastName = document.getElementById('signup-lastname').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const agree = document.getElementById('signup-agree').checked;

  if (!firstName) { showError('signup-firstname', 'Required'); valid = false; }
  if (!lastName) { showError('signup-lastname', 'Required'); valid = false; }

  if (!email) {
    showError('signup-email', 'Email is required');
    valid = false;
  } else if (!isValidEmail(email)) {
    showError('signup-email', 'Enter a valid email address');
    valid = false;
  }

  if (!password) {
    showError('signup-password', 'Password is required');
    valid = false;
  } else if (password.length < 8) {
    showError('signup-password', 'Must be at least 8 characters');
    valid = false;
  }

  if (!agree) {
    valid = false;
    document.getElementById('signup-agree').focus();
  }

  if (!valid) return;

  const btn = document.getElementById('btn-signup');
  setButtonLoading(btn, 'Creating account…');

  try {
    const { data, error } = await window.supabaseClient.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: 'https://clipency.in/login',
        data: {
          first_name: firstName,
          last_name: lastName,
        },
      },
    });

    if (error) throw error;

    // Supabase returns a user with identities = [] if email already exists
    // (when email confirmations are enabled)
    if (data?.user?.identities?.length === 0) {
      showToast('An account with this email already exists. Try signing in.', 'error');
      resetButton(btn);
      return;
    }

    showToast('Account created! Check your email to verify your account.', 'success');
    // Clear form
    document.getElementById('signup-form').reset();
  } catch (err) {
    showToast(err.message || 'Sign-up failed. Please try again.', 'error');
  } finally {
    resetButton(btn);
  }
});

/* ── Sign In Form (Supabase) ────────────────────────── */
document.getElementById('signin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  let valid = true;

  const email = document.getElementById('signin-email').value.trim();
  const password = document.getElementById('signin-password').value;

  if (!email) {
    showError('signin-email', 'Email is required');
    valid = false;
  } else if (!isValidEmail(email)) {
    showError('signin-email', 'Enter a valid email address');
    valid = false;
  }

  if (!password) {
    showError('signin-password', 'Password is required');
    valid = false;
  }

  if (!valid) return;

  const btn = document.getElementById('btn-signin');
  setButtonLoading(btn, 'Signing in…');

  try {
    const { data, error } = await window.supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    showToast('Welcome back! Redirecting…', 'success');
    setTimeout(() => showSuccessView(data.user), 800);
  } catch (err) {
    if (err.message?.includes('Invalid login credentials')) {
      showError('signin-email', ' ');
      showError('signin-password', 'Invalid email or password');
    }
    showToast(err.message || 'Sign-in failed. Please try again.', 'error');
  } finally {
    resetButton(btn);
  }
});

/* ── Google OAuth ───────────────────────────────────── */
async function signInWithGoogle() {
  try {
    // Build the redirect URL — window.location.origin is "null" for file:// URLs,
    // so we construct the full current URL without hash/search fragments.
    const currentUrl = window.location.href.split('#')[0].split('?')[0];
    const { error } = await window.supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: currentUrl,
      },
    });
    if (error) throw error;
    // Supabase will redirect to Google
  } catch (err) {
    showToast(err.message || 'Google sign-in failed.', 'error');
  }
}

document.getElementById('btn-google-signup')?.addEventListener('click', signInWithGoogle);
document.getElementById('btn-google-signin')?.addEventListener('click', signInWithGoogle);

/* ── Forgot Password Modal ─────────────────────────── */
const forgotModal = document.getElementById('forgot-modal');

document.getElementById('forgot-password-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  forgotModal.classList.add('open');
  // Pre-fill with sign-in email if available
  const signInEmail = document.getElementById('signin-email').value.trim();
  if (signInEmail) {
    document.getElementById('forgot-email').value = signInEmail;
  }
  document.getElementById('forgot-email').focus();
});

document.getElementById('forgot-modal-close')?.addEventListener('click', () => {
  forgotModal.classList.remove('open');
});

// Close modal on overlay click
forgotModal?.addEventListener('click', (e) => {
  if (e.target === forgotModal) forgotModal.classList.remove('open');
});

// Close modal on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && forgotModal.classList.contains('open')) {
    forgotModal.classList.remove('open');
  }
});

document.getElementById('forgot-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = document.getElementById('forgot-email').value.trim();

  if (!email) {
    showError('forgot-email', 'Email is required');
    return;
  }
  if (!isValidEmail(email)) {
    showError('forgot-email', 'Enter a valid email address');
    return;
  }

  const btn = document.getElementById('btn-forgot');
  setButtonLoading(btn, 'Sending…');

  try {
    const resetRedirectUrl = window.location.href.split('#')[0].split('?')[0];
    const { error } = await window.supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: resetRedirectUrl,
    });

    if (error) throw error;

    showToast('Password reset link sent! Check your inbox.', 'success');
    forgotModal.classList.remove('open');
    document.getElementById('forgot-form').reset();
  } catch (err) {
    showToast(err.message || 'Failed to send reset email.', 'error');
  } finally {
    resetButton(btn);
  }
});

/* ── Sign Out ───────────────────────────────────────── */
document.getElementById('btn-signout')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-signout');
  setButtonLoading(btn, 'Signing out…');

  try {
    const { error } = await window.supabaseClient.auth.signOut();
    if (error) throw error;
    showToast('You have been signed out.', 'info');
    showAuthView();
  } catch (err) {
    showToast(err.message || 'Sign-out failed.', 'error');
  } finally {
    resetButton(btn);
  }
});

/* ── Auth State Listener ────────────────────────────── */
// Track whether the initial session check is done to avoid redirect on page-load restore
let _initialCheckDone = false;

window.supabaseClient.auth.onAuthStateChange((event, session) => {
  // Only redirect on a real user sign-in action, not the initial session restore
  if (event === 'SIGNED_IN' && session?.user && _initialCheckDone) {
    window.ClipencyRedirectAfterAuth ? window.ClipencyRedirectAfterAuth() : (window.location.href = '/campaigns');
  }

  if (event === 'SIGNED_OUT') {
    showAuthView();
  }

  if (event === 'USER_UPDATED' && session?.user) {
    showToast('Email verified successfully!', 'success');
    window.ClipencyRedirectAfterAuth ? window.ClipencyRedirectAfterAuth() : (window.location.href = '/campaigns');
  }
});

// Check for existing session on page load — go straight to dashboard
(async () => {
  const { data: { session } } = await window.supabaseClient.auth.getSession();
  _initialCheckDone = true;
  if (session?.user) {
    window.ClipencyRedirectAfterAuth ? window.ClipencyRedirectAfterAuth() : (window.location.href = '/campaigns');
  }
})();


})();
