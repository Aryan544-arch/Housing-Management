/**
 * ARCHITECTURAL EDITORIAL SOCIETY MANAGEMENT CLIENT
 * Handles society registration and initial admin onboarding from the selection console.
 */

(function () {
  'use strict';

  const form = document.getElementById('create-society-form');
  if (!form) return;

  const nameInput = document.getElementById('society-name');
  const codeInput = document.getElementById('society-code');
  const addressInput = document.getElementById('society-address');
  const alertBox = document.getElementById('create-society-alert');
  const submitBtn = document.getElementById('create-society-submit-btn');
  const nameError = document.getElementById('society-name-error');
  const codeError = document.getElementById('society-code-error');

  // Auto-uppercase society code input as user types
  if (codeInput) {
    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.toUpperCase();
      if (codeError) codeError.classList.remove('visible');
    });
  }

  if (nameInput) {
    nameInput.addEventListener('input', () => {
      if (nameError) nameError.classList.remove('visible');
    });
  }

  function showAlert(message, isError = true) {
    if (!alertBox) return;
    alertBox.textContent = message;
    alertBox.style.display = 'block';
    if (isError) {
      alertBox.style.background = 'var(--accent-crimson-subtle)';
      alertBox.style.border = '1px solid rgba(248, 113, 113, 0.3)';
      alertBox.style.color = 'var(--accent-crimson)';
    } else {
      alertBox.style.background = 'rgba(74, 222, 128, 0.1)';
      alertBox.style.border = '1px solid rgba(74, 222, 128, 0.3)';
      alertBox.style.color = 'var(--accent-sage)';
    }
  }

  function hideAlert() {
    if (alertBox) {
      alertBox.style.display = 'none';
      alertBox.textContent = '';
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert();
    if (nameError) nameError.classList.remove('visible');
    if (codeError) codeError.classList.remove('visible');

    const name = (nameInput.value || '').trim();
    const code = (codeInput.value || '').trim().toUpperCase();
    const address = addressInput ? (addressInput.value || '').trim() : '';

    let hasError = false;

    if (!name || name.length < 2) {
      if (nameError) nameError.classList.add('visible');
      hasError = true;
    }

    if (!code || !/^[A-Z0-9_-]{3,20}$/.test(code)) {
      if (codeError) codeError.classList.add('visible');
      hasError = true;
    }

    if (hasError) return;

    // Enter loading state
    submitBtn.disabled = true;
    const originalContent = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span>Creating Society...</span>';

    try {
      const payload = {
        name,
        code,
        address: address ? { street: address } : {}
      };

      const res = await window.HousingUI.apiFetch('/api/societies', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (res && res.success && res.society && res.society._id) {
        showAlert('Society created successfully! Entering admin portal...', false);
        if (window.HousingUI.showToast) {
          window.HousingUI.showToast('Society registered! You are now admin.', 'success');
        }
        setTimeout(() => {
          window.location.href = `/societies/${res.society._id}/dashboard`;
        }, 600);
      } else {
        const message = (res && res.message) || 'Failed to create society. Please check your inputs.';
        showAlert(message, true);
        if (window.HousingUI.showToast) {
          window.HousingUI.showToast(message, 'error');
        }
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalContent;
      }
    } catch (err) {
      console.error('Error creating society:', err);
      showAlert(err.message || 'An unexpected error occurred.', true);
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalContent;
    }
  });
})();
