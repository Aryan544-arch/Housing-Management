const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const SocietyMembership = require('../models/SocietyMembership');

const COOKIE_NAME = 'token';

/**
 * Validate and retrieve JWT secret.
 * In production, strictly requires a secret with at least 32 characters.
 */
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  const isProd = process.env.NODE_ENV === 'production';

  if (!secret && isProd) {
    throw new Error('FATAL: JWT_SECRET must be set in production environment');
  }
  if (secret && isProd && secret.length < 32) {
    throw new Error('FATAL: JWT_SECRET must be at least 32 characters long in production');
  }
  return secret || 'dev_jwt_secret_change_in_production';
}

/**
 * Generate secure cookie options based on environment.
 */
function getCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'strict' : 'lax',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  };
}

/**
 * Sign a JWT for an authenticated user with explicit HS256 algorithm.
 */
function signToken(user) {
  return jwt.sign(
    {
      userId: user._id.toString(),
      tokenVersion: user.tokenVersion || 0
    },
    getJwtSecret(),
    {
      algorithm: 'HS256',
      expiresIn: '1d'
    }
  );
}

/**
 * Attach the JWT as an HttpOnly secure cookie.
 */
function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, getCookieOptions());
}

/**
 * Clear the authentication cookie upon logout with identical path and security flags.
 */
function clearAuthCookie(res) {
  const isProd = process.env.NODE_ENV === 'production';
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'strict' : 'lax',
    path: '/'
  });
}

/**
 * Authenticate incoming requests via HttpOnly cookie (or Authorization header fallback).
 */
async function authenticate(req, res, next) {
  try {
    let token = null;

    if (req.cookies && req.cookies[COOKIE_NAME]) {
      token = req.cookies[COOKIE_NAME];
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please log in.'
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired authentication token.'
      });
    }

    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'User account not found or deactivated.'
      });
    }

    // Verify token version has not been invalidated
    if (decoded.tokenVersion !== undefined && decoded.tokenVersion !== user.tokenVersion) {
      return res.status(401).json({
        success: false,
        message: 'Session invalidated. Please log in again.'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Optional authentication middleware.
 * Attaches req.user if a valid token is present, but does not block if missing or invalid.
 */
async function optionalAuthenticate(req, res, next) {
  try {
    let token = null;

    if (req.cookies && req.cookies[COOKIE_NAME]) {
      token = req.cookies[COOKIE_NAME];
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (token) {
      try {
        const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
        const user = await User.findById(decoded.userId);
        if (user && user.isActive && (decoded.tokenVersion === undefined || decoded.tokenVersion === user.tokenVersion)) {
          req.user = user;
        }
      } catch (err) {
        // Token verification failed; proceed unauthenticated
      }
    }

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Society-scoped authorization middleware.
 * Verifies that the authenticated user is an active member of the target society,
 * and optionally validates role permissions ('resident', 'admin').
 *
 * @param {string[]} [allowedRoles] - Optional list of allowed roles. If empty, any active member is allowed.
 */
function requireSocietyMember(allowedRoles = []) {
  return async (req, res, next) => {
    try {
      const societyId = req.params.societyId || req.headers['x-society-id'] || req.body.societyId;

      if (!societyId) {
        return res.status(400).json({
          success: false,
          message: 'Society identifier is required.'
        });
      }

      if (!mongoose.Types.ObjectId.isValid(societyId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid society identifier format.'
        });
      }

      // Query database directly - never trust client-supplied roles
      const membership = await SocietyMembership.findOne({
        user: req.user._id,
        society: societyId,
        status: 'active'
      }).populate('society');

      if (!membership || !membership.society) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You are not an active member of this society.'
        });
      }

      if (allowedRoles.length > 0 && !allowedRoles.includes(membership.role)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: Insufficient role permissions in this society.'
        });
      }

      // Attach verified membership and society to request object
      req.membership = membership;
      req.society = membership.society;
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  COOKIE_NAME,
  getJwtSecret,
  getCookieOptions,
  signToken,
  setAuthCookie,
  clearAuthCookie,
  authenticate,
  optionalAuthenticate,
  requireSocietyMember
};
