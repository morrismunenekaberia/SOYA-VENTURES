/**
 * Soya Ventures - Role-Based Access Control (RBAC) Middleware
 */

const { AppError } = require('./errorHandler');

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required prior to permission verification.', 401, 'UNAUTHORIZED'));
    }

    if (!allowedRoles.includes(req.user.role)) {
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

