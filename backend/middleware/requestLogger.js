/**
 * Soya Ventures - Request Logger Middleware
 * 
 * Assigns or propagates X-Request-Id correlation tokens, tracks request duration,
 * and records structured, timestamped logs for all incoming HTTP traffic.
 */

const crypto = require('crypto');
const { logger } = require('../config/logger');

function requestLogger(req, res, next) {
  // 1. Assign or propagate correlation ID
  const incomingId = req.headers['x-request-id'] || req.headers['x-correlation-id'];
  req.id = incomingId && typeof incomingId === 'string' && incomingId.length <= 64
    ? incomingId
    : crypto.randomUUID();

  // Propagate correlation token in response headers
  res.setHeader('X-Request-Id', req.id);

  // Attach a context-bound child logger to the request
  req.log = logger.child({ correlationId: req.id });

  const start = process.hrtime.bigint();
  const { method, originalUrl, ip } = req;

  // Log incoming request at debug level
  req.log.debug(`Incoming ${method} ${originalUrl}`, {
    ip: ip || req.socket.remoteAddress,
  });

  // Track response completion
  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const durationMs = Number((end - start) / 1000000n);
    const { statusCode } = res;

    const logMeta = {
      method,
      url: originalUrl,
      statusCode,
      durationMs,
      ip: ip || req.socket.remoteAddress,
    };

    if (statusCode >= 500) {
      req.log.error(`${method} ${originalUrl} ${statusCode} - ${durationMs}ms`, logMeta);
    } else if (statusCode >= 400) {
      req.log.warn(`${method} ${originalUrl} ${statusCode} - ${durationMs}ms`, logMeta);
    } else {
      req.log.info(`${method} ${originalUrl} ${statusCode} - ${durationMs}ms`, logMeta);
    }
  });

  next();
}

module.exports = {
  requestLogger,
};
