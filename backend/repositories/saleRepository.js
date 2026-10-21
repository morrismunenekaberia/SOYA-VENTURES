/**
 * Soya Ventures - Sales & Commission Repository
 */

const { pool } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

const RECRUITER_OVERRIDE_PERCENTAGE = 0.05; // 5% of total sale amount

async function recordSale({ agent, product_id, quantity, customer_phone = null }) {
  if (!agent.center_id) {
    throw new AppError('Agent is not assigned to a Center Hub.', 400, 'UNASSIGNED_CENTER');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Fetch trusted product details with row lock
    const prodRes = await client.query(
      'SELECT id, name, price, commission_per_unit, is_active FROM products WHERE id = $1 FOR UPDATE',
      [product_id]
    );
    if (prodRes.rows.length === 0) {
      throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
    }
    const product = prodRes.rows[0];
    if (!product.is_active) {
      throw new AppError(`Product '${product.name}' is inactive and cannot be sold.`, 400, 'INACTIVE_PRODUCT');
    }

    // 2. Fetch and lock stock at agent's center hub
    const stockRes = await client.query(
      'SELECT quantity FROM stock WHERE center_id = $1 AND product_id = $2 FOR UPDATE',
      [agent.center_id, product_id]
    );
    const currentStock = stockRes.rows[0] ? stockRes.rows[0].quantity : 0;

    if (currentStock < quantity) {
      throw new AppError(
        `Insufficient inventory at Center Hub for '${product.name}'. Available: ${currentStock}, Requested: ${quantity}.`,
        400,
        'INSUFFICIENT_STOCK'
      );
    }

    // 3. Compute trusted prices and totals
    const unit_price = Number(product.price);
    const total = Number((unit_price * quantity).toFixed(2));

    // 4. Deduct inventory from Center Hub
    await client.query(
      'UPDATE stock SET quantity = quantity - $1 WHERE center_id = $2 AND product_id = $3',
      [quantity, agent.center_id, product_id]
    );

    // 5. Insert sale record
    const saleQuery = `
      INSERT INTO sales (
        agent_id, center_id, product_id, quantity, 
        unit_price, total, customer_phone
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, agent_id, center_id, product_id, quantity, 
                unit_price, total, customer_phone, created_at;
    `;
    const saleRes = await client.query(saleQuery, [
      agent.id,
      agent.center_id,
      product_id,
      quantity,
      unit_price,
      total,
      customer_phone,
    ]);
    const createdSale = saleRes.rows[0];

    // 6. Record inventory deduction in stock_movements ledger
    await client.query(`
      INSERT INTO stock_movements (
        center_id, product_id, change_quantity, balance_after,
        movement_type, reference_type, reference_id, performed_by, notes
      )
      VALUES ($1, $2, $3, $4, 'sale', 'sale', $5, $6, $7)
    `, [
      agent.center_id,
      product_id,
      -quantity,
      currentStock - quantity,
      createdSale.id,
      agent.id,
      `Sale #${createdSale.id} by Agent #${agent.id}`,
    ]);

    // 7. Calculate direct agent commission (fixed rate per unit sold)
    const ratePerUnit = Number(agent.commission_rate) > 0
      ? Number(agent.commission_rate)
      : Number(product.commission_per_unit || 50.00);

    const directCommissionAmount = Number((ratePerUnit * quantity).toFixed(2));

    const directCommRes = await client.query(`
      INSERT INTO commissions (sale_id, earner_id, type, amount, status)
      VALUES ($1, $2, 'direct', $3, 'payable')
      RETURNING id, sale_id, earner_id, type, amount, status, created_at;
    `, [createdSale.id, agent.id, directCommissionAmount]);

    const generatedCommissions = [directCommRes.rows[0]];

    // 8. Calculate 1-level recruiter override bonus (if agent has an active recruiter)
    if (agent.recruiter_id && agent.recruiter_id !== agent.id) {
      const recruiterRes = await client.query(
        'SELECT id, is_active FROM users WHERE id = $1',
        [agent.recruiter_id]
      );

      if (recruiterRes.rows.length > 0 && recruiterRes.rows[0].is_active) {
        const recruiter = recruiterRes.rows[0];
        const overrideAmount = Number((total * RECRUITER_OVERRIDE_PERCENTAGE).toFixed(2));

        if (overrideAmount > 0) {
          const overrideCommRes = await client.query(`
            INSERT INTO commissions (sale_id, earner_id, type, amount, status)
            VALUES ($1, $2, 'override', $3, 'payable')
            RETURNING id, sale_id, earner_id, type, amount, status, created_at;
          `, [createdSale.id, recruiter.id, overrideAmount]);

          generatedCommissions.push(overrideCommRes.rows[0]);
        }
      }
    }

    await client.query('COMMIT');

    return {
      sale: {
        ...createdSale,
        product_name: product.name,
      },
      commissions: generatedCommissions,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function listSales({ user, agentId = null, centerId = null, productId = null, limit = 50, offset = 0 } = {}) {
  const { role, id: userId, center_id: userCenterId } = user;

  const conditions = [];
  const values = [];

  if (role === 'agent') {
    values.push(userId);
    conditions.push(`s.agent_id = $${values.length}`);
  } else if (role === 'center') {
    values.push(userCenterId);
    conditions.push(`s.center_id = $${values.length}`);
  } else if (['admin', 'manager'].includes(role)) {
    if (agentId) {
      values.push(Number(agentId));
      conditions.push(`s.agent_id = $${values.length}`);
    }
    if (centerId) {
      values.push(Number(centerId));
      conditions.push(`s.center_id = $${values.length}`);
    }
  }

  if (productId) {
    values.push(Number(productId));
    conditions.push(`s.product_id = $${values.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  values.push(limit, offset);
  const query = `
    SELECT s.id, s.agent_id, s.center_id, s.product_id, s.quantity,
           s.unit_price, s.total, s.customer_phone, s.created_at,
           u.full_name AS agent_name,
           c.name AS center_name,
           p.name AS product_name
    FROM sales s
    JOIN users u ON u.id = s.agent_id
    LEFT JOIN centers c ON c.id = s.center_id
    JOIN products p ON p.id = s.product_id
    ${whereClause}
    ORDER BY s.id DESC
    LIMIT $${values.length - 1} OFFSET $${values.length};
  `;

  const result = await pool.query(query, values);
  return result.rows;
}

async function listCommissions({ user, status = null, type = null, limit = 50, offset = 0 } = {}) {
  const { role, id: userId } = user;

  const conditions = [];
  const values = [];

  if (role === 'agent') {
    values.push(userId);
    conditions.push(`c.earner_id = $${values.length}`);
  } else if (!['admin', 'manager'].includes(role)) {
    // Other roles don't have commission visibility
    return [];
  }

  if (status) {
    values.push(status);
    conditions.push(`c.status = $${values.length}`);
  }

  if (type) {
    values.push(type);
    conditions.push(`c.type = $${values.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  values.push(limit, offset);
  const query = `
    SELECT c.id, c.sale_id, c.earner_id, c.type, c.amount, c.status, 
           c.payout_item_id, c.created_at, c.updated_at,
           u.full_name AS earner_name, u.phone_number AS earner_phone,
           s.total AS sale_total, p.name AS product_name
    FROM commissions c
    JOIN users u ON u.id = c.earner_id
    JOIN sales s ON s.id = c.sale_id
    JOIN products p ON p.id = s.product_id
    ${whereClause}
    ORDER BY c.id DESC
    LIMIT $${values.length - 1} OFFSET $${values.length};
  `;

  const result = await pool.query(query, values);
  return result.rows;
}

module.exports = {
  recordSale,
  listSales,
  listCommissions,
};

