/**
 * Gemma AI Advisory Adapter
 *
 * Provides a replaceable, isolated interface for Gemma and compatible model endpoints.
 * Handles timeouts, network failures, protocol validation, and parsing without modifying business logic.
 */

class GemmaAdapter {
  constructor(config = {}) {
    this.apiUrl = config.apiUrl || process.env.GEMMA_API_URL || '';
    this.apiKey = config.apiKey || process.env.GEMMA_API_KEY || '';
    this.model = config.model || process.env.GEMMA_MODEL || 'gemma-2-9b-it';
    const parsedTimeout = parseInt(config.timeoutMs || process.env.AI_TIMEOUT_MS, 10);
    this.timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout >= 500 && parsedTimeout <= 60000
      ? parsedTimeout
      : 10000;
  }

  /**
   * Check whether the adapter has the minimum required configuration.
   *
   * @returns {boolean}
   */
  isConfigured() {
    return Boolean(this.apiUrl && this.apiUrl.trim());
  }

  /**
   * Validate endpoint URL and enforce HTTPS in production.
   * Allows HTTP only for local loopback development endpoints.
   *
   * @returns {URL} Validated URL instance
   */
  validateEndpointUrl() {
    if (!this.isConfigured()) {
      const err = new Error('Gemma API endpoint is not configured.');
      err.code = 'CONFIG_MISSING';
      err.statusCode = 503;
      throw err;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(this.apiUrl.trim());
    } catch {
      const err = new Error('Invalid AI model endpoint URL format.');
      err.code = 'INVALID_ENDPOINT_URL';
      err.statusCode = 503;
      throw err;
    }

    const isProd = process.env.NODE_ENV === 'production';
    const isLocalhost =
      parsedUrl.hostname === 'localhost' ||
      parsedUrl.hostname === '127.0.0.1' ||
      parsedUrl.hostname === '::1';

    if (parsedUrl.protocol === 'http:') {
      if (isProd) {
        const err = new Error('Insecure HTTP endpoints are not permitted in production. HTTPS is required.');
        err.code = 'INSECURE_ENDPOINT_PROTOCOL';
        err.statusCode = 503;
        throw err;
      }
      if (!isLocalhost && process.env.ALLOW_INSECURE_REMOTE_AI !== 'true') {
        const err = new Error('Remote AI model endpoints must use HTTPS.');
        err.code = 'INSECURE_ENDPOINT_PROTOCOL';
        err.statusCode = 503;
        throw err;
      }
    } else if (parsedUrl.protocol !== 'https:') {
      const err = new Error(`Unsupported AI model endpoint protocol: ${parsedUrl.protocol}. HTTPS is required.`);
      err.code = 'UNSUPPORTED_ENDPOINT_PROTOCOL';
      err.statusCode = 503;
      throw err;
    }

    return parsedUrl;
  }

  /**
   * Request structured analysis from the configured Gemma endpoint.
   *
   * @param {object} promptPayload
   * @param {string} promptPayload.systemPrompt
   * @param {string} promptPayload.userPrompt
   * @returns {Promise<string>} Raw text output from model
   */
  async generateAnalysis(promptPayload) {
    const validatedUrl = this.validateEndpointUrl();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers = {
        'Content-Type': 'application/json'
      };
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const body = JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: promptPayload.systemPrompt },
          { role: 'user', content: promptPayload.userPrompt }
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      });

      // redirect: 'error' prevents SSRF bypass via 301/302 redirects to internal/cloud metadata addresses
      const response = await fetch(validatedUrl.toString(), {
        method: 'POST',
        headers,
        body,
        redirect: 'error',
        signal: controller.signal
      });

      if (!response.ok) {
        const err = new Error(`AI model provider responded with HTTP status ${response.status}`);
        err.statusCode = response.status >= 500 ? 502 : 503;
        throw err;
      }

      // Bounded response size check (max 500KB)
      const MAX_RESPONSE_BYTES = 500 * 1024;
      const contentLength = parseInt(response.headers.get('content-length'), 10);
      if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
        const err = new Error('AI model provider response exceeded maximum allowable size.');
        err.statusCode = 502;
        throw err;
      }

      const rawResponseText = await response.text();
      if (rawResponseText.length > MAX_RESPONSE_BYTES) {
        const err = new Error('AI model provider response exceeded maximum allowable size.');
        err.statusCode = 502;
        throw err;
      }

      let data;
      try {
        data = JSON.parse(rawResponseText);
      } catch {
        // If upstream didn't return valid JSON, return raw text for downstream validation
        return rawResponseText;
      }

      // Extract text content from OpenAI/Gemma/HuggingFace style responses
      let rawText = '';
      if (data.choices && data.choices[0] && data.choices[0].message) {
        rawText = data.choices[0].message.content;
      } else if (data.response) {
        rawText = data.response;
      } else if (data.generated_text) {
        rawText = data.generated_text;
      } else if (typeof data === 'string') {
        rawText = data;
      } else {
        rawText = JSON.stringify(data);
      }

      return rawText;
    } catch (err) {
      if (err.name === 'AbortError' || err.code === 'ABORT_ERR') {
        const timeoutErr = new Error('AI advisory request timed out.');
        timeoutErr.statusCode = 504;
        timeoutErr.code = 'TIMEOUT';
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = GemmaAdapter;
