/**
 * Soya Ventures - Centralized Error Handling Middleware
 * 
 * Safely sanitizes errors for client responses (no leaked stack traces, SQL,
 * or credentials) while recording structured, contextual server logs with correlation IDs.
 */

const { logger } = require('../config/logger');

class AppError extends Error {
  constructor(message, statusCode = 400, code = 'BAD_REQUEST') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

function notFoundHandler(req, res) {
  const reqLog = req.log || logger;
  reqLog.warn(`Resource not found: ${req.method} ${req.originalUrl}`);

  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Endpoint ${req.method} ${req.originalUrl} not found`,
    },
  });
}

function errorHandler(err, req, res, next) {
  const reqLog = req.log || logger;
  const isKnownAuthError = err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError';

  // 1. Log unhandled or unexpected server errors
  if (!err.isOperational && !isKnownAuthError) {
    reqLog.error('Unhandled internal server error', {
      message: err.message,
      code: err.code,
      path: req.originalUrl,
      method: req.method,
      stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
    });
  }

  // 2. Handled Operational App Errors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
      },
    });
  }

  // 3. Request Body Size Limit Exceeded (413)
  if (err.type === 'entity.too.large' || err.status === 413) {
    reqLog.warn('Request body payload too large', { path: req.originalUrl, limit: '100kb' });
    return res.status(413).json({
      success: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request payload exceeds maximum allowed size (100kb).',
      },
    });
  }

  // 4. PostgreSQL Unique Constraint Violations (23505)
  if (err.code === '23505') {
    let message = 'A record with this information already exists.';
    if (err.constraint === 'users_email_key') {
      message = 'An account with this email address already exists.';
    } else if (err.constraint === 'users_phone_number_key') {
      message = 'An account with this phone number already exists.';
    }

    reqLog.warn('Duplicate resource conflict', { constraint: err.constraint });
    return res.status(409).json({
      success: false,
      error: {
        code: 'DUPLICATE_RESOURCE',
        message,
      },
    });
  }

  // 5. PostgreSQL Foreign Key Violations (23503)
  if (err.code === '23503') {
    reqLog.warn('Foreign key reference violation', { constraint: err.constraint });
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_REFERENCE',
        message: 'Referenced entity does not exist.',
      },
    });
  }

  // 6. JWT Authentication Errors
  if (err.name === 'JsonWebTokenError') {
    reqLog.warn('Invalid JWT authentication token presented');
    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid authentication token.',
      },
    });
  }

  if (err.name === 'TokenExpiredError') {
    reqLog.warn('Expired JWT authentication token presented');
    return res.status(401).json({
      success: false,
      error: {
        code: 'TOKEN_EXPIRED',
        message: 'Authentication token has expired. Please log in again.',
      },
    });
  }

  // 7. JSON Syntax Parse Errors from express.json()
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    reqLog.warn('Malformed JSON body received');
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_JSON',
        message: 'Malformed JSON payload in request body.',
      },
    });
  }

  // 8. Generic Safe Production Response
  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected internal error occurred. Please try again later.',
    },
  });
}

module.exports = {
  AppError,
  notFoundHandler,
  errorHandler,
};
