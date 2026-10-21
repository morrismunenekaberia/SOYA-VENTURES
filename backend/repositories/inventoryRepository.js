/**
 * Soya Ventures - Inventory & Stock Repository
 */

const { pool } = require('../config/db');

async function getStockByCenter(centerId) {
  const query = `
    SELECT s.center_id, s.product_id, s.quantity,
           p.name AS product_name, p.price, p.sku, p.commission_per_unit, p.is_active AS product_is_active
    FROM stock s
    JOIN products p ON p.id = s.product_id
    WHERE s.center_id = $1
    ORDER BY p.id ASC;
  `;
  const result = await pool.query(query, [centerId]);
  return result.rows;
}

async function getStockItem(centerId, productId) {
  const query = `
    SELECT s.center_id, s.product_id, s.quantity,
           p.name AS product_name, p.price, p.commission_per_unit
    FROM stock s
    JOIN products p ON p.id = s.product_id
    WHERE s.center_id = $1 AND s.product_id = $2
    LIMIT 1;
  `;
  const result = await pool.query(query, [centerId, productId]);
  return result.rows[0] || null;
}

async function restockCenter({ centerId, productId, quantity, performedBy, notes = null }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert stock record with atomic addition
    const stockQuery = `
      INSERT INTO stock (center_id, product_id, quantity)
      VALUES ($1, $2, $3)
      ON CONFLICT (center_id, product_id)
      DO UPDATE SET quantity = stock.quantity + EXCLUDED.quantity
      RETURNING center_id, product_id, quantity;
    `;
    const stockRes = await client.query(stockQuery, [centerId, productId, quantity]);
    const updatedStock = stockRes.rows[0];

    // Record movement in audit ledger
    const movementQuery = `
      INSERT INTO stock_movements (
        center_id, product_id, change_quantity, balance_after,
        movement_type, reference_type, performed_by, notes
      )
      VALUES ($1, $2, $3, $4, 'restock', 'manual', $5, $6)
      RETURNING id, created_at;
    `;
    const movementRes = await client.query(movementQuery, [
      centerId,
      productId,
      quantity,
      updatedStock.quantity,
      performedBy,
      notes || 'Manual administrative restock',
    ]);

    await client.query('COMMIT');

    return {
      stock: updatedStock,
      movement: movementRes.rows[0],
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  getStockByCenter,
  getStockItem,
  restockCenter,
};

