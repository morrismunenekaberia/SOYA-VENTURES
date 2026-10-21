/**
 * Soya Ventures - Health & Readiness Endpoint Tests
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const app = require('../app');
const { pool } = require('../config/db');

describe('Health & Database Readiness Endpoints', () => {
  let server;
  let baseUrl;

  before(async () => {
    process.env.NODE_ENV = 'test';
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, () => {
        const { port } = server.address();
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });

  test('GET /api/health returns 200 with API status', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
    assert.strictEqual(body.message, 'Soya Ventures API is running');
    assert.ok(body.timestamp);
  });

  test('GET /api/health/db returns 200 when database is connected', async () => {
    const res = await fetch(`${baseUrl}/api/health/db`);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
    assert.strictEqual(body.database, 'connected');
    assert.ok(typeof body.latencyMs === 'number');
  });

  test('GET /api/nonexistent returns 404 with structured JSON error', async () => {
    const res = await fetch(`${baseUrl}/api/nonexistent`);
    assert.strictEqual(res.status, 404);

    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'NOT_FOUND');
  });
});
