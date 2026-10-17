/**
 * ARCHITECTURAL EDITORIAL ISSUE DETAILS & WORKFLOW CLIENT
 * Handles AI advisory, timeline notes, state machine transitions, repair progress,
 * costs, provider suggestions, and evidence upload.
 */

(function () {
  'use strict';

  // Parse societyId and issueId from pathname
  const urlMatch = window.location.pathname.match(/\/societies\/([a-f0-9]{24})\/issues\/([a-f0-9]{24})/i);
  if (!urlMatch) return;

  const societyId = urlMatch[1];
  const issueId = urlMatch[2];

  // --- 1. AI Advisory Inference Trigger ---
  const aiBtn = document.getElementById('trigger-ai-advisory-btn');
  const aiOutput = document.getElementById('ai-advisory-output');

  if (aiBtn && aiOutput) {
    aiBtn.addEventListener('click', async () => {
      aiBtn.disabled = true;
      aiBtn.innerHTML = '<span>Consulting AI Advisory Model...</span>';
      aiOutput.innerHTML = '<div style="padding: 1rem 0; color: var(--accent-amber); font-family: var(--font-mono); font-size: 0.85rem;">Ingesting manifest details & generating preliminary triage...</div>';

      const res = await HousingUI.apiFetch(`/api/societies/${societyId}/issues/${issueId}/ai-advisory`, {
        method: 'POST'
      });

      aiBtn.disabled = false;
      aiBtn.innerHTML = '<span>Re-run Analysis</span>';

      if (res && res.success && res.advisory) {
        const adv = res.advisory;
        let questionsHtml = '';
        if (adv.missingInformation && adv.missingInformation.length > 0) {
          questionsHtml = `
            <div style="margin-top: 0.75rem;">
              <strong style="font-size: 0.8rem; color: var(--text-primary); text-transform: uppercase; font-family: var(--font-mono);">Recommended Clarification Questions:</strong>
              <ul style="margin: 0.35rem 0 0 1.25rem; font-size: 0.82rem; color: var(--text-secondary);">
                ${adv.missingInformation.map((q) => `<li>${HousingUI.escapeHtml(q)}</li>`).join('')}
              </ul>
            </div>
          `;
        }

        const isAdmin = Boolean(document.getElementById('open-triage-modal-btn'));
        let adoptBtnHtml = '';
        if (isAdmin && adv.suggestedCategory && adv.suggestedPriority) {
          adoptBtnHtml = `
            <div style="margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
              <span style="font-size: 0.8rem; color: var(--text-secondary);">Apply AI suggestions to issue manifest?</span>
              <button type="button" id="adopt-ai-suggestions-btn" class="btn btn-secondary btn-sm" data-category="${HousingUI.escapeHtml(adv.suggestedCategory)}" data-priority="${HousingUI.escapeHtml(adv.suggestedPriority)}">
                <span>Adopt Suggestions (${HousingUI.escapeHtml(adv.suggestedCategory)} · ${HousingUI.escapeHtml(adv.suggestedPriority)})</span>
              </button>
            </div>
          `;
        }

        aiOutput.innerHTML = `
          <div style="display: flex; gap: 0.75rem; align-items: center; margin-bottom: 0.5rem; flex-wrap: wrap;">
            <span style="font-size: 0.82rem; color: var(--text-muted);">Suggested Category:</span>
            <span class="tag-mono" style="color: var(--accent-blueprint); text-transform: capitalize;">${HousingUI.escapeHtml(adv.suggestedCategory)}</span>
            <span style="font-size: 0.82rem; color: var(--text-muted); margin-left: 0.5rem;">Suggested Priority:</span>
            <span class="badge-priority ${adv.suggestedPriority}">${HousingUI.escapeHtml(adv.suggestedPriority)}</span>
            <span class="tag-mono" style="color: var(--accent-amber); margin-left: auto;">HUMAN REVIEW REQUIRED</span>
          </div>

          <p style="font-size: 0.88rem; color: var(--text-primary); line-height: 1.5; margin: 0.5rem 0;">
            ${HousingUI.escapeHtml(adv.explanation)}
          </p>

          ${questionsHtml}
          ${adoptBtnHtml}
        `;

        const adoptBtn = document.getElementById('adopt-ai-suggestions-btn');
        if (adoptBtn) {
          adoptBtn.addEventListener('click', async () => {
            adoptBtn.disabled = true;
            adoptBtn.textContent = 'Updating Triage...';

            const cat = adoptBtn.getAttribute('data-category');
            const prio = adoptBtn.getAttribute('data-priority');

            const patchRes = await HousingUI.apiFetch(`/api/societies/${societyId}/issues/${issueId}`, {
              method: 'PATCH',
              body: JSON.stringify({ category: cat, priority: prio })
            });

            if (patchRes && patchRes.success) {
              HousingUI.showToast('Issue reclassified with AI suggestions', 'success');
              setTimeout(() => window.location.reload(), 400);
            } else {
              HousingUI.showToast(patchRes?.message || 'Failed to apply triage', 'error');
              adoptBtn.disabled = false;
              adoptBtn.textContent = 'Retry Adopt Suggestions';
            }
          });
        }

        HousingUI.showToast('AI Advisory triage completed successfully', 'success');
      } else {
        const errMsg = res ? (res.message || 'AI service unavailable') : 'Failed to consult AI service';
        aiOutput.innerHTML = `
          <div style="padding: 1rem; background: var(--bg-surface-elevated); border: 1px solid var(--border-medium); border-radius: var(--radius-sm);">
            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem;">
              <span class="tag-mono" style="color: var(--accent-amber);">AI ADVISORY NOTICE</span>
            </div>
            <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 0;">${HousingUI.escapeHtml(errMsg)}</p>
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.5rem;">
              Operational triage and priority classification may proceed manually without AI guidance.
            </div>
          </div>
        `;
        HousingUI.showToast(errMsg, 'warning');
      }
    });
  }

  // --- 1b. Admin Triage & Metadata Reclassification Modal ---
  const openTriageBtn = document.getElementById('open-triage-modal-btn');
  const triageForm = document.getElementById('triage-issue-form');

  if (openTriageBtn) {
    openTriageBtn.addEventListener('click', () => HousingUI.openModal('triage-modal'));
  }

  if (triageForm) {
    triageForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const priority = document.getElementById('triage-priority')?.value;
      const category = document.getElementById('triage-category')?.value;

      if (!priority || !category) {
        HousingUI.showToast('Please select both priority and category', 'error');
        return;
      }

      const submitBtn = document.getElementById('submit-triage-btn');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving Changes...';
      }

      const res = await HousingUI.apiFetch(`/api/societies/${societyId}/issues/${issueId}`, {
        method: 'PATCH',
        body: JSON.stringify({ priority, category })
      });

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save Triage Changes';
      }

      if (res && res.success) {
        HousingUI.showToast('Issue triage metadata updated successfully', 'success');
        HousingUI.closeModal('triage-modal');
        setTimeout(() => window.location.reload(), 400);
      } else {
        HousingUI.showToast(res?.message || 'Failed to update triage metadata', 'error');
      }
    });
  }

  // --- 2. Timeline Note / Comment Form ---
  const noteForm = document.getElementById('add-note-form');
  if (noteForm) {
    const noteInput = document.getElementById('note-text');
    const noteCharCount = document.getElementById('note-char-count');
    const internalCheckbox = document.getElementById('note-is-internal');
    const submitBtn = document.getElementById('submit-note-btn');

    if (noteInput && noteCharCount) {
      noteInput.addEventListener('input', () => {
        const len = noteInput.value.length;
        noteCharCount.textContent = `${len} / 1000`;
        if (len > 1000) {
          noteCharCount.style.color = 'var(--accent-crimson)';
        } else {
          noteCharCount.style.color = 'var(--text-muted)';
        }
      });
    }

    noteForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const note = (noteInput.value || '').trim();

      if (!note || note.length < 2 || note.length > 1000) {
        document.getElementById('note-error').classList.add('visible');
        return;
      }
      document.getElementById('note-error').classList.remove('visible');

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Posting...</span>';

      const isInternal = internalCheckbox ? internalCheckbox.checked : false;

      const res = await HousingUI.apiFetch(`/api/societies/${societyId}/issues/${issueId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ note, isInternal })
      });

      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Post Comment &rarr;</span>';

      if (res && res.success) {
        HousingUI.showToast('Note added to timeline', 'success');
        setTimeout(() => window.location.reload(), 400);
      } else {
        HousingUI.showToast(res?.message || 'Failed to post note', 'error');
      }
    });
  }

  // --- 3. Status Transition Modal (Admin) ---
  const openStatusBtn = document.getElementById('open-status-modal-btn');
  const statusForm = document.getElementById('update-status-form');
  const toStatusSelect = document.getElementById('toStatus');
  const scheduledField = document.getElementById('status-scheduled-field');
  const completionField = document.getElementById('status-completion-field');
  const statusNoteLabel = document.getElementById('status-note-label');
  const statusNoteWarning = document.getElementById('status-note-warning');

  if (openStatusBtn) {
    openStatusBtn.addEventListener('click', () => HousingUI.openModal('status-modal'));
  }

  if (toStatusSelect) {
    toStatusSelect.addEventListener('change', () => {
      const val = toStatusSelect.value;
      if (scheduledField) {
        scheduledField.style.display = val === 'scheduled' ? 'block' : 'none';
      }
      if (completionField) {
        completionField.style.display = val === 'completion_submitted' ? 'block' : 'none';
      }
      if (statusNoteWarning) {
        const noteMandatory = ['awaiting_information', 'verification_rejected', 'cancelled'].includes(val);
        statusNoteWarning.style.display = noteMandatory ? 'block' : 'none';
      }
      if (statusNoteLabel) {
        if (val === 'verified_closed') {
          statusNoteLabel.textContent = 'Verification Sign-Off / Resolution Summary';
        } else if (val === 'verification_rejected') {
          statusNoteLabel.textContent = 'Rejection Reason (Mandatory) *';
        } else if (val === 'awaiting_information') {
          statusNoteLabel.textContent = 'Information Requested from Resident (Mandatory) *';
        } else if (val === 'cancelled') {
          statusNoteLabel.textContent = 'Cancellation Reason (Mandatory) *';
        } else {
          statusNoteLabel.textContent = 'Workflow Transition Note';
        }
      }
    });
  }

  if (statusForm) {
    statusForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const toStatus = toStatusSelect.value;
      const note = document.getElementById('status-note')?.value.trim() || '';
      const scheduledDate = document.getElementById('scheduledDate')?.value;
      const workSummary = document.getElementById('status-completion-summary')?.value.trim() || '';

      if (!toStatus) {
        HousingUI.showToast('Please select a target status transition', 'error');
        return;
      }

      if (toStatus === 'scheduled' && !scheduledDate) {
        HousingUI.showToast('A valid scheduled date is required for scheduled transition', 'error');
        return;
      }

      if (['awaiting_information', 'verification_rejected', 'cancelled'].includes(toStatus) && !note) {
        HousingUI.showToast('A note or reason is required for this transition', 'error');
        return;
      }

      const payload = { toStatus };
      if (note) payload.note = note;
      if (scheduledDate) payload.scheduledDate = scheduledDate;

      // Special transitions
      if (toStatus === 'verified_closed' && note) {
        payload.resolutionSummary = note;
      }
      if (toStatus === 'completion_submitted' && workSummary) {
        payload.completionDetails = { workSummary };
      }

      const submitBtn = document.getElementById('submit-status-btn');
      submitBtn.disabled = true;

      const res = await HousingUI.apiFetch(`/api/societies/${societyId}/issues/${issueId}/status`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });

      submitBtn.disabled = false;

      if (res && res.success) {
        HousingUI.showToast(`Issue status updated to ${toStatus}`, 'success');
        HousingUI.closeModal('status-modal');
        setTimeout(() => window.location.reload(), 400);
      } else {
        HousingUI.showToast(res?.message || 'Status transition failed', 'error');
      }
    });
  }

  // --- 4. Record Repair Progress Modal (Admin) ---
  const openProgressBtn = document.getElementById('record-progress-btn');
  const progressForm = document.getElementById('record-progress-form');
  const progressPct = document.getElementById('progress-pct');
  const progressPctVal = document.getElementById('progress-pct-val');

  if (openProgressBtn) {
    openProgressBtn.addEventListener('click', () => HousingUI.openModal('progress-modal'));
  }

  if (progressPct && progressPctVal) {
    progressPct.addEventListener('input', () => {
      progressPctVal.textContent = `${progressPct.value}%`;
    });
  }

  if (progressForm) {
    progressForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const note = document.getElementById('progress-note-text').value.trim();
      const progressPercentage = parseInt(progressPct.value, 10);
      const isInternal = document.getElementById('progress-is-internal').checked;

      if (!note || note.length < 2) {
        HousingUI.showToast('Progress note is required (min 2 characters)', 'error');
        return;
      }

      const submitBtn = document.getElementById('submit-progress-btn');
      submitBtn.disabled = true;

      const res = await HousingUI.apiFetch(`/api/societies/${societyId}/issues/${issueId}/progress`, {
        method: 'POST',
        body: JSON.stringify({ note, progressPercentage, isInternal })
      });

      submitBtn.disabled = false;

      if (res && res.success) {
        HousingUI.showToast('Progress recorded successfully', 'success');
        HousingUI.closeModal('progress-modal');
        setTimeout(() => window.location.reload(), 400);
      } else {
        HousingUI.showToast(res?.message || 'Failed to record progress', 'error');
      }
    });
  }

  // --- 5. Edit Costs Modal (Admin) ---
  const editCostsBtn = document.getElementById('edit-costs-btn');
  const costsForm = document.getElementById('edit-costs-form');
  const costMaterial = document.getElementById('cost-material');
  const costLabor = document.getElementById('cost-labor');
  const costOther = document.getElementById('cost-other');
  const costTotalDisplay = document.getElementById('cost-total-display');

  if (editCostsBtn) {
    editCostsBtn.addEventListener('click', () => HousingUI.openModal('costs-modal'));
  }

  function updateCostTotal() {
    const mat = parseFloat(costMaterial?.value) || 0;
    const lab = parseFloat(costLabor?.value) || 0;
    const oth = parseFloat(costOther?.value) || 0;
    const total = mat + lab + oth;
    if (costTotalDisplay) {
      costTotalDisplay.textContent = `₹ ${total.toLocaleString()} INR`;
    }
  }

  [costMaterial, costLabor, costOther].forEach((input) => {
    if (input) input.addEventListener('input', updateCostTotal);
  });

  if (costsForm) {
    costsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const materialCost = parseFloat(costMaterial.value) || 0;
      const laborCost = parseFloat(costLabor.value) || 0;
      const otherCost = parseFloat(costOther.value) || 0;
      const totalCost = materialCost + laborCost + otherCost;

      const submitBtn = document.getElementById('submit-costs-btn');
      submitBtn.disabled = true;

      const res = await HousingUI.apiFetch(`/api/societies/${societyId}/issues/${issueId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          costs: {
            materialCost,
            laborCost,
            otherCost,
            totalCost,
            currency: 'INR'
          }
        })
      });

      submitBtn.disabled = false;

      if (res && res.success) {
        HousingUI.showToast('Repair costs updated successfully', 'success');
        HousingUI.closeModal('costs-modal');
        setTimeout(() => window.location.reload(), 400);
      } else {
        HousingUI.showToast(res?.message || 'Failed to update costs', 'error');
      }
    });
  }

  // --- 6. Contractor Suggestions Modal & Assignment (Admin) ---
  const openProvidersBtn = document.getElementById('open-providers-modal-btn');
  const providersList = document.getElementById('providers-suggestions-list');

  async function loadProviderSuggestions() {
    if (!providersList) return;
    providersList.innerHTML = '<div style="padding: 1.5rem; text-align: center; color: var(--accent-amber); font-family: var(--font-mono); font-size: 0.85rem;">[ SEARCHING ACTIVE REGISTERED CONTRACTORS... ]</div>';

    const res = await HousingUI.apiFetch(`/api/societies/${societyId}/issues/${issueId}/provider-suggestions`);

    if (res && res.success && Array.isArray(res.suggestions)) {
      if (res.suggestions.length === 0) {
        providersList.innerHTML = `
          <div style="text-align: center; padding: 2.5rem 1.5rem; color: var(--text-muted);">
            <div style="font-size: 2rem; margin-bottom: 0.5rem; opacity: 0.6;">🔍</div>
            <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 0.35rem;">No Matching Contractors Found</div>
            <p style="font-size: 0.85rem; max-width: 420px; margin: 0 auto 1.25rem;">
              No active contractors in this society cover this issue's trade category and service area location.
            </p>
            <div>
              <a href="/societies/${societyId}/admin/providers" class="btn btn-outline btn-sm">+ Register or Activate Contractor</a>
            </div>
          </div>
        `;
        return;
      }

      providersList.innerHTML = `
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1rem; border-left: 3px solid var(--accent-amber); padding-left: 0.5rem; line-height: 1.4;">
          ${HousingUI.escapeHtml(res.suggestions[0]?.disclaimer || 'Criteria match only')}
        </div>
        <div style="display: flex; flex-direction: column; gap: 0.75rem;">
          ${res.suggestions
            .map((s) => {
              const p = s.provider;
              let pricingNote = (p.pricing && p.pricing.rateType) ? p.pricing.rateType.replace(/_/g, ' ') : 'Quote';
              if (p.pricing && (p.pricing.minRate !== undefined || p.pricing.maxRate !== undefined)) {
                pricingNote += ` (₹${p.pricing.minRate || 0} - ₹${p.pricing.maxRate || '...'})`;
              } else if (p.priceEstimate) {
                pricingNote += ` (${p.priceEstimate})`;
              }
              const tradeVal = (p.categories && p.categories[0]) || '';
              return `
                <div style="background: var(--bg-surface-elevated); border: 1px solid var(--border-medium); border-radius: var(--radius-sm); padding: 1rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
                  <div style="flex: 1; min-width: 240px;">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                      <strong style="color: var(--text-primary); font-size: 0.95rem;">${HousingUI.escapeHtml(p.name)}</strong>
                      <span class="tag-mono" style="color: var(--accent-sage);">MATCH</span>
                    </div>
                    <div style="font-size: 0.82rem; color: var(--text-secondary); margin-top: 0.25rem;">
                      Phone: <span style="font-family: var(--font-mono);">${HousingUI.escapeHtml(p.contactPhone)}</span>
                      ${p.contactPerson ? ' · Contact: ' + HousingUI.escapeHtml(p.contactPerson) : ''}
                    </div>
                    <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.2rem;">
                      Rate: <span style="text-transform: capitalize;">${HousingUI.escapeHtml(pricingNote)}</span>
                    </div>
                    <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.2rem; font-style: italic;">
                      ${HousingUI.escapeHtml(s.matchDetails?.compatibilityReason || '')}
                    </div>
                  </div>

                  <button type="button" class="btn btn-primary btn-sm assign-provider-btn" data-name="${HousingUI.escapeHtml(p.name)}" data-phone="${HousingUI.escapeHtml(p.contactPhone)}" data-trade="${HousingUI.escapeHtml(tradeVal)}">
                    Assign to Issue
                  </button>
                </div>
              `;
            })
            .join('')}
        </div>
      `;

      // Attach assign button listeners
      document.querySelectorAll('.assign-provider-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const companyOrName = btn.getAttribute('data-name');
          const contactPhone = btn.getAttribute('data-phone');
          const trade = btn.getAttribute('data-trade');

          btn.disabled = true;
          btn.textContent = 'Assigning...';

          const assignRes = await HousingUI.apiFetch(`/api/societies/${societyId}/issues/${issueId}`, {
            method: 'PATCH',
            body: JSON.stringify({
              externalProviderDetails: {
                companyOrName,
                contactPhone,
                trade
              }
            })
          });

          if (assignRes && assignRes.success) {
            HousingUI.showToast(`Contractor ${companyOrName} assigned to issue`, 'success');
            HousingUI.closeModal('providers-modal');
            setTimeout(() => window.location.reload(), 400);
          } else {
            HousingUI.showToast(assignRes?.message || 'Assignment failed', 'error');
            btn.disabled = false;
            btn.textContent = 'Assign to Issue';
          }
        });
      });
    } else {
      providersList.innerHTML = `
        <div style="padding: 1.5rem; text-align: center; color: var(--accent-crimson);">
          <div style="font-weight: 600; margin-bottom: 0.35rem;">Failed to retrieve provider suggestions.</div>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1rem;">${HousingUI.escapeHtml(res?.message || 'Server error')}</div>
          <button type="button" class="btn btn-secondary btn-sm" id="retry-prov-suggestions-btn">Retry Search</button>
        </div>
      `;
      document.getElementById('retry-prov-suggestions-btn')?.addEventListener('click', loadProviderSuggestions);
    }
  }

  if (openProvidersBtn && providersList) {
    openProvidersBtn.addEventListener('click', () => {
      HousingUI.openModal('providers-modal');
      loadProviderSuggestions();
    });
  }

  // Unassign contractor handler
  const unassignContractorBtn = document.getElementById('unassign-contractor-btn');
  if (unassignContractorBtn) {
    unassignContractorBtn.addEventListener('click', async () => {
      if (!confirm('Remove assigned contractor from this issue ticket?')) {
        return;
      }

      unassignContractorBtn.disabled = true;
      unassignContractorBtn.textContent = 'Removing...';

      const res = await HousingUI.apiFetch(`/api/societies/${societyId}/issues/${issueId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          externalProviderDetails: {
            companyOrName: '',
            contactPhone: '',
            trade: ''
          }
        })
      });

      if (res && res.success) {
        HousingUI.showToast('Contractor removed from issue', 'success');
        setTimeout(() => window.location.reload(), 300);
      } else {
        HousingUI.showToast(res?.message || 'Failed to remove contractor', 'error');
        unassignContractorBtn.disabled = false;
        unassignContractorBtn.textContent = '✕ Remove';
      }
    });
  }

  // --- 7. Resident Cancel & Reopen Modals ---
  const openCancelBtn = document.getElementById('open-cancel-modal-btn');
  const cancelForm = document.getElementById('cancel-issue-form');

  if (openCancelBtn) {
    openCancelBtn.addEventListener('click', () => HousingUI.openModal('cancel-modal'));
  }

  if (cancelForm) {
    cancelForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const reason = document.getElementById('cancel-reason').value.trim();
      if (!reason) {
        HousingUI.showToast('Cancellation reason is required', 'error');
        return;
      }

      const res = await HousingUI.apiFetch(`/api/societies/${societyId}/issues/${issueId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          toStatus: 'cancelled',
          cancellationReason: reason
        })
      });

      if (res && res.success) {
        HousingUI.showToast('Issue marked as cancelled', 'success');
        HousingUI.closeModal('cancel-modal');
        setTimeout(() => window.location.reload(), 400);
      } else {
        HousingUI.showToast(res?.message || 'Failed to cancel issue', 'error');
      }
    });
  }

  // --- 7b. Provide Requested Information Modal (Resident Submitter) ---
  const openProvideInfoBtn = document.getElementById('open-provide-info-btn');
  const provideInfoForm = document.getElementById('provide-info-form');

  if (openProvideInfoBtn) {
    openProvideInfoBtn.addEventListener('click', () => HousingUI.openModal('provide-info-modal'));
  }

  if (provideInfoForm) {
    provideInfoForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const note = document.getElementById('provide-info-text')?.value.trim();
      if (!note || note.length < 2) {
        HousingUI.showToast('Please provide your response details (min 2 characters)', 'error');
        return;
      }

      const submitBtn = document.getElementById('submit-provide-info-btn');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';
      }

      const res = await HousingUI.apiFetch(`/api/societies/${societyId}/issues/${issueId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          toStatus: 'under_review',
          note
        })
      });

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Response';
      }

      if (res && res.success) {
        HousingUI.showToast('Information submitted; issue returned to review', 'success');
        HousingUI.closeModal('provide-info-modal');
        setTimeout(() => window.location.reload(), 400);
      } else {
        HousingUI.showToast(res?.message || 'Failed to submit response', 'error');
      }
    });
  }

  const openReopenBtn = document.getElementById('open-reopen-modal-btn');
  const reopenForm = document.getElementById('reopen-issue-form');

  if (openReopenBtn) {
    openReopenBtn.addEventListener('click', () => HousingUI.openModal('reopen-modal'));
  }

  if (reopenForm) {
    reopenForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const note = document.getElementById('reopen-note').value.trim();
      if (!note) {
        HousingUI.showToast('Reopening note is required', 'error');
        return;
      }

      const res = await HousingUI.apiFetch(`/api/societies/${societyId}/issues/${issueId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          toStatus: 'reopened',
          note
        })
      });

      if (res && res.success) {
        HousingUI.showToast('Issue reopened successfully', 'success');
        HousingUI.closeModal('reopen-modal');
        setTimeout(() => window.location.reload(), 400);
      } else {
        HousingUI.showToast(res?.message || 'Failed to reopen issue', 'error');
      }
    });
  }

  // --- 8. Evidence Upload Modal ---
  const openEvidenceBtn = document.getElementById('open-evidence-upload-btn');
  const addEvidenceSubBtn = document.getElementById('add-evidence-sub-btn');
  const uploadEvidenceForm = document.getElementById('upload-evidence-form');
  const modalEvidenceFile = document.getElementById('modal-evidence-file');
  const evidenceUploadAlert = document.getElementById('evidence-upload-alert');

  const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

  if (openEvidenceBtn) {
    openEvidenceBtn.addEventListener('click', () => HousingUI.openModal('evidence-modal'));
  }
  if (addEvidenceSubBtn) {
    addEvidenceSubBtn.addEventListener('click', () => HousingUI.openModal('evidence-modal'));
  }

  if (modalEvidenceFile) {
    modalEvidenceFile.addEventListener('change', () => {
      if (evidenceUploadAlert) {
        evidenceUploadAlert.style.display = 'none';
        evidenceUploadAlert.textContent = '';
      }
      if (modalEvidenceFile.files && modalEvidenceFile.files[0]) {
        const file = modalEvidenceFile.files[0];
        if (!ALLOWED_MIME_TYPES.includes(file.type)) {
          if (evidenceUploadAlert) {
            evidenceUploadAlert.textContent = 'Invalid file type. Allowed formats: JPEG, PNG, WebP, PDF.';
            evidenceUploadAlert.style.display = 'block';
          }
          HousingUI.showToast('Invalid file format. Allowed: JPEG, PNG, WebP, PDF', 'error');
          modalEvidenceFile.value = '';
          return;
        }
        if (file.size > MAX_FILE_SIZE) {
          const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
          if (evidenceUploadAlert) {
            evidenceUploadAlert.textContent = `File exceeds 5MB size limit (${sizeMb} MB).`;
            evidenceUploadAlert.style.display = 'block';
          }
          HousingUI.showToast('File exceeds 5MB size limit', 'error');
          modalEvidenceFile.value = '';
          return;
        }
      }
    });
  }

  if (uploadEvidenceForm) {
    uploadEvidenceForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fileInput = document.getElementById('modal-evidence-file');
      const caption = document.getElementById('modal-evidence-caption')?.value.trim() || '';
      const contextSelect = document.getElementById('modal-evidence-context');
      const internalCheck = document.getElementById('modal-evidence-internal');

      if (!fileInput.files || !fileInput.files[0]) {
        if (evidenceUploadAlert) {
          evidenceUploadAlert.textContent = 'Please select a file to upload.';
          evidenceUploadAlert.style.display = 'block';
        }
        HousingUI.showToast('Please select a file to upload', 'error');
        return;
      }

      const file = fileInput.files[0];
      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        if (evidenceUploadAlert) {
          evidenceUploadAlert.textContent = 'Invalid file format. Allowed: JPEG, PNG, WebP, PDF.';
          evidenceUploadAlert.style.display = 'block';
        }
        HousingUI.showToast('Invalid file format', 'error');
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        if (evidenceUploadAlert) {
          evidenceUploadAlert.textContent = 'File exceeds maximum 5MB size limit.';
          evidenceUploadAlert.style.display = 'block';
        }
        HousingUI.showToast('File exceeds 5MB limit', 'error');
        return;
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('caption', caption);
      if (contextSelect) formData.append('context', contextSelect.value);
      if (internalCheck && internalCheck.checked) formData.append('isInternal', 'true');

      const submitBtn = document.getElementById('modal-upload-submit-btn');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Uploading...';

      const res = await HousingUI.apiFetch(`/api/societies/${societyId}/issues/${issueId}/evidence`, {
        method: 'POST',
        body: formData
      });

      submitBtn.disabled = false;
      submitBtn.textContent = 'Upload Evidence';

      if (res && res.success) {
        HousingUI.showToast('Evidence uploaded successfully', 'success');
        HousingUI.closeModal('evidence-modal');
        setTimeout(() => window.location.reload(), 400);
      } else {
        const errMsg = res?.message || 'Failed to upload evidence';
        if (evidenceUploadAlert) {
          evidenceUploadAlert.textContent = errMsg;
          evidenceUploadAlert.style.display = 'block';
        }
        HousingUI.showToast(errMsg, 'error');
      }
    });
  }
})();
