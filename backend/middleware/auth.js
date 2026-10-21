/**
 * Soya Ventures - JWT Authentication Middleware
 */

const jwt = require('jsonwebtoken');
const config = require('../config/env');
const userRepository = require('../repositories/userRepository');
const { AppError } = require('./errorHandler');

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('Authentication token required. Use format: Bearer <token>', 401, 'UNAUTHORIZED'));
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, config.jwt.secret);

    // Verify user still exists and remains active
    const user = await userRepository.findById(decoded.userId);
    if (!user) {
      return next(new AppError('The user associated with this token no longer exists.', 401, 'USER_NOT_FOUND'));
    }

    if (!user.is_active) {
      return next(new AppError('Your account has been deactivated.', 403, 'ACCOUNT_DEACTIVATED'));
    }

    // Attach user profile to request
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  authenticateToken,
};

