/**
 * Soya Ventures - Migration and Schema Integrity Tests
 * 
 * Tests the PostgreSQL schema, constraints, payout uniqueness,
 * referral integrity, and audit logging guards without leaving dirty data.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../../db');

describe('Database Schema & Constraint Verification', () => {
  let client;

  before(async () => {
    client = await pool.connect();
  });

  after(async () => {
    if (client) client.release();
    await pool.end();
  });

  test('All migrations are marked as applied in schema_migrations', async () => {
    const res = await client.query('SELECT version FROM schema_migrations ORDER BY version');
    const appliedVersions = res.rows.map(r => r.version);
    const expected = [
      '001_initial_baseline.sql',
      '002_users_and_referrals.sql',
      '003_inventory_and_orders.sql',
      '004_payouts_ledger.sql',
      '005_audit_logs.sql',
      '006_performance_indexes.sql',
      '007_create_order_items.sql',
    ];
    for (const exp of expected) {
      assert.ok(appliedVersions.includes(exp), `Expected migration ${exp} to be applied`);
    }
  });

  test('All expected tables exist in public schema', async () => {
    const res = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    const tables = res.rows.map(r => r.table_name);
    const required = [
      'centers',
      'users',
      'products',
      'stock',
      'orders',
      'order_items',
      'sales',
      'commissions',
      'stock_movements',
      'payout_batches',
      'payout_items',
      'audit_logs',
      'schema_migrations',
    ];
    for (const t of required) {
      assert.ok(tables.includes(t), `Table ${t} should exist`);
    }
  });

  test('User self-referral constraint prevents user from recruiting themselves', async () => {
    await client.query('BEGIN');
    try {
      const userRes = await client.query(`
        INSERT INTO users (full_name, email, password_hash, phone_number, role)
        VALUES ('Test User', 'test.agent@example.com', 'hashed_pass', '254700000001', 'agent')
        RETURNING id
      `);
      const userId = userRes.rows[0].id;

      // Attempting to set recruiter_id = id should fail with check constraint
      await assert.rejects(
        async () => {
          await client.query(
            'UPDATE users SET recruiter_id = $1 WHERE id = $1',
            [userId]
          );
        },
        /users_no_self_referral/
      );
    } finally {
      await client.query('ROLLBACK');
    }
  });

  test('Commissions table strictly limits sales to at most 1 direct and 1 override commission', async () => {
    await client.query('BEGIN');
    try {
      const centerRes = await client.query(
        "INSERT INTO centers (name, location) VALUES ('Test Hub', 'Nairobi') RETURNING id"
      );
      const centerId = centerRes.rows[0].id;

      const userRes = await client.query(`
        INSERT INTO users (full_name, email, password_hash, phone_number, role, center_id)
        VALUES ('Agent A', 'agent.a@example.com', 'hash', '254700000002', 'agent', $1)
        RETURNING id
      `, [centerId]);
      const agentId = userRes.rows[0].id;

      const prodRes = await client.query(
        "INSERT INTO products (name, price) VALUES ('Soya Flour 1kg', 250.00) RETURNING id"
      );
      const prodId = prodRes.rows[0].id;

      const saleRes = await client.query(`
        INSERT INTO sales (agent_id, product_id, center_id, quantity, unit_price, total)
        VALUES ($1, $2, $3, 2, 250.00, 500.00)
        RETURNING id
      `, [agentId, prodId, centerId]);
      const saleId = saleRes.rows[0].id;

      // Insert first override commission: should succeed
      await client.query(`
        INSERT INTO commissions (sale_id, earner_id, type, amount, status)
        VALUES ($1, $2, 'override', 50.00, 'payable')
      `, [saleId, agentId]);

      // Attempting to insert a SECOND override commission on the same sale must fail
      await assert.rejects(
        async () => {
          await client.query(`
            INSERT INTO commissions (sale_id, earner_id, type, amount, status)
            VALUES ($1, $2, 'override', 25.00, 'payable')
          `, [saleId, agentId]);
        },
        /uq_commissions_sale_type/
      );
    } finally {
      await client.query('ROLLBACK');
    }
  });

  test('Payout items cannot include the same commission in multiple active payouts', async () => {
    await client.query('BEGIN');
    try {
      const managerRes = await client.query(`
        INSERT INTO users (full_name, email, password_hash, phone_number, role)
        VALUES ('Finance Manager', 'manager.payout@example.com', 'hash', '254700000003', 'manager')
        RETURNING id
      `);
      const managerId = managerRes.rows[0].id;

      const agentRes = await client.query(`
        INSERT INTO users (full_name, email, password_hash, phone_number, role)
        VALUES ('Recipient Agent', 'agent.payout@example.com', 'hash', '254700000004', 'agent')
        RETURNING id
      `);
      const agentId = agentRes.rows[0].id;

      const prodRes = await client.query(
        "INSERT INTO products (name, price) VALUES ('Soya Milk 500ml', 100.00) RETURNING id"
      );
      const prodId = prodRes.rows[0].id;

      const saleRes = await client.query(`
        INSERT INTO sales (agent_id, product_id, quantity, total)
        VALUES ($1, $2, 1, 100.00)
        RETURNING id
      `, [agentId, prodId]);
      const saleId = saleRes.rows[0].id;

      const commRes = await client.query(`
        INSERT INTO commissions (sale_id, earner_id, type, amount, status)
        VALUES ($1, $2, 'direct', 20.00, 'processing')
        RETURNING id
      `, [saleId, agentId]);
      const commissionId = commRes.rows[0].id;

      const batchRes = await client.query(`
        INSERT INTO payout_batches (batch_reference, initiating_manager_id, total_amount, item_count, status)
        VALUES ('BATCH-TEST-001', $1, 20.00, 1, 'processing')
        RETURNING id
      `, [managerId]);
      const batchId = batchRes.rows[0].id;

      // Add commission to active payout item: should succeed
      await client.query(`
        INSERT INTO payout_items (batch_id, recipient_id, phone_number, commission_id, amount, payout_reference, status)
        VALUES ($1, $2, '254700000004', $3, 20.00, 'PAY-REF-001', 'pending')
      `, [batchId, agentId, commissionId]);

      // Attempting to add the same commission to another pending/processing payout item must be rejected
      await assert.rejects(
        async () => {
          await client.query(`
            INSERT INTO payout_items (batch_id, recipient_id, phone_number, commission_id, amount, payout_reference, status)
            VALUES ($1, $2, '254700000004', $3, 20.00, 'PAY-REF-002', 'processing')
          `, [batchId, agentId, commissionId]);
        },
        /uq_payout_items_active_commission/
      );
    } finally {
      await client.query('ROLLBACK');
    }
  });

  test('Audit log table rejects credentials and passwords in new_values and old_values', async () => {
    // 1. Valid audit log should succeed
    await client.query('BEGIN');
    try {
      await client.query(`
        INSERT INTO audit_logs (action, entity_type, entity_id, new_values)
        VALUES ('STATUS_CHANGE', 'order', '101', '{"status": "approved"}'::jsonb)
      `);
    } finally {
      await client.query('ROLLBACK');
    }

    // 2. Attempt to log password_hash in new_values must fail
    await client.query('BEGIN');
    try {
      await assert.rejects(
        async () => {
          await client.query(`
            INSERT INTO audit_logs (action, entity_type, entity_id, new_values)
            VALUES ('USER_UPDATE', 'user', '1', '{"password_hash": "secret_hash"}'::jsonb)
          `);
        },
        /audit_no_secrets_in_new_values/
      );
    } finally {
      await client.query('ROLLBACK');
    }

    // 3. Attempt to log access_token in old_values must fail
    await client.query('BEGIN');
    try {
      await assert.rejects(
        async () => {
          await client.query(`
            INSERT INTO audit_logs (action, entity_type, entity_id, old_values)
            VALUES ('TOKEN_REVOKE', 'user', '1', '{"access_token": "jwt_token_123"}'::jsonb)
          `);
        },
        /audit_no_secrets_in_old_values/
      );
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
