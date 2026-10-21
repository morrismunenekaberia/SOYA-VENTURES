/**
 * Soya Ventures - Server Entrypoint
 */

const app = require('./app');
const config = require('./config/env');
const { pool } = require('./config/db');

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`\n🚀 Soya Ventures API server listening on http://0.0.0.0:${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`Health check: http://localhost:${config.port}/api/health`);
  console.log(`DB readiness: http://localhost:${config.port}/api/health/db\n`);
});

// Graceful shutdown handling
function handleGracefulShutdown(signal) {
  console.log(`\nReceived ${signal}. Gracefully terminating server...`);
  server.close(async () => {
    console.log('HTTP server closed.');
    try {
      await pool.end();
      console.log('PostgreSQL connection pool drained.');
      process.exit(0);
    } catch (err) {
      console.error('Error during pool draining:', err.message);
      process.exit(1);
    }
  });
}

process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));

module.exports = server;
