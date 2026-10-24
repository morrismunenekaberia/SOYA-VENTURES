/**
 * Soya Ventures - Centralized Environment Configuration
 * 
 * Validates required configuration keys at startup and fails fast
 * with descriptive messages if any critical configuration is missing.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const requiredKeys = [
  'DB_USER',
  'DB_PASSWORD',
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'JWT_SECRET',
];

const missing = requiredKeys.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error('\n❌ FATAL CONFIGURATION ERROR:');
  console.error(`Missing required environment variable(s): ${missing.join(', ')}`);
  console.error('Please configure these in backend/.env (refer to backend/.env.example).\n');
  process.exit(1);
}

module.exports = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  db: {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME,
    max: Number(process.env.DB_POOL_MAX) || 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },
  rateLimit: {
    windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20,
  },
  mpesa: {
    environment: process.env.MPESA_ENVIRONMENT || 'sandbox',
    consumerKey: process.env.MPESA_CONSUMER_KEY || '',
    consumerSecret: process.env.MPESA_CONSUMER_SECRET || '',
    initiatorName: process.env.MPESA_INITIATOR_NAME || 'testapi',
    securityCredential: process.env.MPESA_SECURITY_CREDENTIAL || '',
    shortcode: process.env.MPESA_B2C_SHORTCODE || '600988',
    commandId: process.env.MPESA_B2C_COMMAND_ID || 'BusinessPayment',
    resultUrl: process.env.MPESA_RESULT_URL || 'https://sandbox.soya.co.ke/api/payouts/b2c/result',
    timeoutUrl: process.env.MPESA_TIMEOUT_URL || 'https://sandbox.soya.co.ke/api/payouts/b2c/timeout',
    callbackSecret: process.env.MPESA_CALLBACK_SECRET || 'soya_sandbox_callback_secret_token_2026',
    baseUrl: (process.env.MPESA_ENVIRONMENT === 'production')
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke',
  },
};

