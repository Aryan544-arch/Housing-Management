/**
 * ARCHITECTURAL EDITORIAL CLIENT CORE
 * Global utilities: CSRF token extraction, apiFetch, toasts, modals, theme, society state
 */

(function () {
  'use strict';

  // --- CSRF Token Extraction ---
  function getCsrfToken() {
    // 1. First preference: meta tag rendered in EJS template
    const metaTag = document.querySelector('meta[name="csrf-token"]');
    if (metaTag && metaTag.content) {
      return metaTag.content;
    }

    // 2. Fallback: Parse _csrf cookie (rawToken.hmacSignature -> rawToken is before the first period)
    const match = document.cookie.match(/(?:^|;\s*)_csrf=([^;]+)/);
    if (match && match[1]) {
      const decoded = decodeURIComponent(match[1]);
      return decoded.split('.')[0];
    }
    return '';
  }

  // --- Standardized apiFetch Wrapper ---
  async function apiFetch(url, options = {}) {
    const opts = { ...options };
    opts.headers = { ...opts.headers };

    // Inject CSRF token on state-changing requests or when available
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      opts.headers['X-CSRF-Token'] = csrfToken;
    }

    // If body is NOT FormData and Content-Type is not set, default to JSON
    if (opts.body && !(opts.body instanceof FormData) && !opts.headers['Content-Type']) {
      opts.headers['Content-Type'] = 'application/json';
    }

    // Ensure credentials (cookies) are sent on same-origin requests
    opts.credentials = 'same-origin';

    try {
      const res = await fetch(url, opts);

      // Handle session expiration
      if (res.status === 401 && !url.includes('/api/auth/login')) {
        showToast('Session expired. Redirecting to login...', 'warning');
        setTimeout(() => {
          window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
        }, 1200);
        return { success: false, message: 'Unauthorized' };
      }

      // Try parsing JSON response
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        return { ok: res.ok, status: res.status, ...data };
      }

      return { ok: res.ok, status: res.status };
    } catch (err) {
      console.error('Network or fetch error:', err);
      showToast('Network error or server unavailable.', 'error');
      return { ok: false, success: false, message: err.message || 'Network error' };
    }
  }

  // --- Toast Notification System ---
  function showToast(message, type = 'info', duration = 4000) {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // Choose icon
    let icon = 'ℹ';
    if (type === 'success') icon = '✓';
    if (type === 'error') icon = '✕';
    if (type === 'warning') icon = '⚠';

    toast.innerHTML = `
      <span style="font-weight: 700; font-family: var(--font-mono);">${icon}</span>
      <span style="flex: 1;">${escapeHtml(message)}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.transition = 'opacity 250ms, transform 250ms';
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  // --- HTML Escaping Helper ---
  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --- Modal Helpers ---
  function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
  }

  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }
  }

  // --- Theme Controller ---
  function initTheme() {
    const stored = localStorage.getItem('housing_theme') || 'light';
    document.documentElement.setAttribute('data-theme', stored);

    const toggleBtn = document.getElementById('theme-toggle-btn');
    if (toggleBtn) {
      updateThemeBtnIcon(toggleBtn, stored);
      toggleBtn.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('housing_theme', next);
        updateThemeBtnIcon(toggleBtn, next);
      });
    }
  }

  function updateThemeBtnIcon(btn, theme) {
    btn.innerHTML = theme === 'dark' 
      ? '<span title="Switch to light mode">☀ Light</span>' 
      : '<span title="Switch to dark mode">☾ Dark</span>';
  }

  // --- Active Society Manager ---
  function getActiveSocietyId() {
    // Check if societyId is in the pathname e.g. /societies/:societyId/...
    const match = window.location.pathname.match(/\/societies\/([a-f0-9]{24})/i);
    if (match) {
      localStorage.setItem('active_society_id', match[1]);
      return match[1];
    }
    return localStorage.getItem('active_society_id') || '';
  }

  function setActiveSociety(societyId) {
    if (societyId) {
      localStorage.setItem('active_society_id', societyId);
      window.location.href = `/societies/${societyId}/dashboard`;
    }
  }

  // --- Notification Badge Update (Single Check on Load / On Demand) ---
  async function checkNotifications() {
    const societyId = getActiveSocietyId();
    if (!societyId) return;

    const res = await apiFetch(`/api/societies/${societyId}/notifications?limit=5`);
    if (res && res.success) {
      const badge = document.getElementById('nav-notification-badge');
      if (badge) {
        const count = res.unreadCount || 0;
        if (count > 0) {
          badge.textContent = count > 99 ? '99+' : count;
          badge.style.display = 'inline-flex';
        } else {
          badge.style.display = 'none';
        }
      }
    }
  }

  // --- Global Logout Action ---
  async function handleLogout() {
    const res = await apiFetch('/api/auth/logout', { method: 'POST' });
    if (res && res.success) {
      localStorage.removeItem('active_society_id');
      showToast('Logged out successfully', 'success');
      setTimeout(() => {
        window.location.href = '/login';
      }, 500);
    } else {
      showToast('Logout error', 'error');
    }
  }

  // --- Initializer on DOM Load ---
  document.addEventListener('DOMContentLoaded', () => {
    initTheme();

    // Attach global modal overlay close listeners
    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          closeModal(overlay.id);
        }
      });
    });

    // Close buttons inside modals
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const modal = btn.closest('.modal-overlay');
        if (modal) closeModal(modal.id);
      });
    });

    // Logout button handler (all logout buttons across navbar and view panels)
    document.querySelectorAll('#nav-logout-btn, #panel-logout-btn, #zero-affiliations-logout-btn, .logout-btn, [data-action="logout"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        handleLogout();
      });
    });

    // Society switcher select change
    const societySelect = document.getElementById('nav-society-select');
    if (societySelect) {
      societySelect.addEventListener('change', (e) => {
        setActiveSociety(e.target.value);
      });
    }

    // Accessible Escape key listener to dismiss open modals
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const activeModal = document.querySelector('.modal-overlay.active');
        if (activeModal) {
          closeModal(activeModal.id);
        }
      }
    });

    // Check notifications on initial page load if user is in an active society view
    if (getActiveSocietyId() && document.getElementById('nav-notification-badge')) {
      checkNotifications();
    }
  });

  // Expose global helpers to window
  window.HousingUI = {
    getCsrfToken,
    apiFetch,
    showToast,
    escapeHtml,
    openModal,
    closeModal,
    getActiveSocietyId,
    setActiveSociety,
    handleLogout,
    checkNotifications
  };
})();
