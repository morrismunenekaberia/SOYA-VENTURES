/**
 * Soya Ventures - Center Repository
 */

const { pool } = require('../config/db');

async function listCenters({ includeInactive = false } = {}) {
  const query = `
    SELECT id, name, location, contact_phone, is_active, created_at, updated_at
    FROM centers
    WHERE ($1::boolean = true OR is_active = true)
    ORDER BY id ASC;
  `;
  const result = await pool.query(query, [includeInactive]);
  return result.rows;
}

async function findById(id) {
  const query = `
    SELECT id, name, location, contact_phone, is_active, created_at, updated_at
    FROM centers
    WHERE id = $1
    LIMIT 1;
  `;
  const result = await pool.query(query, [id]);
  return result.rows[0] || null;
}

async function create({ name, location = null, contact_phone = null }) {
  const query = `
    INSERT INTO centers (name, location, contact_phone)
    VALUES ($1, $2, $3)
    RETURNING id, name, location, contact_phone, is_active, created_at, updated_at;
  `;
  const result = await pool.query(query, [name, location, contact_phone]);
  return result.rows[0];
}

async function update(id, fields) {
  const updates = [];
  const values = [];

  if (fields.name !== undefined) {
    values.push(fields.name);
    updates.push(`name = $${values.length}`);
  }
  if (fields.location !== undefined) {
    values.push(fields.location);
    updates.push(`location = $${values.length}`);
  }
  if (fields.contact_phone !== undefined) {
    values.push(fields.contact_phone);
    updates.push(`contact_phone = $${values.length}`);
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
    UPDATE centers
    SET ${updates.join(', ')}
    WHERE id = $${values.length}
    RETURNING id, name, location, contact_phone, is_active, created_at, updated_at;
  `;

  const result = await pool.query(query, values);
  return result.rows[0] || null;
}

async function deactivate(id) {
  const query = `
    UPDATE centers
    SET is_active = FALSE, updated_at = NOW()
    WHERE id = $1
    RETURNING id, name, location, contact_phone, is_active, created_at, updated_at;
  `;
  const result = await pool.query(query, [id]);
  return result.rows[0] || null;
}

module.exports = {
  listCenters,
  findById,
  create,
  update,
  deactivate,
};

