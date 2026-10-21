/**
 * Soya Ventures - Product Repository
 */

const { pool } = require('../config/db');

async function listProducts({ includeInactive = false } = {}) {
  const query = `
    SELECT id, sku, name, price, commission_per_unit, is_active, created_at, updated_at
    FROM products
    WHERE ($1::boolean = true OR is_active = true)
    ORDER BY id ASC;
  `;
  const result = await pool.query(query, [includeInactive]);
  return result.rows;
}

async function findById(id) {
  const query = `
    SELECT id, sku, name, price, commission_per_unit, is_active, created_at, updated_at
    FROM products
    WHERE id = $1
    LIMIT 1;
  `;
  const result = await pool.query(query, [id]);
  return result.rows[0] || null;
}

async function findBySku(sku) {
  if (!sku) return null;
  const query = `
    SELECT id, sku, name, price, commission_per_unit, is_active, created_at, updated_at
    FROM products
    WHERE LOWER(sku) = LOWER($1)
    LIMIT 1;
  `;
  const result = await pool.query(query, [sku]);
  return result.rows[0] || null;
}

async function create({ name, price, sku = null, commission_per_unit = 50.00 }) {
  const query = `
    INSERT INTO products (name, price, sku, commission_per_unit)
    VALUES ($1, $2, $3, $4)
    RETURNING id, sku, name, price, commission_per_unit, is_active, created_at, updated_at;
  `;
  const values = [name, price, sku || null, commission_per_unit];
  const result = await pool.query(query, values);
  return result.rows[0];
}

async function update(id, fields) {
  const updates = [];
  const values = [];

  if (fields.name !== undefined) {
    values.push(fields.name);
    updates.push(`name = $${values.length}`);
  }
  if (fields.price !== undefined) {
    values.push(fields.price);
    updates.push(`price = $${values.length}`);
  }
  if (fields.sku !== undefined) {
    values.push(fields.sku);
    updates.push(`sku = $${values.length}`);
  }
  if (fields.commission_per_unit !== undefined) {
    values.push(fields.commission_per_unit);
    updates.push(`commission_per_unit = $${values.length}`);
  }
  if (fields.is_active !== undefined) {
    values.push(fields.is_active);
    updates.push(`is_active = $${values.length}`);
  }

  if (updates.length === 0) {
    return findById(id);
  }

  updates.push('updated_at = NOW()');
  values.push(id);

  const query = `
    UPDATE products
    SET ${updates.join(', ')}
    WHERE id = $${values.length}
    RETURNING id, sku, name, price, commission_per_unit, is_active, created_at, updated_at;
  `;

  const result = await pool.query(query, values);
  return result.rows[0] || null;
}

async function deactivate(id) {
  const query = `
    UPDATE products
    SET is_active = FALSE, updated_at = NOW()
    WHERE id = $1
    RETURNING id, sku, name, price, commission_per_unit, is_active, created_at, updated_at;
  `;
  const result = await pool.query(query, [id]);
  return result.rows[0] || null;
}

module.exports = {
  listProducts,
  findById,
  findBySku,
  create,
  update,
  deactivate,
};

