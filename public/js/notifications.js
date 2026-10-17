/**
 * ARCHITECTURAL EDITORIAL NOTIFICATION CENTER
 * Handles notification filtering, read status changes, dynamic counts, and manual refresh.
 */

(function () {
  'use strict';

  const match = window.location.pathname.match(/\/societies\/([a-f0-9]{24})/i);
  if (!match) return;
  const societyId = match[1];

  let currentTab = 'all'; // 'all' | 'unread'
  let isProcessing = false;

  // DOM Elements
  const markAllBtn = document.getElementById('mark-all-read-btn');
  const refreshBtn = document.getElementById('refresh-notif-btn');
  const refreshSpinner = document.getElementById('refresh-notif-spinner');
  const refreshText = document.getElementById('refresh-notif-text');
  const tabAll = document.getElementById('tab-notif-all');
  const tabUnread = document.getElementById('tab-notif-unread');
  const tabAllCount = document.getElementById('tab-all-count');
  const tabUnreadCount = document.getElementById('tab-unread-count');
  const metricTotal = document.getElementById('metric-total-notifications');
  const metricUnread = document.getElementById('metric-unread-notifications');
  const metricRead = document.getElementById('metric-read-notifications');
  const listContainer = document.getElementById('notifications-list');
  const emptyAll = document.getElementById('notifications-empty-all');
  const emptyUnread = document.getElementById('notifications-empty-unread');
  const alertBox = document.getElementById('notifications-alert');
  const alertText = document.getElementById('notifications-alert-text');
  const alertRetry = document.getElementById('notifications-alert-retry');
  const loadingBox = document.getElementById('notifications-loading');

  function updateNavBadge(unread) {
    const navBadge = document.getElementById('nav-notification-badge');
    if (navBadge) {
      if (unread > 0) {
        navBadge.textContent = unread > 99 ? '99+' : unread;
        navBadge.style.display = 'inline-flex';
      } else {
        navBadge.style.display = 'none';
      }
    }
  }

  function recalcCounts() {
    if (!listContainer) return { total: 0, unread: 0, read: 0 };
    const items = listContainer.querySelectorAll('.notification-item');
    const total = items.length;
    let unread = 0;
    items.forEach((item) => {
      if (item.getAttribute('data-read') === 'false') {
        unread++;
      }
    });
    const read = total - unread;

    if (tabAllCount) tabAllCount.textContent = total;
    if (tabUnreadCount) tabUnreadCount.textContent = unread;
    if (metricTotal) metricTotal.textContent = total;
    if (metricUnread) metricUnread.textContent = unread;
    if (metricRead) metricRead.textContent = read;

    updateNavBadge(unread);
    return { total, unread, read };
  }

  function applyTabFilter() {
    const { total, unread } = recalcCounts();
    const items = listContainer ? listContainer.querySelectorAll('.notification-item') : [];

    if (currentTab === 'all') {
      if (tabAll) {
        tabAll.classList.add('active');
        tabAll.setAttribute('aria-selected', 'true');
      }
      if (tabUnread) {
        tabUnread.classList.remove('active');
        tabUnread.setAttribute('aria-selected', 'false');
      }
      items.forEach((item) => {
        item.style.display = 'flex';
      });
      if (emptyUnread) emptyUnread.style.display = 'none';
      if (emptyAll) emptyAll.style.display = total === 0 ? 'block' : 'none';
    } else {
      if (tabUnread) {
        tabUnread.classList.add('active');
        tabUnread.setAttribute('aria-selected', 'true');
      }
      if (tabAll) {
        tabAll.classList.remove('active');
        tabAll.setAttribute('aria-selected', 'false');
      }
      items.forEach((item) => {
        item.style.display = item.getAttribute('data-read') === 'false' ? 'flex' : 'none';
      });
      if (emptyAll) emptyAll.style.display = 'none';
      if (emptyUnread) emptyUnread.style.display = unread === 0 ? 'block' : 'none';
    }
  }

  function showAlert(msg) {
    if (alertBox && alertText) {
      alertText.textContent = msg || 'An error occurred while synchronizing notifications.';
      alertBox.style.display = 'block';
    }
  }

  function hideAlert() {
    if (alertBox) alertBox.style.display = 'none';
  }

  // --- Mark Single Notification As Read ---
  async function handleMarkSingleRead(btn) {
    const notifId = btn.getAttribute('data-id');
    if (!notifId || btn.disabled) return;

    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = 'Updating...';

    const res = await HousingUI.apiFetch(`/api/societies/${societyId}/notifications/${notifId}/read`, {
      method: 'PATCH'
    });

    if (res && res.success) {
      HousingUI.showToast('Notification marked as read', 'success');
      const item = btn.closest('.notification-item');
      if (item) {
        item.setAttribute('data-read', 'true');
        item.style.borderColor = 'var(--border-subtle)';
        const dot = item.querySelector('.unread-dot');
        if (dot) dot.remove();
        btn.remove();
      }
      applyTabFilter();
    } else {
      HousingUI.showToast(res?.message || 'Failed to mark notification as read', 'error');
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  // --- Mark All Notifications As Read ---
  async function handleMarkAllRead() {
    if (isProcessing) return;
    const { unread } = recalcCounts();
    if (unread === 0) {
      HousingUI.showToast('All notifications are already marked as read', 'info');
      return;
    }

    isProcessing = true;
    if (markAllBtn) {
      markAllBtn.disabled = true;
      markAllBtn.innerHTML = '<span>Updating...</span>';
    }

    const res = await HousingUI.apiFetch(`/api/societies/${societyId}/notifications/read-all`, {
      method: 'POST'
    });

    if (res && res.success) {
      HousingUI.showToast('All notifications marked as read', 'success');
      if (listContainer) {
        listContainer.querySelectorAll('.notification-item').forEach((item) => {
          item.setAttribute('data-read', 'true');
          item.style.borderColor = 'var(--border-subtle)';
          const dot = item.querySelector('.unread-dot');
          if (dot) dot.remove();
          const btn = item.querySelector('.mark-read-single-btn');
          if (btn) btn.remove();
        });
      }
      applyTabFilter();
    } else {
      HousingUI.showToast(res?.message || 'Failed to update notifications', 'error');
    }

    isProcessing = false;
    if (markAllBtn) {
      markAllBtn.disabled = false;
      markAllBtn.innerHTML = '<span>✓ Mark All as Read</span>';
    }
  }

  // --- Refresh / Fetch Notification Data ---
  function renderNotificationItemHtml(n) {
    const isUnread = !n.read;
    const formattedType = HousingUI.escapeHtml((n.type || 'alert').replace(/_/g, ' '));
    const formattedDate = new Date(n.createdAt).toLocaleString();
    const safeTitle = HousingUI.escapeHtml(n.title || '');
    const safeMsg = HousingUI.escapeHtml(n.message || '');
    const issueLink = n.issue ? `/societies/${societyId}/issues/${n.issue._id || n.issue}` : null;

    return `
      <div 
        class="notification-item" 
        data-id="${n._id}" 
        data-read="${!isUnread}"
        style="background: var(--bg-surface-elevated); border: 1px solid ${isUnread ? 'var(--accent-amber)' : 'var(--border-subtle)'}; border-radius: var(--radius-sm); padding: 1rem 1.25rem; display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; transition: all var(--transition-fast);"
      >
        <div style="flex: 1;">
          <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem; flex-wrap: wrap;">
            ${isUnread ? '<span class="unread-dot" style="width: 8px; height: 8px; border-radius: 50%; background: var(--accent-amber); display: inline-block;" aria-label="Unread"></span>' : ''}
            <span class="tag-mono" style="text-transform: uppercase;">${formattedType}</span>
            <span style="font-size: 0.75rem; color: var(--text-muted); font-family: var(--font-mono);">
              ${formattedDate}
            </span>
          </div>

          <div style="font-weight: 600; font-size: 0.95rem; color: var(--text-primary); margin-bottom: 0.25rem;">
            ${safeTitle}
          </div>

          <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 0 0 0.5rem 0;">
            ${safeMsg}
          </p>

          ${issueLink ? `
            <a href="${issueLink}" style="font-size: 0.8rem; font-weight: 600; color: var(--accent-amber);" aria-label="Inspect issue related to ${safeTitle}">
              Inspect Related Issue &rarr;
            </a>
          ` : ''}
        </div>

        ${isUnread ? `
          <button type="button" class="btn btn-outline btn-sm mark-read-single-btn" data-id="${n._id}" style="font-size: 0.75rem; white-space: nowrap;" aria-label="Mark notification as read">
            Mark Read
          </button>
        ` : ''}
      </div>
    `;
  }

  async function handleRefresh() {
    if (isProcessing) return;
    isProcessing = true;
    hideAlert();

    if (refreshBtn) refreshBtn.disabled = true;
    if (refreshSpinner) refreshSpinner.style.display = 'inline';
    if (refreshText) refreshText.textContent = 'Refreshing...';
    if (loadingBox) loadingBox.style.display = 'block';

    const res = await HousingUI.apiFetch(`/api/societies/${societyId}/notifications?limit=50`);

    if (loadingBox) loadingBox.style.display = 'none';

    if (res && res.success && Array.isArray(res.notifications)) {
      if (listContainer) {
        if (res.notifications.length === 0) {
          listContainer.innerHTML = '';
        } else {
          listContainer.innerHTML = res.notifications.map(renderNotificationItemHtml).join('');
        }
      }
      applyTabFilter();
      HousingUI.showToast('Notification dispatch log refreshed', 'info');
    } else {
      showAlert(res?.message || 'Failed to refresh notification dispatch log.');
      HousingUI.showToast('Failed to refresh notifications', 'error');
    }

    if (refreshBtn) refreshBtn.disabled = false;
    if (refreshSpinner) refreshSpinner.style.display = 'none';
    if (refreshText) refreshText.textContent = '↻ Refresh';
    isProcessing = false;
  }

  // --- Event Listeners Initialization ---
  document.addEventListener('DOMContentLoaded', () => {
    // Initial count sync & tab filtering
    applyTabFilter();

    // Mark single button click delegation on container
    if (listContainer) {
      listContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.mark-read-single-btn');
        if (btn) {
          e.preventDefault();
          handleMarkSingleRead(btn);
        }
      });
    }

    // Mark all button
    if (markAllBtn) {
      markAllBtn.addEventListener('click', (e) => {
        e.preventDefault();
        handleMarkAllRead();
      });
    }

    // Refresh button
    if (refreshBtn) {
      refreshBtn.addEventListener('click', (e) => {
        e.preventDefault();
        handleRefresh();
      });
    }

    // Alert retry button
    if (alertRetry) {
      alertRetry.addEventListener('click', (e) => {
        e.preventDefault();
        handleRefresh();
      });
    }

    // Tab buttons
    if (tabAll) {
      tabAll.addEventListener('click', () => {
        currentTab = 'all';
        applyTabFilter();
      });
    }

    if (tabUnread) {
      tabUnread.addEventListener('click', () => {
        currentTab = 'unread';
        applyTabFilter();
      });
    }
  });
})();
