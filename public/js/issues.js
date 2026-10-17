/**
 * ARCHITECTURAL EDITORIAL ISSUE CLIENT
 * Handles issue creation form, location toggling, drag-and-drop evidence,
 * and dashboard filtering for resident and administrator views.
 */

(function () {
  'use strict';

  // --- 1. Issue Creation Form Logic ---
  const issueForm = document.getElementById('create-issue-form');
  if (issueForm) {
    const locUnitRadio = document.getElementById('loc-type-unit');
    const locCommonRadio = document.getElementById('loc-type-common');
    const unitFields = document.getElementById('unit-location-fields');
    const commonFields = document.getElementById('common-location-fields');

    const blockInput = document.getElementById('blockOrWing');
    const flatInput = document.getElementById('flatOrUnit');
    const areaInput = document.getElementById('areaDescription');

    const titleInput = document.getElementById('issue-title');
    const descInput = document.getElementById('issue-desc');
    const titleCounter = document.getElementById('title-counter');
    const descCounter = document.getElementById('desc-counter');

    const fileDropzone = document.getElementById('evidence-dropzone');
    const fileInput = document.getElementById('evidence-file-input');
    const fileDisplay = document.getElementById('selected-file-display');
    const fileNameSpan = document.getElementById('selected-file-name');
    const fileSizeSpan = document.getElementById('selected-file-size');
    const removeFileBtn = document.getElementById('remove-file-btn');
    const captionInput = document.getElementById('evidence-caption');

    const alertBox = document.getElementById('issue-form-alert');
    const submitBtn = document.getElementById('submit-issue-btn');
    const societyId = document.getElementById('society-id-val').value;

    let selectedFile = null;

    // Toggle Location Type
    function handleLocationToggle() {
      if (locCommonRadio.checked) {
        unitFields.style.display = 'none';
        commonFields.style.display = 'block';
      } else {
        unitFields.style.display = 'grid';
        commonFields.style.display = 'none';
      }
    }
    if (locUnitRadio && locCommonRadio) {
      locUnitRadio.addEventListener('change', handleLocationToggle);
      locCommonRadio.addEventListener('change', handleLocationToggle);
    }

    // Character Counters
    if (titleInput && titleCounter) {
      titleInput.addEventListener('input', () => {
        titleCounter.textContent = `${titleInput.value.length} / 120`;
      });
    }
    if (descInput && descCounter) {
      descInput.addEventListener('input', () => {
        descCounter.textContent = `${descInput.value.length} / 2000`;
      });
    }

    // Drag and Drop File Handlers
    if (fileDropzone && fileInput) {
      fileDropzone.addEventListener('click', () => fileInput.click());

      fileDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        fileDropzone.classList.add('dragover');
      });

      fileDropzone.addEventListener('dragleave', () => {
        fileDropzone.classList.remove('dragover');
      });

      fileDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        fileDropzone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          handleFileSelected(e.dataTransfer.files[0]);
        }
      });

      fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files[0]) {
          handleFileSelected(fileInput.files[0]);
        }
      });
    }

    function handleFileSelected(file) {
      // Validate file size (5MB max)
      const maxBytes = 5 * 1024 * 1024;
      if (file.size > maxBytes) {
        HousingUI.showToast('File exceeds 5MB limit. Please select a smaller file.', 'error');
        return;
      }

      // Validate MIME type
      const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
      if (!allowed.includes(file.type)) {
        HousingUI.showToast('Invalid file format. Allowed: JPEG, PNG, WebP, PDF.', 'error');
        return;
      }

      selectedFile = file;
      fileNameSpan.textContent = file.name;
      fileSizeSpan.textContent = `${(file.size / 1024).toFixed(1)} KB`;
      fileDisplay.style.display = 'flex';
      fileDropzone.style.display = 'none';
    }

    if (removeFileBtn) {
      removeFileBtn.addEventListener('click', () => {
        selectedFile = null;
        fileInput.value = '';
        fileDisplay.style.display = 'none';
        fileDropzone.style.display = 'block';
      });
    }

    // Submit Issue Form
    issueForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      alertBox.classList.remove('visible');
      alertBox.textContent = '';

      const isCommon = locCommonRadio.checked;
      const title = (titleInput.value || '').trim();
      const description = (descInput.value || '').trim();
      const category = (issueForm.querySelector('input[name="category"]:checked')?.value || 'other');
      const priority = document.getElementById('issue-priority')?.value || 'normal';

      let hasError = false;

      let firstInvalidInput = null;

      // Location validation
      let locationObj = { type: isCommon ? 'common_area' : 'unit' };
      if (!isCommon) {
        const block = (blockInput.value || '').trim();
        const flat = (flatInput.value || '').trim();
        if (!block) {
          document.getElementById('block-error').classList.add('visible');
          blockInput.setAttribute('aria-invalid', 'true');
          hasError = true;
          if (!firstInvalidInput) firstInvalidInput = blockInput;
        } else {
          document.getElementById('block-error').classList.remove('visible');
          blockInput.setAttribute('aria-invalid', 'false');
          locationObj.blockOrWing = block;
        }
        if (!flat) {
          document.getElementById('flat-error').classList.add('visible');
          flatInput.setAttribute('aria-invalid', 'true');
          hasError = true;
          if (!firstInvalidInput) firstInvalidInput = flatInput;
        } else {
          document.getElementById('flat-error').classList.remove('visible');
          flatInput.setAttribute('aria-invalid', 'false');
          locationObj.flatOrUnit = flat;
        }
      } else {
        const area = (areaInput.value || '').trim();
        if (!area || area.length < 2) {
          document.getElementById('area-error').classList.add('visible');
          areaInput.setAttribute('aria-invalid', 'true');
          hasError = true;
          if (!firstInvalidInput) firstInvalidInput = areaInput;
        } else {
          document.getElementById('area-error').classList.remove('visible');
          areaInput.setAttribute('aria-invalid', 'false');
          locationObj.areaDescription = area;
        }
      }

      // Title validation (5-120 chars)
      if (!title || title.length < 5 || title.length > 120) {
        document.getElementById('title-error').classList.add('visible');
        titleInput.setAttribute('aria-invalid', 'true');
        hasError = true;
        if (!firstInvalidInput) firstInvalidInput = titleInput;
      } else {
        document.getElementById('title-error').classList.remove('visible');
        titleInput.setAttribute('aria-invalid', 'false');
      }

      // Description validation (10-2000 chars)
      if (!description || description.length < 10 || description.length > 2000) {
        document.getElementById('desc-error').classList.add('visible');
        descInput.setAttribute('aria-invalid', 'true');
        hasError = true;
        if (!firstInvalidInput) firstInvalidInput = descInput;
      } else {
        document.getElementById('desc-error').classList.remove('visible');
        descInput.setAttribute('aria-invalid', 'false');
      }

      if (hasError) {
        if (firstInvalidInput) firstInvalidInput.focus();
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Transmitting Manifest...</span>';

      // 1. Submit Issue Metadata
      const issueRes = await HousingUI.apiFetch(`/api/societies/${societyId}/issues`, {
        method: 'POST',
        body: JSON.stringify({
          title,
          description,
          category,
          location: locationObj,
          priority
        })
      });

      if (!issueRes || !issueRes.success) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Submit Issue Manifest</span>';
        alertBox.textContent = issueRes ? (issueRes.message || 'Failed to submit issue.') : 'Server error';
        alertBox.classList.add('visible');
        return;
      }

      const createdIssueId = issueRes.issue._id;

      // 2. If evidence file is attached, upload file to the created issue
      if (selectedFile) {
        submitBtn.innerHTML = '<span>Uploading Evidence Attachment...</span>';
        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('context', 'issue');
        if (captionInput.value.trim()) {
          formData.append('caption', captionInput.value.trim());
        }

        const uploadRes = await HousingUI.apiFetch(`/api/societies/${societyId}/issues/${createdIssueId}/evidence`, {
          method: 'POST',
          body: formData
        });

        if (!uploadRes || !uploadRes.success) {
          HousingUI.showToast('Issue created, but evidence attachment failed to save: ' + (uploadRes?.message || 'Error'), 'warning');
        } else {
          HousingUI.showToast('Issue manifest and evidence uploaded successfully!', 'success');
        }
      } else {
        HousingUI.showToast('Issue manifest submitted successfully!', 'success');
      }

      // Redirect to newly created issue details
      setTimeout(() => {
        window.location.href = `/societies/${societyId}/issues/${createdIssueId}`;
      }, 700);
    });
  }

  // --- 2. Dashboard Operations Queue & API Sync Logic ---
  const filterStatus = document.getElementById('filter-status');
  const filterPriority = document.getElementById('filter-priority');
  const filterCategory = document.getElementById('filter-category');
  const searchInput = document.getElementById('search-issues');
  const sortSelect = document.getElementById('sort-issues');
  const tabBtns = document.querySelectorAll('.tab-group .tab-btn');
  const countTag = document.getElementById('issue-count-tag');
  const noMatchingRow = document.getElementById('no-matching-issues-row');
  const clearFiltersBtn = document.getElementById('clear-filters-btn');

  const refreshBtn = document.getElementById('refresh-manifest-btn');
  const refreshSpinner = document.getElementById('refresh-spinner');
  const refreshLabel = document.getElementById('refresh-label');
  const loadingIndicator = document.getElementById('manifest-loading-indicator');
  const manifestErrorAlert = document.getElementById('manifest-error-alert');

  const adminTable = document.getElementById('admin-issues-table');
  const residentTable = document.getElementById('resident-issues-table');
  const tableBody = adminTable ? adminTable.querySelector('tbody') : (residentTable ? residentTable.querySelector('tbody') : null);
  const isAdminView = Boolean(adminTable);

  let currentTab = 'all';

  function applyFilters() {
    const rows = document.querySelectorAll('.issue-row');
    const selectedStatus = filterStatus ? filterStatus.value : '';
    const selectedPriority = filterPriority ? filterPriority.value : '';
    const selectedCategory = filterCategory ? filterCategory.value : '';
    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

    let visibleCount = 0;

    rows.forEach((row) => {
      const status = row.getAttribute('data-status') || '';
      const priority = row.getAttribute('data-priority') || '';
      const category = (row.getAttribute('data-category') || '').toLowerCase();
      const locationType = row.getAttribute('data-location-type') || '';
      const title = (row.getAttribute('data-title') || '').toLowerCase();
      const resident = (row.getAttribute('data-resident') || '').toLowerCase();
      const unit = (row.getAttribute('data-unit') || '').toLowerCase();
      const refId = row.getAttribute('data-id') ? row.getAttribute('data-id').slice(-6).toLowerCase() : '';

      let matches = true;

      // Tab filter
      if (isAdminView) {
        if (currentTab === 'needs-review' && !['submitted', 'under_review'].includes(status)) matches = false;
        if (currentTab === 'in-repair' && !['scheduled', 'in_progress', 'provider_contact_pending', 'awaiting_information', 'verification_rejected', 'reopened'].includes(status)) matches = false;
        if (currentTab === 'awaiting-verification' && status !== 'completion_submitted') matches = false;
        if (currentTab === 'closed' && !['verified_closed', 'cancelled'].includes(status)) matches = false;
      } else {
        if (currentTab === 'my-unit' && locationType !== 'unit') matches = false;
        if (currentTab === 'common-area' && locationType !== 'common_area') matches = false;
      }

      // Dropdown filters
      if (selectedStatus && status !== selectedStatus) matches = false;
      if (selectedPriority && priority !== selectedPriority) matches = false;
      if (selectedCategory && category !== selectedCategory.toLowerCase()) matches = false;

      // Text query search: title, refId, resident name, unit, category
      if (query && !title.includes(query) && !refId.includes(query) && !resident.includes(query) && !unit.includes(query) && !category.includes(query)) {
        matches = false;
      }

      if (matches) {
        row.style.display = '';
        visibleCount++;
      } else {
        row.style.display = 'none';
      }
    });

    // Sorting
    if (sortSelect && tableBody) {
      const sortVal = sortSelect.value;
      const sortedRows = Array.from(rows).sort((a, b) => {
        if (sortVal === 'oldest') {
          return (parseInt(a.getAttribute('data-created') || '0', 10)) - (parseInt(b.getAttribute('data-created') || '0', 10));
        } else if (sortVal === 'priority') {
          return (parseInt(b.getAttribute('data-priority-rank') || '0', 10)) - (parseInt(a.getAttribute('data-priority-rank') || '0', 10));
        } else {
          // 'newest' default
          return (parseInt(b.getAttribute('data-created') || '0', 10)) - (parseInt(a.getAttribute('data-created') || '0', 10));
        }
      });

      sortedRows.forEach((row) => {
        if (noMatchingRow) {
          tableBody.insertBefore(row, noMatchingRow);
        } else {
          tableBody.appendChild(row);
        }
      });
    }

    if (noMatchingRow) {
      noMatchingRow.style.display = (visibleCount === 0 && rows.length > 0) ? '' : 'none';
    }

    if (countTag) {
      countTag.textContent = `${visibleCount} DISPLAYED`;
    }
  }

  function updateMetrics(issues) {
    if (isAdminView) {
      const needsReviewEl = document.getElementById('metric-admin-review');
      const awaitingVerifEl = document.getElementById('metric-admin-verification');
      const activeRepairsEl = document.getElementById('metric-admin-repairs');
      const closedEl = document.getElementById('metric-admin-closed');

      if (needsReviewEl) {
        needsReviewEl.textContent = issues.filter(i => ['submitted', 'under_review'].includes(i.status)).length;
      }
      if (awaitingVerifEl) {
        awaitingVerifEl.textContent = issues.filter(i => i.status === 'completion_submitted').length;
      }
      if (activeRepairsEl) {
        activeRepairsEl.textContent = issues.filter(i => ['scheduled', 'in_progress', 'provider_contact_pending', 'awaiting_information', 'verification_rejected', 'reopened'].includes(i.status)).length;
      }
      if (closedEl) {
        closedEl.textContent = issues.filter(i => ['verified_closed', 'cancelled'].includes(i.status)).length;
      }
    } else {
      const myActiveEl = document.getElementById('metric-my-active');
      const underReviewEl = document.getElementById('metric-under-review');
      const inProgressEl = document.getElementById('metric-in-progress');
      const closedEl = document.getElementById('metric-closed');

      if (myActiveEl) {
        myActiveEl.textContent = issues.filter(i => !['verified_closed', 'cancelled'].includes(i.status)).length;
      }
      if (underReviewEl) {
        underReviewEl.textContent = issues.filter(i => ['under_review', 'awaiting_information', 'provider_contact_pending'].includes(i.status)).length;
      }
      if (inProgressEl) {
        inProgressEl.textContent = issues.filter(i => ['scheduled', 'in_progress', 'completion_submitted'].includes(i.status)).length;
      }
      if (closedEl) {
        closedEl.textContent = issues.filter(i => i.status === 'verified_closed').length;
      }
    }
  }

  function renderTableRows(issues, societyId) {
    if (!tableBody) return;
    const existingRows = tableBody.querySelectorAll('.issue-row');
    existingRows.forEach(r => r.remove());

    const fragment = document.createDocumentFragment();

    issues.forEach((issue) => {
      const tr = document.createElement('tr');
      tr.className = 'issue-row';
      tr.setAttribute('data-id', issue._id);
      tr.setAttribute('data-status', issue.status || '');
      tr.setAttribute('data-priority', issue.priority || '');
      tr.setAttribute('data-priority-rank', issue.priority === 'urgent' ? 4 : (issue.priority === 'high' ? 3 : (issue.priority === 'normal' ? 2 : 1)));
      tr.setAttribute('data-category', issue.category || '');
      tr.setAttribute('data-location-type', issue.location?.type || '');
      tr.setAttribute('data-title', (issue.title || '').toLowerCase());
      tr.setAttribute('data-resident', (issue.submittingResident?.name || '').toLowerCase());
      tr.setAttribute('data-unit', issue.location?.type === 'unit' ? `${issue.location.blockOrWing || ''} ${issue.location.flatOrUnit || ''}`.toLowerCase() : '');
      tr.setAttribute('data-created', issue.createdAt ? new Date(issue.createdAt).getTime() : 0);

      const refId = String(issue._id).slice(-6).toUpperCase();
      const cancelHtml = issue.cancellationReason ? `<div style="font-size: 0.75rem; color: var(--accent-crimson);">Cancelled: ${HousingUI.escapeHtml(issue.cancellationReason)}</div>` : '';

      let locHtml = '';
      if (issue.location?.type === 'unit') {
        locHtml = `<span style="font-size: 0.82rem; font-weight: 500;">Unit: ${HousingUI.escapeHtml(issue.location.blockOrWing || '')} - ${HousingUI.escapeHtml(issue.location.flatOrUnit || '')}</span>`;
      } else if (issue.location?.type === 'common_area') {
        locHtml = `<span style="font-size: 0.82rem; color: var(--accent-blueprint);">Common: ${HousingUI.escapeHtml(issue.location.areaDescription || '')}</span>`;
      }

      const dateStr = issue.createdAt ? new Date(issue.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      const statusFormatted = (issue.status || '').replace(/_/g, ' ');

      if (isAdminView) {
        const residentName = issue.submittingResident?.name ? HousingUI.escapeHtml(issue.submittingResident.name) : 'Unknown';
        const phone = issue.submittingResident?.phone ? ` · ${HousingUI.escapeHtml(issue.submittingResident.phone)}` : '';

        let actionBtn = `<a href="/societies/${societyId}/issues/${issue._id}" class="btn btn-outline btn-sm">Manage &rarr;</a>`;
        if (issue.status === 'submitted') {
          actionBtn = `<a href="/societies/${societyId}/issues/${issue._id}" class="btn btn-primary btn-sm">Review & Triage &rarr;</a>`;
        } else if (issue.status === 'completion_submitted') {
          actionBtn = `<a href="/societies/${societyId}/issues/${issue._id}" class="btn btn-secondary btn-sm" style="color: var(--accent-amber); font-weight: 700;">Verify & Sign-off &rarr;</a>`;
        } else if (issue.status === 'awaiting_information') {
          actionBtn = `<a href="/societies/${societyId}/issues/${issue._id}" class="btn btn-outline btn-sm">Awaiting Info &rarr;</a>`;
        } else if (['scheduled', 'in_progress'].includes(issue.status)) {
          actionBtn = `<a href="/societies/${societyId}/issues/${issue._id}" class="btn btn-outline btn-sm">Track Repair &rarr;</a>`;
        }

        tr.innerHTML = `
          <td><span class="tag-mono">#${refId}</span></td>
          <td>
            <a href="/societies/${societyId}/issues/${issue._id}" style="font-weight: 600; color: var(--text-primary); display: block;">${HousingUI.escapeHtml(issue.title)}</a>
            <span style="font-size: 0.78rem; color: var(--text-muted);">By: ${residentName}${phone}</span>
            ${cancelHtml}
          </td>
          <td><span class="tag-mono" style="text-transform: capitalize;">${HousingUI.escapeHtml(issue.category || '')}</span></td>
          <td>${locHtml}</td>
          <td><span class="badge-priority ${issue.priority}">${issue.priority}</span></td>
          <td><span class="badge-status ${issue.status}">${statusFormatted}</span></td>
          <td style="font-family: var(--font-mono); font-size: 0.78rem;">${dateStr}</td>
          <td style="text-align: right;">${actionBtn}</td>
        `;
      } else {
        const titleHtml = `<a href="/societies/${societyId}/issues/${issue._id}" style="font-weight: 600; color: var(--text-primary);">${HousingUI.escapeHtml(issue.title)}</a>`;
        tr.innerHTML = `
          <td><span class="tag-mono">#${refId}</span></td>
          <td>${titleHtml}${cancelHtml}</td>
          <td><span class="tag-mono" style="text-transform: capitalize;">${HousingUI.escapeHtml(issue.category || '')}</span></td>
          <td>${locHtml}</td>
          <td><span class="badge-priority ${issue.priority}">${issue.priority}</span></td>
          <td><span class="badge-status ${issue.status}">${statusFormatted}</span></td>
          <td style="font-family: var(--font-mono); font-size: 0.78rem;">${dateStr}</td>
          <td style="text-align: right;">
            <a href="/societies/${societyId}/issues/${issue._id}" class="btn btn-outline btn-sm">Inspect &rarr;</a>
          </td>
        `;
      }

      fragment.appendChild(tr);
    });

    if (noMatchingRow) {
      tableBody.insertBefore(fragment, noMatchingRow);
    } else {
      tableBody.appendChild(fragment);
    }
  }

  async function syncIssuesFromApi() {
    const societyId = document.getElementById('society-id-val')?.value || HousingUI.getActiveSocietyId();
    if (!societyId || !tableBody) return;

    if (refreshBtn) refreshBtn.disabled = true;
    if (refreshSpinner) refreshSpinner.style.display = 'inline';
    if (refreshLabel) refreshLabel.textContent = 'Syncing...';
    if (loadingIndicator) loadingIndicator.style.display = 'block';
    if (manifestErrorAlert) {
      manifestErrorAlert.style.display = 'none';
      manifestErrorAlert.textContent = '';
    }

    const res = await HousingUI.apiFetch(`/api/societies/${societyId}/issues`);

    if (refreshBtn) refreshBtn.disabled = false;
    if (refreshSpinner) refreshSpinner.style.display = 'none';
    if (refreshLabel) refreshLabel.textContent = '↻ Sync API';
    if (loadingIndicator) loadingIndicator.style.display = 'none';

    if (res && res.success && Array.isArray(res.issues)) {
      renderTableRows(res.issues, societyId);
      updateMetrics(res.issues);
      applyFilters();
      HousingUI.showToast(`Synchronized ${res.issues.length} issues with society register`, 'success');
    } else {
      const msg = res ? (res.message || 'Failed to sync issues from server.') : 'Network or server error';
      if (manifestErrorAlert) {
        manifestErrorAlert.textContent = msg;
        manifestErrorAlert.style.display = 'block';
      }
      HousingUI.showToast(msg, 'error');
    }
  }

  if (filterStatus) filterStatus.addEventListener('change', applyFilters);
  if (filterPriority) filterPriority.addEventListener('change', applyFilters);
  if (filterCategory) filterCategory.addEventListener('change', applyFilters);
  if (searchInput) searchInput.addEventListener('input', applyFilters);
  if (sortSelect) sortSelect.addEventListener('change', applyFilters);

  function resetAllFilters() {
    if (filterStatus) filterStatus.value = '';
    if (filterPriority) filterPriority.value = '';
    if (filterCategory) filterCategory.value = '';
    if (searchInput) searchInput.value = '';
    if (sortSelect) sortSelect.value = 'newest';
    tabBtns.forEach((b) => b.classList.remove('active'));
    const allTab = document.querySelector('.tab-group .tab-btn[data-tab="all"]');
    if (allTab) allTab.classList.add('active');
    currentTab = 'all';
    applyFilters();
  }

  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', resetAllFilters);
  }
  document.querySelectorAll('.clear-filters-trigger').forEach((btn) => {
    btn.addEventListener('click', resetAllFilters);
  });

  if (refreshBtn) {
    refreshBtn.addEventListener('click', (e) => {
      e.preventDefault();
      syncIssuesFromApi();
    });
  }

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentTab = btn.getAttribute('data-tab');
      applyFilters();
    });
  });

  // Interactive metric cards click listeners
  document.querySelectorAll('.metric-card-interactive').forEach((card) => {
    card.addEventListener('click', () => {
      const targetTab = card.getAttribute('data-tab-target');
      if (targetTab) {
        const matchingTabBtn = document.querySelector(`.tab-group .tab-btn[data-tab="${targetTab}"]`);
        if (matchingTabBtn) {
          matchingTabBtn.click();
        }
      }
    });
  });

  // Run initial filter check
  applyFilters();
})();
