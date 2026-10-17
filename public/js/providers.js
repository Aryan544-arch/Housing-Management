/**
 * ARCHITECTURAL EDITORIAL PROVIDER MANAGEMENT CLIENT
 * Phase 2.6: Contractor Directory, Filter/Search, Sync, Register/Edit, and Activation/Deactivation
 */

(function () {
  'use strict';

  // Extract societyId from URL pathname or hidden DOM element
  const pathMatch = window.location.pathname.match(/\/societies\/([a-f0-9]{24})/i);
  const hiddenSocInput = document.getElementById('society-id-val');
  const societyId = pathMatch ? pathMatch[1] : (hiddenSocInput ? hiddenSocInput.value : HousingUI.getActiveSocietyId());

  if (!societyId) return;

  // DOM Elements: Filtering & Search
  const catFilter = document.getElementById('prov-filter-category');
  const statusFilter = document.getElementById('prov-filter-status');
  const sortSelect = document.getElementById('prov-sort');
  const searchInput = document.getElementById('prov-search');
  const clearFiltersBtn = document.getElementById('clear-prov-filters-btn');
  const countTag = document.getElementById('provider-count-tag');

  // DOM Elements: Metrics
  const metricTotal = document.getElementById('metric-prov-total');
  const metricActive = document.getElementById('metric-prov-active');
  const metricInactive = document.getElementById('metric-prov-inactive');

  // DOM Elements: Tables & States
  const providersContainer = document.getElementById('providers-container');
  const providersTableWrap = document.getElementById('providers-table-wrap');
  const providersEmptyState = document.getElementById('providers-empty-state');
  const providersTbody = document.getElementById('providers-tbody');
  const noMatchingRow = document.getElementById('no-matching-providers-row');
  const loadingIndicator = document.getElementById('providers-loading-indicator');
  const providersAlert = document.getElementById('providers-alert');

  // DOM Elements: Sync API Button
  const refreshBtn = document.getElementById('refresh-providers-btn');
  const refreshSpinner = document.getElementById('prov-refresh-spinner');
  const refreshLabel = document.getElementById('prov-refresh-label');

  // DOM Elements: Modal & Form
  const openAddBtn = document.getElementById('open-add-provider-btn');
  const providerModal = document.getElementById('provider-modal');
  const providerForm = document.getElementById('provider-form');
  const modalTitle = document.getElementById('provider-modal-title');
  const providerIdHidden = document.getElementById('provider-id-hidden');
  const modalAlert = document.getElementById('provider-modal-alert');
  const submitBtn = document.getElementById('save-provider-submit-btn');

  const nameInput = document.getElementById('prov-name-input');
  const statusSelect = document.getElementById('prov-status-select');
  const phoneInput = document.getElementById('prov-phone-input');
  const emailInput = document.getElementById('prov-email-input');
  const personInput = document.getElementById('prov-person-input');
  const descInput = document.getElementById('prov-desc-input');
  const rateTypeSelect = document.getElementById('prov-rate-type');
  const minRateInput = document.getElementById('prov-min-rate');
  const maxRateInput = document.getElementById('prov-max-rate');
  const estimateInput = document.getElementById('prov-estimate-input');
  const allBlocksCheck = document.getElementById('prov-all-blocks');
  const blocksGroup = document.getElementById('prov-blocks-group');
  const blocksInput = document.getElementById('prov-blocks-input');

  // Toggle restricted blocks input visibility
  if (allBlocksCheck && blocksGroup) {
    allBlocksCheck.addEventListener('change', () => {
      blocksGroup.style.display = allBlocksCheck.checked ? 'none' : 'block';
      if (allBlocksCheck.checked && blocksInput) {
        blocksInput.value = '';
      }
    });
  }

  // --- 1. Filtering & Sorting ---
  function applyFiltersAndSort() {
    if (!providersTbody) return;

    const rows = Array.from(providersTbody.querySelectorAll('.provider-row'));
    const selectedCat = catFilter ? catFilter.value.trim().toLowerCase() : '';
    const selectedStatus = statusFilter ? statusFilter.value.trim().toLowerCase() : '';
    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const sortMode = sortSelect ? sortSelect.value : 'name-asc';

    let matchedRows = [];
    let unmatchedRows = [];

    rows.forEach((row) => {
      const name = (row.getAttribute('data-name') || '').toLowerCase();
      const status = (row.getAttribute('data-status') || '').toLowerCase();
      const categories = (row.getAttribute('data-categories') || '').toLowerCase();
      const phone = (row.getAttribute('data-phone') || '').toLowerCase();
      const email = (row.getAttribute('data-email') || '').toLowerCase();
      const person = (row.getAttribute('data-person') || '').toLowerCase();

      let matches = true;

      if (selectedCat && !categories.includes(selectedCat)) {
        matches = false;
      }
      if (selectedStatus && status !== selectedStatus) {
        matches = false;
      }
      if (query) {
        const fullSearchString = `${name} ${phone} ${person} ${email} ${categories}`;
        if (!fullSearchString.includes(query)) {
          matches = false;
        }
      }

      if (matches) {
        matchedRows.push(row);
      } else {
        unmatchedRows.push(row);
      }
    });

    // Sort matched rows
    matchedRows.sort((a, b) => {
      const nameA = (a.getAttribute('data-name') || '').toLowerCase();
      const nameB = (b.getAttribute('data-name') || '').toLowerCase();
      const statusA = (a.getAttribute('data-status') || '').toLowerCase();
      const statusB = (b.getAttribute('data-status') || '').toLowerCase();

      if (sortMode === 'name-desc') {
        return nameB.localeCompare(nameA);
      }
      if (sortMode === 'status-active') {
        if (statusA === 'active' && statusB !== 'active') return -1;
        if (statusA !== 'active' && statusB === 'active') return 1;
        return nameA.localeCompare(nameB);
      }
      // Default: name-asc
      return nameA.localeCompare(nameB);
    });

    // Re-append sorted rows into tbody
    matchedRows.forEach((row) => {
      row.style.display = '';
      providersTbody.appendChild(row);
    });

    unmatchedRows.forEach((row) => {
      row.style.display = 'none';
    });

    // Keep noMatchingRow at the bottom of tbody
    if (noMatchingRow) {
      providersTbody.appendChild(noMatchingRow);
      if (matchedRows.length === 0 && rows.length > 0) {
        noMatchingRow.style.display = '';
      } else {
        noMatchingRow.style.display = 'none';
      }
    }

    // Update count display
    if (countTag) {
      if (selectedCat || selectedStatus || query) {
        countTag.textContent = `${matchedRows.length} DISPLAYED`;
      } else {
        countTag.textContent = `${rows.length} RECORDED`;
      }
    }
  }

  function resetFilters() {
    if (catFilter) catFilter.value = '';
    if (statusFilter) statusFilter.value = '';
    if (sortSelect) sortSelect.value = 'name-asc';
    if (searchInput) searchInput.value = '';
    applyFiltersAndSort();
  }

  if (catFilter) catFilter.addEventListener('change', applyFiltersAndSort);
  if (statusFilter) statusFilter.addEventListener('change', applyFiltersAndSort);
  if (sortSelect) sortSelect.addEventListener('change', applyFiltersAndSort);
  if (searchInput) searchInput.addEventListener('input', applyFiltersAndSort);
  if (clearFiltersBtn) clearFiltersBtn.addEventListener('click', resetFilters);

  // --- 2. Synchronize Contractor Roster via API ---
  async function syncProviders(silent = false) {
    if (refreshBtn) {
      refreshBtn.disabled = true;
      if (refreshSpinner) refreshSpinner.style.display = 'inline-block';
      if (refreshLabel) refreshLabel.textContent = 'Syncing...';
    }
    if (loadingIndicator) loadingIndicator.style.display = 'block';
    if (providersAlert) providersAlert.style.display = 'none';

    try {
      const res = await HousingUI.apiFetch(`/api/societies/${societyId}/providers?limit=100`);

      if (res && res.success && Array.isArray(res.providers)) {
        updateDirectoryView(res.providers);
        if (!silent) {
          HousingUI.showToast('Contractor roster synchronized with society register', 'success');
        }
      } else {
        const errorMsg = res?.message || 'Failed to synchronize contractor roster.';
        if (providersAlert) {
          providersAlert.textContent = `Sync Error: ${errorMsg}`;
          providersAlert.style.display = 'block';
        }
        if (!silent) {
          HousingUI.showToast(errorMsg, 'error');
        }
      }
    } catch (err) {
      const errorMsg = err.message || 'Network error while fetching contractors.';
      if (providersAlert) {
        providersAlert.textContent = `Sync Error: ${errorMsg}`;
        providersAlert.style.display = 'block';
      }
      if (!silent) {
        HousingUI.showToast(errorMsg, 'error');
      }
    } finally {
      if (loadingIndicator) loadingIndicator.style.display = 'none';
      if (refreshBtn) {
        refreshBtn.disabled = false;
        if (refreshSpinner) refreshSpinner.style.display = 'none';
        if (refreshLabel) refreshLabel.textContent = '↻ Sync API';
      }
    }
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => syncProviders(false));
  }

  // --- 3. Dynamic Roster View Renderer ---
  function updateDirectoryView(providers) {
    // Update metric counters
    const totalCount = providers.length;
    const activeCount = providers.filter((p) => p.status === 'active').length;
    const inactiveCount = providers.filter((p) => p.status === 'inactive').length;

    if (metricTotal) metricTotal.textContent = totalCount;
    if (metricActive) metricActive.textContent = activeCount;
    if (metricInactive) metricInactive.textContent = inactiveCount;

    if (totalCount === 0) {
      if (providersTableWrap) providersTableWrap.style.display = 'none';
      if (providersEmptyState) providersEmptyState.style.display = 'block';
      if (countTag) countTag.textContent = '0 RECORDED';
      return;
    }

    if (providersEmptyState) providersEmptyState.style.display = 'none';
    if (providersTableWrap) providersTableWrap.style.display = 'block';

    if (!providersTbody) return;

    // Clear existing provider rows (preserving noMatchingRow)
    providersTbody.querySelectorAll('.provider-row').forEach((row) => row.remove());

    // Build and insert new rows
    providers.forEach((prov) => {
      const tr = document.createElement('tr');
      tr.className = 'provider-row';
      tr.setAttribute('data-id', prov._id);
      tr.setAttribute('data-name', (prov.name || '').toLowerCase());
      tr.setAttribute('data-status', prov.status || 'active');
      tr.setAttribute('data-categories', (prov.categories || []).join(' ').toLowerCase());
      tr.setAttribute('data-phone', (prov.contactPhone || '').toLowerCase());
      tr.setAttribute('data-email', (prov.contactEmail || '').toLowerCase());
      tr.setAttribute('data-person', (prov.contactPerson || '').toLowerCase());

      const descHtml = prov.description
        ? `<div style="font-size: 0.75rem; color: var(--text-muted); max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${HousingUI.escapeHtml(prov.description)}</div>`
        : '';

      const categoriesHtml = (prov.categories || [])
        .map((cat) => `<span class="tag-mono" style="text-transform: capitalize;">${HousingUI.escapeHtml(cat)}</span>`)
        .join('');

      const emailHtml = prov.contactEmail
        ? `<div style="font-size: 0.72rem; color: var(--text-muted);">${HousingUI.escapeHtml(prov.contactEmail)}</div>`
        : '';

      let pricingSub = '';
      if (prov.pricing && (prov.pricing.minRate !== undefined || prov.pricing.maxRate !== undefined)) {
        pricingSub = `<div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.2rem;">₹${prov.pricing.minRate || 0} - ₹${prov.pricing.maxRate || '...'}</div>`;
      } else if (prov.priceEstimate || (prov.pricing && prov.pricing.estimate)) {
        pricingSub = `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.2rem;">${HousingUI.escapeHtml(prov.priceEstimate || prov.pricing.estimate)}</div>`;
      }

      const rateTypeLabel = prov.pricing && prov.pricing.rateType ? prov.pricing.rateType.replace(/_/g, ' ') : 'Quote';

      let areaHtml = '<span class="tag-mono" style="color: var(--accent-sage);">ALL BLOCKS</span>';
      if (prov.serviceArea && prov.serviceArea.allBlocks === false) {
        const blocksList = (prov.serviceArea.blocks || []).join(', ') || 'Restricted';
        areaHtml = `<span class="tag-mono" style="color: var(--accent-blueprint);">${HousingUI.escapeHtml(blocksList)}</span>`;
      }

      const isActive = prov.status === 'active';
      const statusBadge = `<span class="badge-status ${isActive ? 'verified_closed' : 'cancelled'}">${HousingUI.escapeHtml(prov.status)}</span>`;

      const actionBtn = isActive
        ? `<button type="button" class="btn btn-outline btn-sm toggle-status-provider-btn" data-id="${prov._id}" data-name="${HousingUI.escapeHtml(prov.name)}" data-action="deactivate">Deactivate</button>`
        : `<button type="button" class="btn btn-secondary btn-sm toggle-status-provider-btn" data-id="${prov._id}" data-name="${HousingUI.escapeHtml(prov.name)}" data-action="activate" style="color: var(--accent-sage);">Activate</button>`;

      tr.innerHTML = `
        <td>
          <strong style="color: var(--text-primary); font-size: 0.92rem;">${HousingUI.escapeHtml(prov.name)}</strong>
          ${descHtml}
        </td>
        <td>
          <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
            ${categoriesHtml}
          </div>
        </td>
        <td style="font-family: var(--font-mono); font-size: 0.82rem; color: var(--text-primary);">
          ${HousingUI.escapeHtml(prov.contactPhone)}
          ${emailHtml}
        </td>
        <td style="font-size: 0.85rem;">
          ${HousingUI.escapeHtml(prov.contactPerson || 'Office / Primary')}
        </td>
        <td>
          <span class="tag-mono" style="text-transform: uppercase;">${HousingUI.escapeHtml(rateTypeLabel)}</span>
          ${pricingSub}
        </td>
        <td>${areaHtml}</td>
        <td>${statusBadge}</td>
        <td style="text-align: right; white-space: nowrap;">
          <button type="button" class="btn btn-outline btn-sm edit-provider-btn" data-id="${prov._id}">Edit</button>
          ${actionBtn}
        </td>
      `;

      providersTbody.appendChild(tr);
    });

    if (noMatchingRow) {
      providersTbody.appendChild(noMatchingRow);
    }

    applyFiltersAndSort();
  }

  // --- 4. Activation & Deactivation ---
  async function handleToggleStatus(btn) {
    const providerId = btn.getAttribute('data-id');
    const name = btn.getAttribute('data-name');
    const action = btn.getAttribute('data-action');

    if (!providerId || !action) return;

    if (action === 'deactivate') {
      const confirmDeact = window.confirm(
        `Are you sure you want to deactivate contractor "${name}"?\nDeactivated contractors are excluded from automatic repair issue suggestions.`
      );
      if (!confirmDeact) return;
    }

    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = action === 'deactivate' ? 'Deactivating...' : 'Activating...';

    try {
      let res;
      if (action === 'deactivate') {
        // DELETE endpoint deactivates the provider (or permanently deletes if unreferenced and permanent=true)
        res = await HousingUI.apiFetch(`/api/societies/${societyId}/providers/${providerId}`, {
          method: 'DELETE'
        });
      } else {
        // PATCH endpoint activates the provider
        res = await HousingUI.apiFetch(`/api/societies/${societyId}/providers/${providerId}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'active' })
        });
      }

      if (res && res.success) {
        HousingUI.showToast(
          res.message || (action === 'deactivate' ? `Contractor ${name} deactivated` : `Contractor ${name} activated`),
          'success'
        );
        // Refresh directory view smoothly
        await syncProviders(true);
      } else {
        HousingUI.showToast(res?.message || `Failed to ${action} contractor`, 'error');
        btn.disabled = false;
        btn.textContent = originalText;
      }
    } catch (err) {
      HousingUI.showToast(err.message || 'Operation failed', 'error');
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  // --- 5. Add / Edit Provider Modal ---
  function clearModalAlert() {
    if (modalAlert) {
      modalAlert.style.display = 'none';
      modalAlert.textContent = '';
    }
  }

  function showModalAlert(msg) {
    if (modalAlert) {
      modalAlert.textContent = msg;
      modalAlert.style.display = 'block';
      modalAlert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function resetProviderForm() {
    if (providerForm) providerForm.reset();
    if (providerIdHidden) providerIdHidden.value = '';
    clearModalAlert();

    if (modalTitle) modalTitle.textContent = 'Register Service Contractor';
    if (statusSelect) statusSelect.value = 'active';

    if (allBlocksCheck) allBlocksCheck.checked = true;
    if (blocksGroup) blocksGroup.style.display = 'none';
    if (blocksInput) blocksInput.value = '';

    if (rateTypeSelect) rateTypeSelect.value = 'quote_required';
    if (minRateInput) minRateInput.value = '';
    if (maxRateInput) maxRateInput.value = '';
    if (estimateInput) estimateInput.value = '';

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save Contractor';
    }
  }

  if (openAddBtn) {
    openAddBtn.addEventListener('click', () => {
      resetProviderForm();
      HousingUI.openModal('provider-modal');
      setTimeout(() => {
        if (nameInput) nameInput.focus();
      }, 100);
    });
  }

  async function openEditModal(providerId) {
    resetProviderForm();
    if (modalTitle) modalTitle.textContent = 'Edit Service Contractor';
    if (providerIdHidden) providerIdHidden.value = providerId;

    HousingUI.openModal('provider-modal');

    try {
      const res = await HousingUI.apiFetch(`/api/societies/${societyId}/providers/${providerId}`);
      if (res && res.success && res.provider) {
        const p = res.provider;
        if (nameInput) nameInput.value = p.name || '';
        if (statusSelect) statusSelect.value = p.status || 'active';
        if (phoneInput) phoneInput.value = p.contactPhone || '';
        if (emailInput) emailInput.value = p.contactEmail || '';
        if (personInput) personInput.value = p.contactPerson || '';
        if (descInput) descInput.value = p.description || '';

        // Populate category checkboxes
        const catBoxes = providerForm.querySelectorAll('input[name="prov-cat"]');
        catBoxes.forEach((cb) => {
          cb.checked = Array.isArray(p.categories) && p.categories.includes(cb.value);
        });

        // Populate pricing
        if (p.pricing) {
          if (rateTypeSelect) rateTypeSelect.value = p.pricing.rateType || 'quote_required';
          if (minRateInput) minRateInput.value = p.pricing.minRate !== undefined && p.pricing.minRate !== null ? p.pricing.minRate : '';
          if (maxRateInput) maxRateInput.value = p.pricing.maxRate !== undefined && p.pricing.maxRate !== null ? p.pricing.maxRate : '';
          if (estimateInput) estimateInput.value = p.priceEstimate || p.pricing.estimate || '';
        } else if (p.priceEstimate && estimateInput) {
          estimateInput.value = p.priceEstimate;
        }

        // Populate service area
        if (p.serviceArea) {
          const isAll = p.serviceArea.allBlocks !== false;
          if (allBlocksCheck) allBlocksCheck.checked = isAll;
          if (blocksGroup) blocksGroup.style.display = isAll ? 'none' : 'block';
          if (blocksInput) blocksInput.value = (p.serviceArea.blocks || []).join(', ');
        }
      } else {
        showModalAlert(res?.message || 'Failed to retrieve contractor details from server.');
      }
    } catch (err) {
      showModalAlert(err.message || 'Error loading contractor details.');
    }
  }

  // Provider Form Submission (Create or Update)
  if (providerForm) {
    providerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearModalAlert();

      const name = nameInput ? nameInput.value.trim() : '';
      const status = statusSelect ? statusSelect.value : 'active';
      const contactPhone = phoneInput ? phoneInput.value.trim() : '';
      const contactEmail = emailInput ? emailInput.value.trim() : '';
      const contactPerson = personInput ? personInput.value.trim() : '';
      const description = descInput ? descInput.value.trim() : '';
      const rateType = rateTypeSelect ? rateTypeSelect.value : 'quote_required';
      const estimate = estimateInput ? estimateInput.value.trim() : '';

      const checkedCats = Array.from(providerForm.querySelectorAll('input[name="prov-cat"]:checked')).map((c) => c.value);

      // Client-Side Accessible Validation
      if (!name || name.length < 2) {
        showModalAlert('Contractor name is required and must be at least 2 characters long.');
        if (nameInput) nameInput.focus();
        return;
      }

      if (name.length > 100) {
        showModalAlert('Contractor name cannot exceed 100 characters.');
        if (nameInput) nameInput.focus();
        return;
      }

      if (checkedCats.length === 0) {
        showModalAlert('At least one trade category must be selected for the contractor.');
        return;
      }

      if (!contactPhone || contactPhone.length < 5) {
        showModalAlert('Valid contact phone is required (at least 5 characters).');
        if (phoneInput) phoneInput.focus();
        return;
      }

      if (contactPhone.length > 30) {
        showModalAlert('Contact phone cannot exceed 30 characters.');
        if (phoneInput) phoneInput.focus();
        return;
      }

      if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
        showModalAlert('Contact email format is invalid. Please enter a valid email address or leave it blank.');
        if (emailInput) emailInput.focus();
        return;
      }

      // Validate pricing numbers
      let minRateVal;
      let maxRateVal;

      if (minRateInput && minRateInput.value.trim() !== '') {
        const parsed = parseFloat(minRateInput.value.trim());
        if (isNaN(parsed) || parsed < 0) {
          showModalAlert('Minimum rate must be a non-negative number.');
          minRateInput.focus();
          return;
        }
        minRateVal = parsed;
      }

      if (maxRateInput && maxRateInput.value.trim() !== '') {
        const parsed = parseFloat(maxRateInput.value.trim());
        if (isNaN(parsed) || parsed < 0) {
          showModalAlert('Maximum rate must be a non-negative number.');
          maxRateInput.focus();
          return;
        }
        maxRateVal = parsed;
      }

      if (minRateVal !== undefined && maxRateVal !== undefined && maxRateVal < minRateVal) {
        showModalAlert('Maximum rate cannot be less than minimum rate.');
        if (maxRateInput) maxRateInput.focus();
        return;
      }

      // Build service area
      const allBlocks = allBlocksCheck ? allBlocksCheck.checked : true;
      let blocks = [];
      if (!allBlocks && blocksInput && blocksInput.value.trim()) {
        blocks = blocksInput.value
          .split(',')
          .map((b) => b.trim())
          .filter(Boolean);
      }

      // Construct payload strictly matching backend ALLOWED_PROVIDER_FIELDS
      const payload = {
        name,
        categories: checkedCats,
        description: description.slice(0, 1000),
        serviceArea: {
          allBlocks,
          blocks: allBlocks ? [] : blocks
        },
        contactPhone,
        contactEmail: contactEmail.toLowerCase(),
        contactPerson: contactPerson.slice(0, 100),
        pricing: {
          rateType,
          estimate: estimate.slice(0, 100)
        },
        priceEstimate: estimate.slice(0, 100),
        status
      };

      if (minRateVal !== undefined) {
        payload.pricing.minRate = minRateVal;
      }
      if (maxRateVal !== undefined) {
        payload.pricing.maxRate = maxRateVal;
      }

      const providerId = providerIdHidden ? providerIdHidden.value.trim() : '';
      const endpoint = providerId
        ? `/api/societies/${societyId}/providers/${providerId}`
        : `/api/societies/${societyId}/providers`;
      const method = providerId ? 'PATCH' : 'POST';

      // Prevent duplicate submissions
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving Contractor...';
      }

      try {
        const res = await HousingUI.apiFetch(endpoint, {
          method,
          body: JSON.stringify(payload)
        });

        if (res && res.success) {
          HousingUI.showToast(
            res.message || (providerId ? `Contractor ${name} updated successfully` : `Contractor ${name} registered successfully`),
            'success'
          );
          HousingUI.closeModal('provider-modal');
          // Re-sync roster to show updated record
          await syncProviders(true);
        } else {
          // Display server validation or duplicate error, preserving user input
          const errMsg = res?.message || 'Failed to save contractor details. Please review fields.';
          showModalAlert(errMsg);
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save Contractor';
          }
        }
      } catch (err) {
        showModalAlert(err.message || 'Network error while saving contractor.');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Save Contractor';
        }
      }
    });
  }

  // --- 6. Event Delegation for Action Buttons inside Table ---
  if (providersContainer) {
    providersContainer.addEventListener('click', (e) => {
      // Edit button click
      const editBtn = e.target.closest('.edit-provider-btn');
      if (editBtn) {
        const providerId = editBtn.getAttribute('data-id');
        if (providerId) openEditModal(providerId);
        return;
      }

      // Activate / Deactivate button click
      const toggleBtn = e.target.closest('.toggle-status-provider-btn');
      if (toggleBtn) {
        handleToggleStatus(toggleBtn);
        return;
      }

      // Clear filters trigger inside empty row
      const clearTrigger = e.target.closest('.clear-prov-filters-trigger');
      if (clearTrigger) {
        resetFilters();
        return;
      }
    });
  }

  // Initial filter/sort run
  applyFiltersAndSort();
})();
