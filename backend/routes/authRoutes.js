/**
 * Soya Ventures - Authentication Routes
 * Mounted at /api/auth
 */

const express = require('express');
const { register, login, getProfile } = require('../controllers/authController');
const { validateRegister, validateLogin } = require('../validation/authValidation');
const { authenticateToken } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimiter');
const config = require('../config/env');

const router = express.Router();

// Rate limiter for authentication endpoints (login & registration)
const authLimiter = createRateLimiter({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: 'Too many authentication attempts. Please try again later.',
});

// Expose rate limiter on router for tests to reset if needed
router.authLimiter = authLimiter;

// Public registration (STRICTLY restricted to agent role in service)
router.post('/register', authLimiter, validateRegister, register);

// Public login
router.post('/login', authLimiter, validateLogin, login);

// Authenticated current user profile
router.get('/me', authenticateToken, getProfile);

module.exports = router;

