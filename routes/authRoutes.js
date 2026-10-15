const express = require('express');
const rateLimit = require('express-rate-limit');
const { register, login, logout, getMe } = require('../controllers/authController');
const { authenticate, optionalAuthenticate } = require('../middleware/auth');

const router = express.Router();

// Targeted rate limiter for authentication endpoints to prevent brute-force attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 100 : 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many authentication attempts. Please try again after 15 minutes.'
  }
});

// Public authentication routes
router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/logout', optionalAuthenticate, logout);

// Protected session/profile route
router.get('/me', authenticate, getMe);

module.exports = router;
