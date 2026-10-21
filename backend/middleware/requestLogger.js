/**
 * Soya Ventures - Request Logger Middleware
 * 
 * Intercepts requests and responses, recording execution time and status.
 */

function requestLogger(req, res, next) {
  // Suppress verbose logging during automated test runs
  if (process.env.NODE_ENV === 'test') {
    return next();
  }

  const start = Date.now();
  const { method, originalUrl } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const { statusCode } = res;
    const logColor = statusCode >= 500 ? '\x1b[31m' : statusCode >= 400 ? '\x1b[33m' : '\x1b[32m';
    const resetColor = '\x1b[0m';

    console.log(
      `[${new Date().toISOString()}] ${method} ${originalUrl} ${logColor}${statusCode}${resetColor} - ${duration}ms`
    );
  });

  next();
}

module.exports = {
  requestLogger,
};

