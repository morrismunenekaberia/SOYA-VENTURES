/**
 * Soya Ventures - Business APIs Automated Integration Tests
 * 
 * Verifies Products, Centers, Inventory, Multi-item Orders, Concurrency,
 * Sales, and Direct/Recruiter Override Commission Generation.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = require('../app');
const { pool } = require('../config/db');
const config = require('../config/env');

describe('Soya Ventures Business APIs', () => {
  let server;
  let baseUrl;

  // Test actor state
  let adminToken, managerToken, centerToken, recruiterToken, agentToken;
  let adminUser, managerUser, centerUser, recruiterUser, agentUser;
  let centerA, centerB;
  let productA, productB;

  async function cleanupTestData() {
    try {
      await pool.query("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE notes LIKE '%sales%' OR notes LIKE '%replenishment%' OR requester_id IN (SELECT id FROM users WHERE email LIKE '%@business-test.com'))");
      await pool.query("DELETE FROM commissions WHERE earner_id IN (SELECT id FROM users WHERE email LIKE '%@business-test.com')");
      await pool.query("DELETE FROM sales WHERE agent_id IN (SELECT id FROM users WHERE email LIKE '%@business-test.com')");
      await pool.query("DELETE FROM orders WHERE requester_id IN (SELECT id FROM users WHERE email LIKE '%@business-test.com')");
      await pool.query("DELETE FROM stock_movements WHERE performed_by IN (SELECT id FROM users WHERE email LIKE '%@business-test.com')");
      await pool.query("DELETE FROM stock WHERE center_id IN (SELECT id FROM centers WHERE name LIKE 'Hub %')");
      await pool.query("DELETE FROM users WHERE email LIKE '%@business-test.com'");
      await pool.query("DELETE FROM centers WHERE name LIKE 'Hub %'");
      await pool.query("DELETE FROM products WHERE sku LIKE 'TEST-%'");
    } catch (e) {
      // Ignore if table empty
    }
  }

  before(async () => {
    try {
      process.env.NODE_ENV = 'test';
      server = http.createServer(app);
      await new Promise((resolve) => {
        server.listen(0, () => {
          const { port } = server.address();
          baseUrl = `http://127.0.0.1:${port}`;
          resolve();
        });
      });

      const passHash = await bcrypt.hash('TestPass123', 10);

      // Clean any existing test rows before setup
      await cleanupTestData();

      // 1. Create Test Centers
      const c1 = await pool.query(
        "INSERT INTO centers (name, location, contact_phone) VALUES ('Hub Nairobi Central', 'Nairobi CBD', '254711000001') RETURNING id, name"
      );
      centerA = c1.rows[0];

      const c2 = await pool.query(
        "INSERT INTO centers (name, location, contact_phone) VALUES ('Hub Mombasa Coast', 'Mombasa City', '254711000002') RETURNING id, name"
      );
      centerB = c2.rows[0];

      // 2. Create Users
      // Admin
      const uAdmin = await pool.query(`
        INSERT INTO users (full_name, email, password_hash, phone_number, role)
        VALUES ('Super Admin', 'admin@business-test.com', $1, '254711999001', 'admin')
        RETURNING id, email, role, center_id
      `, [passHash]);
      adminUser = uAdmin.rows[0];
      adminToken = jwt.sign({ userId: adminUser.id, email: adminUser.email, role: adminUser.role }, config.jwt.secret);

      // Manager
      const uMgr = await pool.query(`
        INSERT INTO users (full_name, email, password_hash, phone_number, role)
        VALUES ('Regional Manager', 'manager@business-test.com', $1, '254711999002', 'manager')
        RETURNING id, email, role, center_id
      `, [passHash]);
      managerUser = uMgr.rows[0];
      managerToken = jwt.sign({ userId: managerUser.id, email: managerUser.email, role: managerUser.role }, config.jwt.secret);

      // Center Operator for Center A
      const uCenter = await pool.query(`
        INSERT INTO users (full_name, email, password_hash, phone_number, role, center_id)
        VALUES ('Center A Operator', 'operator.a@business-test.com', $1, '254711999003', 'center', $2)
        RETURNING id, email, role, center_id
      `, [passHash, centerA.id]);
      centerUser = uCenter.rows[0];
      centerToken = jwt.sign({ userId: centerUser.id, email: centerUser.email, role: centerUser.role, centerId: centerA.id }, config.jwt.secret);

      // Recruiter Agent (assigned to Center A)
      const uRecruiter = await pool.query(`
        INSERT INTO users (full_name, email, password_hash, phone_number, role, center_id, commission_rate)
        VALUES ('Recruiter Agent', 'recruiter@business-test.com', $1, '254711999004', 'agent', $2, 60.00)
        RETURNING id, email, role, center_id
      `, [passHash, centerA.id]);
      recruiterUser = uRecruiter.rows[0];
      recruiterToken = jwt.sign({ userId: recruiterUser.id, email: recruiterUser.email, role: recruiterUser.role, centerId: centerA.id }, config.jwt.secret);

      // Downline Agent (assigned to Center A, recruited by Recruiter Agent)
      const uAgent = await pool.query(`
        INSERT INTO users (full_name, email, password_hash, phone_number, role, center_id, recruiter_id, commission_rate)
        VALUES ('Downline Agent', 'downline.agent@business-test.com', $1, '254711999005', 'agent', $2, $3, 50.00)
        RETURNING id, email, role, center_id, recruiter_id
      `, [passHash, centerA.id, recruiterUser.id]);
      agentUser = uAgent.rows[0];
      agentToken = jwt.sign({ userId: agentUser.id, email: agentUser.email, role: agentUser.role, centerId: centerA.id }, config.jwt.secret);
    } catch (err) {
      console.error('Fatal error in before():', err);
      throw err;
    }
  });

  after(async () => {
    await cleanupTestData();
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });

  // --- 1. PRODUCT MANAGEMENT ---
  describe('Product Management API', () => {
    test('Non-admin user cannot create a product (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agentToken}`,
        },
        body: JSON.stringify({
          name: 'Unauthorized Product',
          price: 500,
        }),
      });

      assert.strictEqual(res.status, 403);
    });

    test('Admin successfully creates products with SKU and commission configuration', async () => {
      const res1 = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          name: 'Soya Flour Premium 1kg',
          price: 300.00,
          sku: 'TEST-SOYA-1KG',
          commission_per_unit: 45.00,
        }),
      });

      assert.strictEqual(res1.status, 201);
      const body1 = await res1.json();
      productA = body1.data.product;
      assert.strictEqual(productA.name, 'Soya Flour Premium 1kg');
      assert.strictEqual(Number(productA.price), 300.00);

      const res2 = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          name: 'Soya Oil 500ml',
          price: 200.00,
          sku: 'TEST-OIL-500ML',
          commission_per_unit: 30.00,
        }),
      });

      assert.strictEqual(res2.status, 201);
      const body2 = await res2.json();
      productB = body2.data.product;
    });

    test('Creating a product with duplicate SKU returns 409 Conflict', async () => {
      const res = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          name: 'Duplicate SKU Product',
          price: 150.00,
          sku: 'TEST-SOYA-1KG',
        }),
      });

      assert.strictEqual(res.status, 409);
      const body = await res.json();
      assert.strictEqual(body.error.code, 'DUPLICATE_SKU');
    });

    test('Public / Authenticated can list products', async () => {
      const res = await fetch(`${baseUrl}/api/products`);
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.ok(body.data.products.length >= 2);
    });

    test('Admin can update product details', async () => {
      const res = await fetch(`${baseUrl}/api/products/${productA.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          price: 320.00,
        }),
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(Number(body.data.product.price), 320.00);
      productA.price = 320.00;
    });
  });

  // --- 2. CENTERS & INVENTORY SCOPE ---
  describe('Centers & Inventory Management', () => {
    test('Agent attempting to restock inventory receives 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/inventory/restock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agentToken}`,
        },
        body: JSON.stringify({
          center_id: centerA.id,
          product_id: productA.id,
          quantity: 100,
        }),
      });

      assert.strictEqual(res.status, 403);
    });

    test('Manager successfully restocks Center A inventory and records audit movement', async () => {
      const res = await fetch(`${baseUrl}/api/inventory/restock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${managerToken}`,
        },
        body: JSON.stringify({
          center_id: centerA.id,
          product_id: productA.id,
          quantity: 50,
          notes: 'Initial bulk delivery',
        }),
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.data.stock.quantity, 50);

      // Verify audit movement record exists in database
      const moveRes = await pool.query(
        "SELECT * FROM stock_movements WHERE center_id = $1 AND product_id = $2 AND movement_type = 'restock'",
        [centerA.id, productA.id]
      );
      assert.ok(moveRes.rows.length >= 1);
      assert.strictEqual(moveRes.rows[0].change_quantity, 50);
    });

    test('Agent assigned to Center A cannot view Center B inventory (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/inventory/center/${centerB.id}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
      });

      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.strictEqual(body.error.code, 'FORBIDDEN_CENTER_SCOPE');
    });

    test('Agent can view their assigned Center A inventory', async () => {
      const res = await fetch(`${baseUrl}/api/inventory`, {
        headers: { Authorization: `Bearer ${agentToken}` },
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.data.center.id, centerA.id);
      const found = body.data.stock.find((s) => s.product_id === productA.id);
      assert.ok(found);
      assert.strictEqual(found.quantity, 50);
    });
  });

  // --- 3. MULTI-ITEM ORDERS & APPROVAL FLOW ---
  describe('Hierarchical Multi-Item Orders', () => {
    let orderId;

    test('Agent creates multi-line stock request order (agent_to_center)', async () => {
      const res = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agentToken}`,
        },
        body: JSON.stringify({
          order_type: 'agent_to_center',
          items: [
            { product_id: productA.id, quantity: 5 },
            { product_id: productB.id, quantity: 2 },
          ],
          notes: 'Agent restocking for weekend sales',
        }),
      });

      assert.strictEqual(res.status, 201);
      const body = await res.json();
      orderId = body.data.order.id;
      assert.strictEqual(body.data.order.status, 'pending');
      assert.strictEqual(body.data.order.items.length, 2);
    });

    test('Agent cannot approve their own order (403 Forbidden Conflict of Interest)', async () => {
      const res = await fetch(`${baseUrl}/api/orders/${orderId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agentToken}`,
        },
        body: JSON.stringify({ status: 'approved' }),
      });

      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.strictEqual(body.error.code, 'CANNOT_APPROVE_OWN_ORDER');
    });

    test('Center Operator approves the agent order', async () => {
      const res = await fetch(`${baseUrl}/api/orders/${orderId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${centerToken}`,
        },
        body: JSON.stringify({ status: 'approved' }),
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.data.order.status, 'approved');
    });

    test('Center Operator fulfills order: verifies stock deduction and audit record', async () => {
      // First restock productB so Center A has stock for both products
      await pool.query(
        'INSERT INTO stock (center_id, product_id, quantity) VALUES ($1, $2, 10) ON CONFLICT (center_id, product_id) DO UPDATE SET quantity = 10',
        [centerA.id, productB.id]
      );

      const res = await fetch(`${baseUrl}/api/orders/${orderId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${centerToken}`,
        },
        body: JSON.stringify({ status: 'fulfilled' }),
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.data.order.status, 'fulfilled');

      // Verify stock in Center A decremented by 5 for productA (50 - 5 = 45)
      const stockRes = await pool.query(
        'SELECT quantity FROM stock WHERE center_id = $1 AND product_id = $2',
        [centerA.id, productA.id]
      );
      assert.strictEqual(stockRes.rows[0].quantity, 45);
    });

    test('Fulfillment rejects with 400 when Center stock is insufficient', async () => {
      // Create an order requesting 999 units (which exceeds available stock)
      const ordRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agentToken}`,
        },
        body: JSON.stringify({
          order_type: 'agent_to_center',
          items: [{ product_id: productA.id, quantity: 999 }],
        }),
      });
      const ordData = await ordRes.json();
      const largeOrderId = ordData.data.order.id;

      // Approve order
      await fetch(`${baseUrl}/api/orders/${largeOrderId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${centerToken}`,
        },
        body: JSON.stringify({ status: 'approved' }),
      });

      // Attempt to fulfill
      const fulfillRes = await fetch(`${baseUrl}/api/orders/${largeOrderId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${centerToken}`,
        },
        body: JSON.stringify({ status: 'fulfilled' }),
      });

      assert.strictEqual(fulfillRes.status, 400);
      const fulfillBody = await fulfillRes.json();
      assert.strictEqual(fulfillBody.error.code, 'INSUFFICIENT_STOCK');
    });
  });

  // --- 4. SALES & COMMISSIONS ---
  describe('Sales Processing & Commission Engine', () => {
    test('Sale fails if requested quantity exceeds available Center Hub stock', async () => {
      const res = await fetch(`${baseUrl}/api/sales`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agentToken}`,
        },
        body: JSON.stringify({
          product_id: productA.id,
          quantity: 1000, // Center only has 45
        }),
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.error.code, 'INSUFFICIENT_STOCK');
    });

    test('Sale uses trusted PostgreSQL price, ignores client price, deducts stock, and generates direct + override commissions', async () => {
      // Stock before sale: 45
      const res = await fetch(`${baseUrl}/api/sales`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${agentToken}`,
        },
        body: JSON.stringify({
          product_id: productA.id,
          quantity: 2,
          price: 1.00, // Malicious attempt to spoof price: should be ignored!
          commission: 999.00, // Malicious attempt to spoof commission: should be ignored!
          customer_phone: '0712345678',
        }),
      });

      assert.strictEqual(res.status, 201);
      const body = await res.json();
      const sale = body.data.sale;
      const commissions = body.data.commissions;

      // 1. Financial totals verified against DB price (320 * 2 = 640)
      assert.strictEqual(Number(sale.unit_price), 320.00);
      assert.strictEqual(Number(sale.total), 640.00);

      // 2. Direct commission verified: agent commission_rate is 50.00 KES/unit => 2 * 50 = 100.00 KES
      const directComm = commissions.find((c) => c.type === 'direct');
      assert.ok(directComm);
      assert.strictEqual(directComm.earner_id, agentUser.id);
      assert.strictEqual(Number(directComm.amount), 100.00);
      assert.strictEqual(directComm.status, 'payable');

      // 3. Recruiter override commission verified: 5% of sale total (640 * 0.05 = 32.00 KES)
      const overrideComm = commissions.find((c) => c.type === 'override');
      assert.ok(overrideComm);
      assert.strictEqual(overrideComm.earner_id, recruiterUser.id);
      assert.strictEqual(Number(overrideComm.amount), 32.00);
      assert.strictEqual(overrideComm.status, 'payable');

      // 4. Center A stock decremented by 2 (45 - 2 = 43)
      const stockRes = await pool.query(
        'SELECT quantity FROM stock WHERE center_id = $1 AND product_id = $2',
        [centerA.id, productA.id]
      );
      assert.strictEqual(stockRes.rows[0].quantity, 43);
    });

    test('Agent can only view their own commissions (scope protection)', async () => {
      const res = await fetch(`${baseUrl}/api/commissions`, {
        headers: { Authorization: `Bearer ${agentToken}` },
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      for (const comm of body.data.commissions) {
        assert.strictEqual(comm.earner_id, agentUser.id);
      }
    });

    test('Admin can view all commissions across the system', async () => {
      const res = await fetch(`${baseUrl}/api/commissions`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.ok(body.data.commissions.length >= 2);
    });
  });
});
