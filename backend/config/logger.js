/**
 * Soya Ventures - Centralized Structured Logger
 * 
 * Provides structured, timestamped logging with log level filtering,
 * correlation ID propagation, ANSI color formatting in development,
 * machine-readable JSON in production, and automatic redaction of secrets,
 * tokens, passwords, and sensitive phone numbers.
 */

const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 99,
};

const LEVEL_COLORS = {
  debug: '\x1b[36m', // Cyan
  info: '\x1b[32m',  // Green
  warn: '\x1b[33m',  // Yellow
  error: '\x1b[31m', // Red
  reset: '\x1b[0m',
  dim: '\x1b[2m',
};

// Patterns for detecting sensitive property names
const SENSITIVE_KEY_REGEX = /password|hash|token|secret|authorization|credential|pin|cvv|api_key|consumer_key/i;

/**
 * Redacts middle digits of a phone number for customer privacy.
 * E.g., '254712345678' -> '254712***678'
 */
function maskPhone(phone) {
  if (typeof phone !== 'string' && typeof phone !== 'number') return phone;
  const str = String(phone).trim();
  if (str.length < 8) return '***';

  // Format: keep first 6 chars, mask middle, keep last 3 chars
  const prefixLen = Math.min(6, Math.floor(str.length / 2));
  const suffixLen = Math.min(3, Math.floor(str.length / 3));
  const prefix = str.slice(0, prefixLen);
  const suffix = str.slice(-suffixLen);
  return `${prefix}***${suffix}`;
}

/**
 * Deep redaction of sensitive objects and strings.
 */
function redact(data, seen = new WeakSet()) {
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    // Redact bearer tokens inside strings
    let cleaned = data.replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, 'Bearer [REDACTED]');
    // Redact 10 to 12 digit phone numbers within text
    cleaned = cleaned.replace(/(?:254|\+254|0)(7\d{2})(\d{3})(\d{3})/g, '254$1***$3');
    return cleaned;
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return data;
  }

  if (typeof data === 'function') {
    return '[Function]';
  }

  if (data instanceof Error) {
    return {
      message: data.message,
      code: data.code,
      stack: process.env.NODE_ENV === 'production' ? undefined : data.stack,
    };
  }

  if (Array.isArray(data)) {
    return data.map((item) => redact(item, seen));
  }

  if (typeof data === 'object') {
    // Guard against circular references
    if (seen.has(data)) return '[Circular Reference]';
    seen.add(data);

    const scrubbed = {};
    for (const [key, val] of Object.entries(data)) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        scrubbed[key] = '[REDACTED]';
      } else if (/phone|msisdn/i.test(key)) {
        scrubbed[key] = maskPhone(val);
      } else {
        scrubbed[key] = redact(val, seen);
      }
    }
    return scrubbed;
  }

  return data;
}

class Logger {
  constructor(options = {}) {
    this.defaultMeta = options.defaultMeta || {};
    this.level = options.level || this._resolveDefaultLevel();
    this.format = options.format || (process.env.LOG_FORMAT || (process.env.NODE_ENV === 'production' ? 'json' : 'pretty'));
  }

  _resolveDefaultLevel() {
    if (process.env.LOG_LEVEL && LEVELS[process.env.LOG_LEVEL.toLowerCase()]) {
      return process.env.LOG_LEVEL.toLowerCase();
    }
    if (process.env.NODE_ENV === 'test') {
      return 'warn'; // Keep test runs clean, suppress debug/info unless explicitly set
    }
    if (process.env.NODE_ENV === 'production') {
      return 'info';
    }
    return 'debug';
  }

  setLevel(level) {
    if (LEVELS[level]) {
      this.level = level;
    }
  }

  getLevel() {
    return this.level;
  }

  child(meta = {}) {
    return new Logger({
      defaultMeta: { ...this.defaultMeta, ...meta },
      level: this.level,
      format: this.format,
    });
  }

  _shouldLog(targetLevel) {
    const currentScore = LEVELS[this.level] || LEVELS.info;
    const targetScore = LEVELS[targetLevel] || LEVELS.info;
    return targetScore >= currentScore;
  }

  _write(level, message, meta = {}) {
    if (!this._shouldLog(level)) return;

    const timestamp = new Date().toISOString();
    const correlationId = meta.correlationId || this.defaultMeta.correlationId || null;

    // Combine metadata and scrub sensitive fields
    const scrubbedMeta = redact({
      ...this.defaultMeta,
      ...meta,
    });
    delete scrubbedMeta.correlationId; // Kept at top level

    if (this.format === 'json') {
      const logObject = {
        timestamp,
        level: level.toUpperCase(),
        message: typeof message === 'string' ? redact(message) : redact(message),
      };

      if (correlationId) logObject.correlationId = correlationId;
      if (Object.keys(scrubbedMeta).length > 0) logObject.meta = scrubbedMeta;

      const output = JSON.stringify(logObject) + '\n';
      if (level === 'error' || level === 'warn') {
        process.stderr.write(output);
      } else {
        process.stdout.write(output);
      }
    } else {
      // Pretty ANSI format for development
      const color = LEVEL_COLORS[level] || LEVEL_COLORS.info;
      const levelTag = `${color}${level.toUpperCase().padEnd(5)}${LEVEL_COLORS.reset}`;
      const timeTag = `${LEVEL_COLORS.dim}[${timestamp}]${LEVEL_COLORS.reset}`;
      const corrTag = correlationId ? `${LEVEL_COLORS.dim}[${correlationId}]${LEVEL_COLORS.reset} ` : '';
      const metaStr = Object.keys(scrubbedMeta).length > 0 ? ` ${JSON.stringify(scrubbedMeta)}` : '';

      const line = `${timeTag} ${levelTag} ${corrTag}${message}${metaStr}\n`;
      if (level === 'error' || level === 'warn') {
        process.stderr.write(line);
      } else {
        process.stdout.write(line);
      }
    }
  }

  debug(message, meta) {
    this._write('debug', message, meta);
  }

  info(message, meta) {
    this._write('info', message, meta);
  }

  warn(message, meta) {
    this._write('warn', message, meta);
  }

  error(message, meta) {
    this._write('error', message, meta);
  }
}

const logger = new Logger();

module.exports = {
  logger,
  Logger,
  maskPhone,
  redact,
  LEVELS,
};

