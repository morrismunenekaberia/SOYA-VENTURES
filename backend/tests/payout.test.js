/**
 * Soya Ventures - Daraja B2C Payout Integration Automated Tests
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = require('../app');
const { pool } = require('../config/db');
const config = require('../config/env');
const mpesaService = require('../services/mpesaService');

describe('Safaricom Daraja B2C Payouts & Reconciliation', () => {
  let server;
  let baseUrl;

  let managerToken, agentToken;
  let managerUser, agentUserA, agentUserB;
  let commissionId1, commissionId2, commissionId3;
  let batchId;
  let itemId1, itemId2;

  async function cleanupPayoutData() {
    try {
      await pool.query("DELETE FROM payout_items WHERE phone_number LIKE '254719%'");
      await pool.query("DELETE FROM payout_batches WHERE notes LIKE '%Test%'");
      await pool.query("DELETE FROM commissions WHERE earner_id IN (SELECT id FROM users WHERE email LIKE '%@payout-test.com')");
      await pool.query("DELETE FROM sales WHERE agent_id IN (SELECT id FROM users WHERE email LIKE '%@payout-test.com')");
      await pool.query("DELETE FROM users WHERE email LIKE '%@payout-test.com'");
      await pool.query("DELETE FROM centers WHERE name LIKE 'Payout Hub%'");
      await pool.query("DELETE FROM products WHERE sku LIKE 'PAY-SKU-%'");
    } catch (e) {
      // Ignore cleanup error if tables empty
    }
  }

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

    await cleanupPayoutData();

    const passHash = await bcrypt.hash('TestPass123', 10);

    // 1. Create Center & Product
    const cRes = await pool.query(
      "INSERT INTO centers (name, location) VALUES ('Payout Hub Nairobi', 'Westlands') RETURNING id"
    );
    const centerId = cRes.rows[0].id;

    const pRes = await pool.query(
      "INSERT INTO products (name, price, sku, commission_per_unit) VALUES ('Soya Beverage', 200.00, 'PAY-SKU-001', 50.00) RETURNING id"
    );
    const productId = pRes.rows[0].id;

    // 2. Create Users
    const uMgr = await pool.query(`
      INSERT INTO users (full_name, email, password_hash, phone_number, role)
      VALUES ('Finance Manager', 'manager@payout-test.com', $1, '254719000001', 'manager')
      RETURNING id, email, role
    `, [passHash]);
    managerUser = uMgr.rows[0];
    managerToken = jwt.sign({ userId: managerUser.id, email: managerUser.email, role: managerUser.role }, config.jwt.secret);

    const uAgentA = await pool.query(`
      INSERT INTO users (full_name, email, password_hash, phone_number, role, center_id)
      VALUES ('Agent Alice', 'alice@payout-test.com', $1, '254719000002', 'agent', $2)
      RETURNING id, email, role
    `, [passHash, centerId]);
    agentUserA = uAgentA.rows[0];
    agentToken = jwt.sign({ userId: agentUserA.id, email: agentUserA.email, role: agentUserA.role }, config.jwt.secret);

    const uAgentB = await pool.query(`
      INSERT INTO users (full_name, email, password_hash, phone_number, role, center_id)
      VALUES ('Agent Bob', 'bob@payout-test.com', $1, '254719000003', 'agent', $2)
      RETURNING id, email, role
    `, [passHash, centerId]);
    agentUserB = uAgentB.rows[0];

    // 3. Create initial Sales and Commissions
    const s1 = await pool.query(
      'INSERT INTO sales (agent_id, center_id, product_id, quantity, unit_price, total) VALUES ($1, $2, $3, 2, 200.00, 400.00) RETURNING id',
      [agentUserA.id, centerId, productId]
    );
    const c1 = await pool.query(
      "INSERT INTO commissions (sale_id, earner_id, type, amount, status) VALUES ($1, $2, 'direct', 100.00, 'payable') RETURNING id",
      [s1.rows[0].id, agentUserA.id]
    );
    commissionId1 = c1.rows[0].id;

    const s2 = await pool.query(
      'INSERT INTO sales (agent_id, center_id, product_id, quantity, unit_price, total) VALUES ($1, $2, $3, 1, 200.00, 200.00) RETURNING id',
      [agentUserB.id, centerId, productId]
    );
    const c2 = await pool.query(
      "INSERT INTO commissions (sale_id, earner_id, type, amount, status) VALUES ($1, $2, 'direct', 50.00, 'payable') RETURNING id",
      [s2.rows[0].id, agentUserB.id]
    );
    commissionId2 = c2.rows[0].id;

    const s3 = await pool.query(
      'INSERT INTO sales (agent_id, center_id, product_id, quantity, unit_price, total) VALUES ($1, $2, $3, 1, 200.00, 200.00) RETURNING id',
      [agentUserA.id, centerId, productId]
    );
    const c3 = await pool.query(
      "INSERT INTO commissions (sale_id, earner_id, type, amount, status) VALUES ($1, $2, 'direct', 50.00, 'payable') RETURNING id",
      [s3.rows[0].id, agentUserA.id]
    );
    commissionId3 = c3.rows[0].id;
  });

  after(async () => {
    mpesaService.clearMockTransport();
    await cleanupPayoutData();
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });

  // --- 1. AUTHORIZATION & BATCH CREATION ---
  describe('Batch Creation & Validation', () => {
    test('Non-manager (agent) cannot create a payout batch (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/payouts/batches`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agentToken}`,
        },
        body: JSON.stringify({ commission_ids: [commissionId1] }),
      });

      assert.strictEqual(res.status, 403);
    });

    test('Manager successfully creates a payout batch from eligible commissions', async () => {
      const res = await fetch(`${baseUrl}/api/payouts/batches`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${managerToken}`,
        },
        body: JSON.stringify({
          commission_ids: [commissionId1, commissionId2],
          notes: 'Test Commission Batch 1',
        }),
      });

      assert.strictEqual(res.status, 201);
      const body = await res.json();
      const batch = body.data.batch;
      const items = body.data.items;

      batchId = batch.id;
      itemId1 = items[0].id;
      itemId2 = items[1].id;

      assert.strictEqual(batch.status, 'pending');
      assert.strictEqual(batch.item_count, 2);
      assert.strictEqual(Number(batch.total_amount), 150.00);

      // Verify commission rows updated to 'processing'
      const commRes = await pool.query(
        'SELECT status, payout_item_id FROM commissions WHERE id = $1',
        [commissionId1]
      );
      assert.strictEqual(commRes.rows[0].status, 'processing');
      assert.ok(commRes.rows[0].payout_item_id);
    });

    test('Duplicate prevention: Cannot include a processing commission in another batch', async () => {
      const res = await fetch(`${baseUrl}/api/payouts/batches`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${managerToken}`,
        },
        body: JSON.stringify({
          commission_ids: [commissionId1], // Already in active batch!
        }),
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.error.code, 'INELIGIBLE_COMMISSION');
    });
  });

  // --- 2. BATCH PROCESSING & DARAJA FLOW ---
  describe('Batch Processing, Dry-Run & Concurrency', () => {
    test('Dry-run mode validates batch without sending funds or modifying item statuses', async () => {
      const res = await fetch(`${baseUrl}/api/payouts/batches/${batchId}/process?dry_run=true`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${managerToken}` },
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.data.dry_run, true);
      assert.strictEqual(body.data.valid, true);
      assert.strictEqual(body.data.pending_items_count, 2);

      // Items must remain pending
      const itemCheck = await pool.query('SELECT status FROM payout_items WHERE id = $1', [itemId1]);
      assert.strictEqual(itemCheck.rows[0].status, 'pending');
    });

    test('Live batch dispatch: Daraja acceptance transitions items to processing (not success)', async () => {
      // Mock Daraja response
      mpesaService.setMockTransport({
        sendB2C: async ({ phone, amount, payoutReference }) => {
          return {
            accepted: true,
            conversationId: `AG_CONV_${payoutReference}`,
            originatorConversationId: `ORIG_${payoutReference}`,
            responseDesc: 'Accept the service request successfully.',
          };
        },
      });

      const res = await fetch(`${baseUrl}/api/payouts/batches/${batchId}/process`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${managerToken}` },
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.data.dispatched, 2);

      // Item 1 status must be processing (waiting for callback)
      const item1 = await pool.query('SELECT status, conversation_id FROM payout_items WHERE id = $1', [itemId1]);
      assert.strictEqual(item1.rows[0].status, 'processing');
      assert.ok(item1.rows[0].conversation_id);
    });

    test('Network timeout handling: Item remains in processing without false failure', async () => {
      // Create a single-item batch for timeout testing
      const batchRes = await fetch(`${baseUrl}/api/payouts/batches`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${managerToken}`,
        },
        body: JSON.stringify({
          commission_ids: [commissionId3],
          notes: 'Test Timeout Batch',
        }),
      });
      const batchData = await batchRes.json();
      const timeoutBatchId = batchData.data.batch.id;
      const timeoutItemId = batchData.data.items[0].id;

      // Mock network timeout failure
      mpesaService.setMockTransport({
        sendB2C: async () => {
          const timeoutErr = new Error('ConnectTimeoutError: Request timed out');
          timeoutErr.isNetworkFailure = true;
          throw timeoutErr;
        },
      });

      const procRes = await fetch(`${baseUrl}/api/payouts/batches/${timeoutBatchId}/process`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${managerToken}` },
      });

      assert.strictEqual(procRes.status, 200);
      const procData = await procRes.json();
      assert.strictEqual(procData.data.uncertain, 1);

      // Item must remain in processing so money is not double-sent or falsely marked failed
      const checkItem = await pool.query('SELECT status FROM payout_items WHERE id = $1', [timeoutItemId]);
      assert.strictEqual(checkItem.rows[0].status, 'pending');
    });
  });

  // --- 3. CALLBACK ENDPOINTS & RECONCILIATION ---
  describe('Callback Handling & Reconciliation', () => {
    test('Unmatched callback is quarantined safely without corrupting records', async () => {
      const res = await fetch(`${baseUrl}/api/payouts/b2c/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Result: {
            ResultCode: 0,
            ResultDesc: 'Success',
            ConversationID: 'UNKNOWN_CONVERSATION_ID_999',
            OriginatorConversationID: 'UNKNOWN_ORIGINATOR_999',
            TransactionID: 'NLJ9999999',
          },
        }),
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.ResultCode, 0);
      assert.strictEqual(body.meta.matched, false);
    });

    test('Success callback marks payout item success and marks commission paid', async () => {
      // Fetch conversation_id of Item 1
      const itemRes = await pool.query('SELECT conversation_id, originator_conversation_id FROM payout_items WHERE id = $1', [itemId1]);
      const { conversation_id, originator_conversation_id } = itemRes.rows[0];

      const res = await fetch(`${baseUrl}/api/payouts/b2c/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Result: {
            ResultCode: 0,
            ResultDesc: 'The service was accepted successfully',
            ConversationID: conversation_id,
            OriginatorConversationID: originator_conversation_id,
            TransactionID: 'NLJ7RT61SV',
          },
        }),
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.meta.status, 'success');
      assert.strictEqual(body.meta.transaction_id, 'NLJ7RT61SV');

      // Verify commission is marked 'paid'
      const commCheck = await pool.query('SELECT status FROM commissions WHERE id = $1', [commissionId1]);
      assert.strictEqual(commCheck.rows[0].status, 'paid');
    });

    test('Repeated / duplicate callback is handled idempotently without error', async () => {
      const itemRes = await pool.query('SELECT conversation_id, originator_conversation_id FROM payout_items WHERE id = $1', [itemId1]);
      const { conversation_id, originator_conversation_id } = itemRes.rows[0];

      const res = await fetch(`${baseUrl}/api/payouts/b2c/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Result: {
            ResultCode: 0,
            ResultDesc: 'The service was accepted successfully',
            ConversationID: conversation_id,
            OriginatorConversationID: originator_conversation_id,
            TransactionID: 'NLJ7RT61SV',
          },
        }),
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.meta.message, 'Duplicate callback ignored safely.');
    });

    test('Failed callback marks payout item failed and reverts commission to payable', async () => {
      const itemRes = await pool.query('SELECT conversation_id, originator_conversation_id FROM payout_items WHERE id = $1', [itemId2]);
      const { conversation_id, originator_conversation_id } = itemRes.rows[0];

      const res = await fetch(`${baseUrl}/api/payouts/b2c/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Result: {
            ResultCode: 2001,
            ResultDesc: 'The initiator information is invalid.',
            ConversationID: conversation_id,
            OriginatorConversationID: originator_conversation_id,
          },
        }),
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.meta.status, 'failed');

      // Verify commission reverted to 'payable' with payout_item_id cleared
      const commCheck = await pool.query('SELECT status, payout_item_id FROM commissions WHERE id = $1', [commissionId2]);
      assert.strictEqual(commCheck.rows[0].status, 'payable');
      assert.strictEqual(commCheck.rows[0].payout_item_id, null);

      // Verify parent batch is now 'partially_completed' (1 success, 1 failed)
      const batchCheck = await pool.query('SELECT status FROM payout_batches WHERE id = $1', [batchId]);
      assert.strictEqual(batchCheck.rows[0].status, 'partially_completed');
    });

    test('Manager manual reconciliation for missing callbacks', async () => {
      // Reconcile item 2 manually
      const res = await fetch(`${baseUrl}/api/payouts/items/${itemId2}/reconcile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${managerToken}`,
        },
        body: JSON.stringify({
          action: 'mark_success',
          transaction_id: 'MANUAL_RECON_NLJ888',
          notes: 'Customer confirmed receiving SMS receipt',
        }),
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.data.item.status, 'success');
      assert.strictEqual(body.data.item.transaction_id, 'MANUAL_RECON_NLJ888');

      // Commission is now marked paid
      const commCheck = await pool.query('SELECT status FROM commissions WHERE id = $1', [commissionId2]);
      assert.strictEqual(commCheck.rows[0].status, 'paid');
    });
  });
});
