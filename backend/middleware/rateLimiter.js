/**
 * Soya Ventures - Rate Limiting Middleware
 * 
 * In-memory sliding window rate limiter designed for learning and maintainability.
 * Protects sensitive endpoints (login, registration) from brute force attacks.
 */

function createRateLimiter({
  windowMs = 15 * 60 * 1000,
  max = 20,
  message = 'Too many requests from this IP address, please try again later.',
} = {}) {
  const clients = new Map();

  const limiter = (req, res, next) => {
    // Support testing bypass or IP extraction
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const now = Date.now();
    const windowStart = now - windowMs;

    // Retrieve timestamps and discard entries older than the window
    const timestamps = (clients.get(ip) || []).filter((t) => t > windowStart);

    if (timestamps.length >= max) {
      return res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message,
        },
      });
    }

    timestamps.push(now);
    clients.set(ip, timestamps);
    next();
  };

  // Helper method for unit/integration tests to clear state
  limiter.reset = () => clients.clear();

  return limiter;
}

module.exports = {
  createRateLimiter,
};

