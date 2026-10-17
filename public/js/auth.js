/**
 * ARCHITECTURAL EDITORIAL AUTHENTICATION CLIENT
 * Handles login and registration validation, accessible error announcements,
 * and open-redirect protection.
 */

(function () {
  'use strict';

  /**
   * Strictly sanitize and validate redirect URLs to prevent open redirects and redirect loops.
   */
  function sanitizeRedirectUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return '/dashboard';
    const trimmed = rawUrl.trim();
    // Must start with a single slash; reject protocol-relative (//) or backslash bypasses (/\)
    if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
      return '/dashboard';
    }
    // Reject external protocols or script injection
    if (trimmed.includes('://') || /^\/[a-z0-9]+:/i.test(trimmed)) {
      return '/dashboard';
    }
    // Prevent redirect loops
    if (trimmed.startsWith('/login') || trimmed.startsWith('/register')) {
      return '/dashboard';
    }
    return trimmed;
  }

  // --- Login Form Controller ---
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    const emailInput = document.getElementById('login-email');
    const passwordInput = document.getElementById('login-password');
    const alertBox = document.getElementById('login-alert');
    const submitBtn = document.getElementById('login-submit-btn');

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      alertBox.classList.remove('visible');
      alertBox.textContent = '';

      const email = (emailInput.value || '').trim();
      const password = passwordInput.value || '';

      // Client validation with accessible error state binding
      let hasError = false;
      let firstInvalidInput = null;

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        document.getElementById('email-error').classList.add('visible');
        emailInput.setAttribute('aria-invalid', 'true');
        hasError = true;
        if (!firstInvalidInput) firstInvalidInput = emailInput;
      } else {
        document.getElementById('email-error').classList.remove('visible');
        emailInput.setAttribute('aria-invalid', 'false');
      }

      if (!password || password.length < 8) {
        document.getElementById('password-error').classList.add('visible');
        passwordInput.setAttribute('aria-invalid', 'true');
        hasError = true;
        if (!firstInvalidInput) firstInvalidInput = passwordInput;
      } else {
        document.getElementById('password-error').classList.remove('visible');
        passwordInput.setAttribute('aria-invalid', 'false');
      }

      if (hasError) {
        if (firstInvalidInput) firstInvalidInput.focus();
        return;
      }

      // Submit via apiFetch
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Verifying Credentials...</span>';

      const res = await HousingUI.apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });

      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Authenticate & Access</span>';

      if (res && res.success) {
        HousingUI.showToast('Login successful! Redirecting...', 'success');

        // Resolve safe post-login redirect destination
        const dataRedirect = loginForm.getAttribute('data-redirect');
        const urlParams = new URLSearchParams(window.location.search);
        const redirectParam = urlParams.get('redirect') || dataRedirect;
        const safeDestination = sanitizeRedirectUrl(redirectParam);

        setTimeout(() => {
          window.location.href = safeDestination;
        }, 500);
      } else {
        const message = res ? (res.message || 'Authentication failed. Please verify your credentials.') : 'Server communication error';
        alertBox.textContent = message;
        alertBox.classList.add('visible');
        emailInput.focus();
      }
    });
  }

  // --- Registration Form Controller ---
  const regForm = document.getElementById('register-form');
  if (regForm) {
    const nameInput = document.getElementById('reg-name');
    const emailInput = document.getElementById('reg-email');
    const phoneInput = document.getElementById('reg-phone');
    const passwordInput = document.getElementById('reg-password');
    const confirmInput = document.getElementById('reg-confirm-password');
    const alertBox = document.getElementById('register-alert');
    const submitBtn = document.getElementById('register-submit-btn');

    regForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      alertBox.classList.remove('visible');
      alertBox.textContent = '';

      const name = (nameInput.value || '').trim();
      const email = (emailInput.value || '').trim();
      const phone = (phoneInput.value || '').trim();
      const password = passwordInput.value || '';
      const confirmPassword = confirmInput.value || '';

      // Client validation with accessible error state binding
      let hasError = false;
      let firstInvalidInput = null;

      if (!name || name.length < 2) {
        document.getElementById('reg-name-error').classList.add('visible');
        nameInput.setAttribute('aria-invalid', 'true');
        hasError = true;
        if (!firstInvalidInput) firstInvalidInput = nameInput;
      } else {
        document.getElementById('reg-name-error').classList.remove('visible');
        nameInput.setAttribute('aria-invalid', 'false');
      }

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        document.getElementById('reg-email-error').classList.add('visible');
        emailInput.setAttribute('aria-invalid', 'true');
        hasError = true;
        if (!firstInvalidInput) firstInvalidInput = emailInput;
      } else {
        document.getElementById('reg-email-error').classList.remove('visible');
        emailInput.setAttribute('aria-invalid', 'false');
      }

      if (!password || password.length < 8) {
        document.getElementById('reg-password-error').classList.add('visible');
        passwordInput.setAttribute('aria-invalid', 'true');
        hasError = true;
        if (!firstInvalidInput) firstInvalidInput = passwordInput;
      } else {
        document.getElementById('reg-password-error').classList.remove('visible');
        passwordInput.setAttribute('aria-invalid', 'false');
      }

      if (password !== confirmPassword) {
        document.getElementById('reg-confirm-error').classList.add('visible');
        confirmInput.setAttribute('aria-invalid', 'true');
        hasError = true;
        if (!firstInvalidInput) firstInvalidInput = confirmInput;
      } else {
        document.getElementById('reg-confirm-error').classList.remove('visible');
        confirmInput.setAttribute('aria-invalid', 'false');
      }

      if (hasError) {
        if (firstInvalidInput) firstInvalidInput.focus();
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Creating Account...</span>';

      const res = await HousingUI.apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, phone, password })
      });

      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Create Account & Continue</span>';

      if (res && res.success) {
        HousingUI.showToast('Account created successfully! Redirecting...', 'success');

        const dataRedirect = regForm.getAttribute('data-redirect');
        const urlParams = new URLSearchParams(window.location.search);
        const redirectParam = urlParams.get('redirect') || dataRedirect;
        const safeDestination = sanitizeRedirectUrl(redirectParam);

        setTimeout(() => {
          window.location.href = safeDestination;
        }, 500);
      } else {
        const message = res ? (res.message || 'Registration failed. Please check your form entries.') : 'Server communication error';
        alertBox.textContent = message;
        alertBox.classList.add('visible');
      }
    });
  }
})();
