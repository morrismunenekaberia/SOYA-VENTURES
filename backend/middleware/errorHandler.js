/**
 * Soya Ventures - Centralized Error Handling Middleware
 */

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
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Endpoint ${req.method} ${req.originalUrl} not found`,
    },
  });
}

function errorHandler(err, req, res, next) {
  const isKnownAuthError = err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError';

  // Always log unexpected errors internally on the server console
  if (!err.isOperational && !isKnownAuthError && process.env.NODE_ENV !== 'test') {
    console.error('Unhandled Server Error:', {
      message: err.message,
      stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
      path: req.originalUrl,
      method: req.method,
    });
  }

  // 1. Handled Operational App Errors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
      },
    });
  }

  // 2. PostgreSQL Unique Constraint Violations (23505)
  if (err.code === '23505') {
    let message = 'A record with this information already exists.';
    if (err.constraint === 'users_email_key') {
      message = 'An account with this email address already exists.';
    } else if (err.constraint === 'users_phone_number_key') {
      message = 'An account with this phone number already exists.';
    }

    return res.status(409).json({
      success: false,
      error: {
        code: 'DUPLICATE_RESOURCE',
        message,
      },
    });
  }

  // 3. PostgreSQL Foreign Key Violations (23503)
  if (err.code === '23503') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_REFERENCE',
        message: 'Referenced entity does not exist.',
      },
    });
  }

  // 4. JWT Authentication Errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid authentication token.',
      },
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: {
        code: 'TOKEN_EXPIRED',
        message: 'Authentication token has expired. Please log in again.',
      },
    });
  }

  // 5. JSON Syntax Parse Errors from express.json()
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_JSON',
        message: 'Malformed JSON payload in request body.',
      },
    });
  }

  // 6. Generic Safe Production Response
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
