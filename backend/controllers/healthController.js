/**
 * Soya Ventures - Health & Readiness Controller
 */

const { checkDatabaseConnection } = require('../config/db');

function getHealth(req, res) {
  res.status(200).json({
    status: 'ok',
    message: 'Soya Ventures API is running',
    timestamp: new Date().toISOString(),
  });
}

async function getDatabaseReadiness(req, res) {
  try {
    const { latencyMs } = await checkDatabaseConnection();
    res.status(200).json({
      status: 'ok',
      database: 'connected',
      latencyMs,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      database: 'disconnected',
      message: 'Database readiness check failed',
      timestamp: new Date().toISOString(),
    });
  }
}

module.exports = {
  getHealth,
  getDatabaseReadiness,
};

