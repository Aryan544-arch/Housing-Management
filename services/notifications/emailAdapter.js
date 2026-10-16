/**
 * Email Adapter Strategy for Housing Management
 * Provides a replaceable, mockable email delivery interface.
 */

class BaseEmailAdapter {
  /**
   * Send an outbound email.
   * @param {Object} options
   * @param {string} options.to Recipient email address
   * @param {string} options.subject Email subject
   * @param {string} options.text Plain text content
   * @param {string} [options.html] Optional HTML content
   * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
   */
  async sendEmail(options) {
    throw new Error('sendEmail must be implemented by concrete adapter');
  }
}

/**
 * Mock Email Adapter for Testing and Offline Development.
 * Stores dispatched emails in memory without making external network calls.
 */
class MockEmailAdapter extends BaseEmailAdapter {
  constructor() {
    super();
    this.sentEmails = [];
    this.shouldFail = false;
    this.failureError = null;
  }

  async sendEmail({ to, subject, text, html }) {
    if (!to || typeof to !== 'string' || !to.includes('@')) {
      return { success: false, error: 'Invalid recipient email address' };
    }

    if (this.shouldFail) {
      const errMsg = this.failureError || 'Simulated SMTP connection timeout';
      return { success: false, error: errMsg };
    }

    const messageId = `mock-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const emailRecord = {
      messageId,
      to,
      subject,
      text,
      html: html || null,
      sentAt: new Date()
    };

    this.sentEmails.push(emailRecord);
    return { success: true, messageId };
  }

  getSentEmails() {
    return [...this.sentEmails];
  }

  clearSentEmails() {
    this.sentEmails = [];
  }

  simulateFailure(shouldFail = true, errorMessage = 'Simulated SMTP failure') {
    this.shouldFail = Boolean(shouldFail);
    this.failureError = errorMessage;
  }
}

/**
 * Production SMTP Adapter Interface.
 * Configured via environment variables without logging secrets or credentials.
 */
class SmtpEmailAdapter extends BaseEmailAdapter {
  constructor(config = {}) {
    super();
    this.host = config.host || process.env.SMTP_HOST || '';
    this.port = parseInt(config.port || process.env.SMTP_PORT || '587', 10);
    this.user = config.user || process.env.SMTP_USER || '';
    this.pass = config.pass || process.env.SMTP_PASS || '';
    this.secure = config.secure !== undefined ? config.secure : process.env.SMTP_SECURE === 'true';
    this.from = config.from || process.env.EMAIL_FROM || 'noreply@housing.local';
  }

  async sendEmail({ to, subject, text, html }) {
    if (!this.host) {
      return {
        success: false,
        error: 'SMTP host is not configured'
      };
    }

    if (!to || typeof to !== 'string' || !to.includes('@')) {
      return {
        success: false,
        error: 'Invalid recipient email address'
      };
    }

    // Explicit safeguard: SmtpEmailAdapter is currently an architectural stub.
    // Real network SMTP transport is not yet connected in this phase.
    // Fails safely with a clear, non-secret error rather than falsely claiming delivery.
    return {
      success: false,
      error: 'SMTP transport not active: real email delivery is not yet configured'
    };
  }
}

let activeAdapter = null;

function getEmailAdapter() {
  if (activeAdapter) {
    return activeAdapter;
  }

  const provider = (process.env.EMAIL_PROVIDER || 'mock').toLowerCase().trim();
  if (provider === 'smtp') {
    activeAdapter = new SmtpEmailAdapter();
  } else {
    activeAdapter = new MockEmailAdapter();
  }

  return activeAdapter;
}

function setEmailAdapter(adapter) {
  activeAdapter = adapter;
}

function resetEmailAdapter() {
  activeAdapter = null;
}

module.exports = {
  BaseEmailAdapter,
  MockEmailAdapter,
  SmtpEmailAdapter,
  getEmailAdapter,
  setEmailAdapter,
  resetEmailAdapter
};
