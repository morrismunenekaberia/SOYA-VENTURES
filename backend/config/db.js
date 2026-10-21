/**
 * Soya Ventures - Database Connection Pool & Readiness Check
 */

const { Pool } = require('pg');
const config = require('./env');

const pool = new Pool(config.db);

// Log any unexpected background errors on idle clients
pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err.message);
});

/**
 * Executes a lightweight connectivity check.
 * Returns latency in milliseconds if successful.
 */
async function checkDatabaseConnection() {
  const start = Date.now();
  await pool.query('SELECT 1 AS readiness_check');
  const latencyMs = Date.now() - start;
  return { ok: true, latencyMs };
}

module.exports = {
  pool,
  checkDatabaseConnection,
};

