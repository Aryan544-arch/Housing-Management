const crypto = require('node:crypto');

const CSRF_COOKIE_NAME = '_csrf';

/**
 * Server-side secret for HMAC-signing CSRF tokens.
 * Derived from JWT_SECRET or fallback development secret.
 */
function getCsrfSecret() {
  return process.env.CSRF_SECRET || process.env.JWT_SECRET || 'dev_csrf_secret_min_32_characters_long!';
}

/**
 * Generate a signed CSRF token: rawToken.hmacSignature
 * @param {string} [userId] - Optional user ID for session binding
 * @returns {{ rawToken: string, signedValue: string }}
 */
function generateSignedToken(userId = '') {
  const rawToken = crypto.randomBytes(16).toString('hex');
  const payload = userId ? `${userId}:${rawToken}` : rawToken;
  const signature = crypto
    .createHmac('sha256', getCsrfSecret())
    .update(payload)
    .digest('hex');

  return {
    rawToken,
    signedValue: `${rawToken}.${signature}`
  };
}

/**
 * Verify if the signed cookie value has a valid HMAC signature.
 * @param {string} signedValue - The value from cookie (rawToken.signature)
 * @param {string} [userId] - Optional user ID for session binding
 * @returns {string|null} - The validated rawToken, or null if invalid/tampered
 */
function verifySignedToken(signedValue, userId = '') {
  if (!signedValue || typeof signedValue !== 'string') return null;

  const parts = signedValue.split('.');
  if (parts.length !== 2) return null;

  const [rawToken, signature] = parts;
  if (!rawToken || !signature) return null;

  const payload = userId ? `${userId}:${rawToken}` : rawToken;
  const expectedSignature = crypto
    .createHmac('sha256', getCsrfSecret())
    .update(payload)
    .digest('hex');

  const sigBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  if (sigBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) return null;

  return rawToken;
}

/**
 * Constant-time string equality comparison.
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Issue or refresh the signed CSRF cookie on response.
 */
function setCsrfCookie(res, userId = '') {
  const { rawToken, signedValue } = generateSignedToken(userId);
  res.cookie(CSRF_COOKIE_NAME, signedValue, {
    httpOnly: false, // Must be readable by client scripts to echo in request header/body
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    path: '/'
  });
  res.locals.csrfToken = rawToken;
  return { rawToken, signedValue };
}

/**
 * Robust, dependency-free CSRF protection middleware:
 * 1. Origin and Referer validation against Host header on all state-changing requests.
 * 2. HMAC-signed double-submit cookie verification on authenticated sessions.
 * 3. Works seamlessly with both JSON requests (X-CSRF-Token) and browser HTML forms (_csrf body field).
 */
function csrfProtection(req, res, next) {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];

  // 1. Safe HTTP methods: Issue / refresh client-readable signed CSRF token
  if (safeMethods.includes(req.method)) {
    const existingSigned = req.cookies && req.cookies[CSRF_COOKIE_NAME];
    const validRawToken = verifySignedToken(existingSigned);

    if (!validRawToken) {
      setCsrfCookie(res);
    } else {
      res.locals.csrfToken = validRawToken;
    }
    return next();
  }

  // 2. Origin / Referer validation on state-changing methods (POST, PUT, DELETE, PATCH)
  const host = req.headers.host;
  const origin = req.headers.origin;
  const referer = req.headers.referer;

  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return res.status(403).json({
          success: false,
          message: 'CSRF protection: Cross-origin request rejected.'
        });
      }
    } catch {
      return res.status(403).json({
        success: false,
        message: 'CSRF protection: Malformed Origin header.'
      });
    }
  } else if (referer) {
    try {
      const refererHost = new URL(referer).host;
      if (refererHost !== host) {
        return res.status(403).json({
          success: false,
          message: 'CSRF protection: Cross-origin referer rejected.'
        });
      }
    } catch {
      return res.status(403).json({
        success: false,
        message: 'CSRF protection: Malformed Referer header.'
      });
    }
  }

  // 3. Authenticated session verification:
  // If the request carries an authentication cookie (token), CSRF verification is MANDATORY.
  // Public auth entrypoints (/api/auth/login, /api/auth/register) are exempt because session does not exist yet.
  const isAuthEntrypoint = req.path === '/api/auth/login' || req.path === '/api/auth/register';

  if (isAuthEntrypoint) {
    // Ensure CSRF cookie is initialized for the newly authenticating client
    const existingSigned = req.cookies && req.cookies[CSRF_COOKIE_NAME];
    if (!verifySignedToken(existingSigned)) {
      setCsrfCookie(res);
    }
    return next();
  }
  const hasAuthCookie = Boolean(req.cookies && req.cookies.token);

  if (!isAuthEntrypoint && hasAuthCookie) {
    const clientToken = req.headers['x-csrf-token'] || req.body?._csrf;
    const cookieSigned = req.cookies && req.cookies[CSRF_COOKIE_NAME];

    // If either token or signed cookie is missing, immediately reject
    if (!clientToken || !cookieSigned) {
      return res.status(403).json({
        success: false,
        message: 'CSRF protection: Missing CSRF token or cookie.'
      });
    }

    // Verify cryptographic HMAC signature of the cookie token (prevents cookie tossing / forgery)
    const validRawToken = verifySignedToken(cookieSigned);
    if (!validRawToken) {
      return res.status(403).json({
        success: false,
        message: 'CSRF protection: Invalid or tampered CSRF cookie.'
      });
    }

    // Timing-safe comparison of client token against validated raw cookie token
    if (!safeEqual(clientToken, validRawToken)) {
      return res.status(403).json({
        success: false,
        message: 'CSRF protection: CSRF token mismatch.'
      });
    }
  }

  next();
}

module.exports = {
  csrfProtection,
  CSRF_COOKIE_NAME,
  generateSignedToken,
  verifySignedToken
};
