/**
 * Soya Ventures - JWT Authentication Middleware
 */

const jwt = require('jsonwebtoken');
const config = require('../config/env');
const userRepository = require('../repositories/userRepository');
const { AppError } = require('./errorHandler');
const { logger } = require('../config/logger');

async function authenticateToken(req, res, next) {
  const reqLog = req.log || logger;
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reqLog.warn('Authentication rejected: Bearer token missing', {
      path: req.originalUrl,
      ip: req.ip,
    });
    return next(new AppError('Authentication token required. Use format: Bearer <token>', 401, 'UNAUTHORIZED'));
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, config.jwt.secret);

    // Verify user still exists and remains active
    const user = await userRepository.findById(decoded.userId);
    if (!user) {
      reqLog.warn('Authentication rejected: User no longer exists', {
        userId: decoded.userId,
      });
      return next(new AppError('The user associated with this token no longer exists.', 401, 'USER_NOT_FOUND'));
    }

    if (!user.is_active) {
      reqLog.warn('Authentication rejected: Account deactivated', {
        userId: user.id,
        email: user.email,
      });
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
