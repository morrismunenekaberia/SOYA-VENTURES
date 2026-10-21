/**
 * Soya Ventures - Authentication, RBAC, Validation & Rate Limiting Tests
 */

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const app = require('../app');
const { pool } = require('../config/db');
const authRoutes = require('../routes/authRoutes');

describe('Authentication, Validation, RBAC & Rate Limiting', () => {
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
    // Clean up all test users created during test runs
    await pool.query("DELETE FROM users WHERE email LIKE '%@test-auth.com'");
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });

  beforeEach(async () => {
    // Reset rate limiter state between tests
    if (authRoutes.authLimiter && authRoutes.authLimiter.reset) {
      authRoutes.authLimiter.reset();
    }
  });

  // --- SECTION 1: REQUEST VALIDATION ---
  describe('Input Validation & Status Codes', () => {
    test('Registration fails with 400 when full_name is missing or too short', async () => {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: 'A',
          email: 'shortname@test-auth.com',
          password: 'password123',
          phone_number: '0712345678',
        }),
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error.code, 'INVALID_NAME');
    });

    test('Registration fails with 400 when email format is invalid', async () => {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: 'Valid Name',
          email: 'not-an-email',
          password: 'password123',
          phone_number: '0712345678',
        }),
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error.code, 'INVALID_EMAIL');
    });

    test('Registration fails with 400 when password is under 6 characters', async () => {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: 'Valid Name',
          email: 'shortpass@test-auth.com',
          password: '123',
          phone_number: '0712345678',
        }),
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error.code, 'WEAK_PASSWORD');
    });

    test('Registration fails with 400 when phone number is invalid', async () => {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: 'Valid Name',
          email: 'badphone@test-auth.com',
          password: 'password123',
          phone_number: '12345',
        }),
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error.code, 'INVALID_PHONE');
    });
  });

  // --- SECTION 2: REGISTRATION & ROLE ENFORCEMENT ---
  describe('Public Registration & Role Restrictions', () => {
    test('Public registration strictly forces agent role even if admin role is requested', async () => {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: 'Agent Wannabe Admin',
          email: 'wannabe.admin@test-auth.com',
          password: 'password123',
          phone_number: '0700111222',
          role: 'admin', // Malicious attempt to elevate role
        }),
      });

      assert.strictEqual(res.status, 201);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.user.role, 'agent'); // Strictly enforced as agent!
      assert.strictEqual(body.data.user.phone_number, '254700111222'); // Normalized MSISDN
      assert.strictEqual(body.data.user.password_hash, undefined); // Password hash NEVER exposed
      assert.ok(body.data.token);
    });

    test('Registration rejects duplicate email with 409 Conflict', async () => {
      const payload = {
        full_name: 'Duplicate Email Test',
        email: 'duplicate.email@test-auth.com',
        password: 'password123',
        phone_number: '0700333444',
      };

      // First registration
      const firstRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      assert.strictEqual(firstRes.status, 201);

      // Second registration with same email
      const secondRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, phone_number: '0700333445' }),
      });
      assert.strictEqual(secondRes.status, 409);
      const body = await secondRes.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error.code, 'DUPLICATE_EMAIL');
    });

    test('Registration rejects duplicate phone number with 409 Conflict', async () => {
      const payload = {
        full_name: 'Duplicate Phone Test',
        email: 'phone1@test-auth.com',
        password: 'password123',
        phone_number: '0700555666',
      };

      const firstRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      assert.strictEqual(firstRes.status, 201);

      const secondRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, email: 'phone2@test-auth.com' }),
      });
      assert.strictEqual(secondRes.status, 409);
      const body = await secondRes.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error.code, 'DUPLICATE_PHONE');
    });
  });

  // --- SECTION 3: LOGIN & AUTHENTICATION ---
  describe('Login & Token Verification', () => {
    let agentEmail = 'login.test@test-auth.com';
    let agentPass = 'SecureP@ss123';
    let agentToken;

    before(async () => {
      const regRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: 'Login Test Agent',
          email: agentEmail,
          password: agentPass,
          phone_number: '0700777888',
        }),
      });
      const data = await regRes.json();
      agentToken = data.data.token;
    });

    test('Login succeeds with correct credentials and returns signed JWT token', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: agentEmail,
          password: agentPass,
        }),
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.ok(body.data.token);
      assert.strictEqual(body.data.user.email, agentEmail);
      assert.strictEqual(body.data.user.password_hash, undefined);
    });

    test('Login fails with 401 for incorrect password', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: agentEmail,
          password: 'WrongPassword123',
        }),
      });

      assert.strictEqual(res.status, 401);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error.code, 'INVALID_CREDENTIALS');
    });

    test('Login fails with 401 for non-existent email', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'nonexistent.user@test-auth.com',
          password: 'SomePassword123',
        }),
      });

      assert.strictEqual(res.status, 401);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error.code, 'INVALID_CREDENTIALS');
    });

    test('GET /api/auth/me returns 200 and user profile when Bearer token is provided', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${agentToken}` },
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.user.email, agentEmail);
      assert.strictEqual(body.data.user.role, 'agent');
    });

    test('GET /api/auth/me returns 401 when Authorization header is missing', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`);
      assert.strictEqual(res.status, 401);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error.code, 'UNAUTHORIZED');
    });

    test('GET /api/auth/me returns 401 when token is forged or invalid', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: 'Bearer forged.token.value' },
      });
      assert.strictEqual(res.status, 401);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error.code, 'INVALID_TOKEN');
    });
  });

  // --- SECTION 4: ROLE-BASED ACCESS CONTROL (RBAC) ---
  describe('Role-Based Authorization & Administrative User Creation', () => {
    let adminToken;
    let agentToken;

    before(async () => {
      // 1. Create an admin user directly in DB for testing
      const bcrypt = require('bcryptjs');
      const jwt = require('jsonwebtoken');
      const config = require('../config/env');

      const passHash = await bcrypt.hash('AdminP@ss123', 10);
      const adminRes = await pool.query(`
        INSERT INTO users (full_name, email, password_hash, phone_number, role)
        VALUES ('System Admin', 'superadmin@test-auth.com', $1, '254799000111', 'admin')
        RETURNING id, email, role
      `, [passHash]);
      const admin = adminRes.rows[0];
      adminToken = jwt.sign({ userId: admin.id, email: admin.email, role: admin.role }, config.jwt.secret);

      // 2. Register an agent user
      const agentRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: 'Regular Agent',
          email: 'regular.agent@test-auth.com',
          password: 'password123',
          phone_number: '0799000222',
        }),
      });
      const agentData = await agentRes.json();
      agentToken = agentData.data.token;
    });

    test('Agent attempting to create a user on POST /api/users receives 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agentToken}`,
        },
        body: JSON.stringify({
          full_name: 'New Manager',
          email: 'manager.attempt@test-auth.com',
          password: 'password123',
          phone_number: '0799000333',
          role: 'manager',
        }),
      });

      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error.code, 'FORBIDDEN');
    });

    test('Admin can successfully create privileged manager, center, and agent accounts', async () => {
      const res = await fetch(`${baseUrl}/api/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          full_name: 'Finance Manager',
          email: 'manager.official@test-auth.com',
          password: 'password123',
          phone_number: '0799000444',
          role: 'manager',
        }),
      });

      assert.strictEqual(res.status, 201);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.user.role, 'manager');
      assert.strictEqual(body.data.user.email, 'manager.official@test-auth.com');
      assert.strictEqual(body.data.user.password_hash, undefined);
    });

    test('Agent attempting to list users receives 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/users`, {
        headers: { Authorization: `Bearer ${agentToken}` },
      });

      assert.strictEqual(res.status, 403);
    });

    test('Admin can list users on GET /api/users', async () => {
      const res = await fetch(`${baseUrl}/api/users`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.ok(Array.isArray(body.data.users));
      assert.ok(body.data.users.length > 0);
    });
  });

  // --- SECTION 5: RATE LIMITING ---
  describe('Rate Limiting Protection', () => {
    test('Exceeding rate limit threshold triggers 429 Too Many Requests', async () => {
      const limit = 20;

      // Send requests up to limit
      for (let i = 0; i < limit; i++) {
        const res = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'rate.limit@test-auth.com',
            password: 'anyPassword',
          }),
        });
        // Status should be 401 (unauthorized), not 429 yet
        assert.ok(res.status === 401);
      }

      // 21st request should hit the rate limiter and return 429
      const blockedRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'rate.limit@test-auth.com',
          password: 'anyPassword',
        }),
      });

      assert.strictEqual(blockedRes.status, 429);
      const body = await blockedRes.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error.code, 'RATE_LIMIT_EXCEEDED');
    });
  });
});
