/**
 * Soya Ventures - Hardening, Reliability & Security Tests
 * 
 * Verifies correlation ID tracking, payload size limiting, safe error sanitization,
 * logging redaction of passwords and phone numbers, and SQL injection resistance.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../app');
const { pool } = require('../config/db');
const { logger, maskPhone, redact } = require('../config/logger');

describe('Hardening, Reliability & Security Verification', () => {
  let server;
  let baseUrl;

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    await pool.end();
  });

  // --- 1. CORRELATION ID & REQUEST HEADERS ---
  describe('Correlation ID & Request Tracking', () => {
    test('Automatically assigns and returns an X-Request-Id header if none provided', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      assert.strictEqual(res.status, 200);

      const requestId = res.headers.get('x-request-id');
      assert.ok(requestId, 'Response must include X-Request-Id header');
      assert.match(
        requestId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        'Auto-generated X-Request-Id must be a valid UUID'
      );
    });

    test('Preserves client-supplied X-Request-Id for distributed tracing', async () => {
      const clientTraceId = 'trace-soya-client-custom-9988';
      const res = await fetch(`${baseUrl}/api/health`, {
        headers: { 'X-Request-Id': clientTraceId },
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('x-request-id'), clientTraceId);
    });

    test('Disables X-Powered-By header to prevent server fingerprinting', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      assert.strictEqual(res.headers.get('x-powered-by'), null);
    });
  });

  // --- 2. REQUEST PAYLOAD SIZE & PARSING GUARDS ---
  describe('Payload Size & Parsing Security', () => {
    test('Rejects request exceeding 100kb limit with 413 Payload Too Large', async () => {
      // Create a payload larger than 100kb (approx 120kb)
      const oversizedPayload = JSON.stringify({
        notes: 'A'.repeat(125 * 1024),
      });

      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: oversizedPayload,
      });

      assert.strictEqual(res.status, 413);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error.code, 'PAYLOAD_TOO_LARGE');
    });

    test('Rejects malformed JSON with 400 Bad Request and structured error', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ "broken_json": true, ', // Syntax error
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error.code, 'INVALID_JSON');
    });
  });

  // --- 3. STRUCTURED LOGGER & REDACTION ENGINE ---
  describe('Structured Logger & Redaction Engine', () => {
    test('maskPhone redacts middle digits of phone numbers', () => {
      assert.strictEqual(maskPhone('254712345678'), '254712***678');
      assert.strictEqual(maskPhone('+254700112233'), '+25470***233');
      assert.strictEqual(maskPhone('0712345678'), '07123***678');
      assert.strictEqual(maskPhone('123'), '***');
    });

    test('redact deep-cleans passwords, secrets, tokens, and authorization headers', () => {
      const dirtyObject = {
        email: 'user@example.com',
        password: 'mySuperSecretPassword123!',
        password_hash: '$2a$10$abcdefghijklmnopqrstuvwxyz',
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test',
        consumer_secret: 'daraja_sandbox_secret_998',
        security_credential: 'cert_encrypted_secret',
        phone_number: '254712345678',
        nested: {
          client_secret: 'nested_secret_123',
          normal_field: 'safe_data',
        },
      };

      const cleanObject = redact(dirtyObject);

      assert.strictEqual(cleanObject.email, 'user@example.com');
      assert.strictEqual(cleanObject.password, '[REDACTED]');
      assert.strictEqual(cleanObject.password_hash, '[REDACTED]');
      assert.strictEqual(cleanObject.token, '[REDACTED]');
      assert.strictEqual(cleanObject.consumer_secret, '[REDACTED]');
      assert.strictEqual(cleanObject.security_credential, '[REDACTED]');
      assert.strictEqual(cleanObject.phone_number, '254712***678');
      assert.strictEqual(cleanObject.nested.client_secret, '[REDACTED]');
      assert.strictEqual(cleanObject.nested.normal_field, 'safe_data');
    });

    test('redact safely handles circular references without throwing', () => {
      const circularObj = { name: 'Soya' };
      circularObj.self = circularObj;

      assert.doesNotThrow(() => {
        const result = redact(circularObj);
        assert.strictEqual(result.name, 'Soya');
        assert.strictEqual(result.self, '[Circular Reference]');
      });
    });

    test('redact strips bearer tokens from strings', () => {
      const text = 'Authorization header was: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz';
      const cleaned = redact(text);
      assert.strictEqual(cleaned, 'Authorization header was: Bearer [REDACTED]');
    });
  });

  // --- 4. SAFE ERROR RESPONSES & SQL INJECTION PROTECTION ---
  describe('Safe Error Sanitization & SQL Injection Protection', () => {
    test('404 endpoint response does not leak internal server details', async () => {
      const res = await fetch(`${baseUrl}/api/some/random/unmapped/path`);
      assert.strictEqual(res.status, 404);

      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error.code, 'NOT_FOUND');
      assert.strictEqual(body.error.stack, undefined);
    });

    test('Parameterized queries safely neutralize SQL injection attempts in search queries', async () => {
      const maliciousInput = "' OR 1=1 --";
      const encoded = encodeURIComponent(maliciousInput);

      // Attempt SQL injection via query parameters
      const res = await fetch(`${baseUrl}/api/products?include_inactive=${encoded}`);

      // Route safely handles or coerces input without database syntax error or 500 crash
      assert.ok([200, 400].includes(res.status));
      const body = await res.json();
      assert.strictEqual(body.success, true);
    });
  });
});

