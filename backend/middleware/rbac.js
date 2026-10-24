/**
 * Soya Ventures - Role-Based Access Control (RBAC) Middleware
 */

const { AppError } = require('./errorHandler');
const { logger } = require('../config/logger');

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const reqLog = req.log || logger;

    if (!req.user) {
      reqLog.warn('Authorization rejected: No authenticated session found', {
        path: req.originalUrl,
      });
      return next(new AppError('Authentication required prior to permission verification.', 401, 'UNAUTHORIZED'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      reqLog.warn('Authorization denied: Insufficient role permissions', {
        userId: req.user.id,
        userRole: req.user.role,
        allowedRoles,
        path: req.originalUrl,
        method: req.method,
      });
      return next(new AppError(
        `Access denied. Requires one of the following roles: [${allowedRoles.join(', ')}].`,
        403,
        'FORBIDDEN'
      ));
    }

    next();
  };
}

module.exports = {
  requireRole,
};
