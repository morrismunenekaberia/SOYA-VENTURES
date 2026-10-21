/**
 * Legacy db.js export for backward compatibility.
 * Re-exports the central database pool from config/db.
 */
const { pool } = require('./config/db');

module.exports = pool;
