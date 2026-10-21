/**
 * Soya Ventures - User Repository
 * 
 * Provides safe, parameterized SQL queries for user persistence.
 */

const { pool } = require('../config/db');

async function findByEmail(email) {
  const query = `
    SELECT id, full_name, email, phone_number, password_hash, role, 
           center_id, recruiter_id, commission_rate, is_active, created_at, updated_at
    FROM users
    WHERE email = $1
    LIMIT 1;
  `;
  const result = await pool.query(query, [email]);
  return result.rows[0] || null;
}

async function findByPhone(phone) {
  const query = `
    SELECT id, full_name, email, phone_number, password_hash, role, 
           center_id, recruiter_id, commission_rate, is_active, created_at, updated_at
    FROM users
    WHERE phone_number = $1
    LIMIT 1;
  `;
  const result = await pool.query(query, [phone]);
  return result.rows[0] || null;
}

async function findById(id) {
  const query = `
    SELECT id, full_name, email, phone_number, role, 
           center_id, recruiter_id, commission_rate, is_active, created_at, updated_at
    FROM users
    WHERE id = $1
    LIMIT 1;
  `;
  const result = await pool.query(query, [id]);
  return result.rows[0] || null;
}

async function create({
  full_name,
  email,
  password_hash,
  phone_number,
  role = 'agent',
  center_id = null,
  recruiter_id = null,
  commission_rate = 0,
}) {
  const query = `
    INSERT INTO users (
      full_name, email, password_hash, phone_number, role, 
      center_id, recruiter_id, commission_rate
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, full_name, email, phone_number, role, 
              center_id, recruiter_id, commission_rate, is_active, created_at;
  `;
  const values = [
    full_name,
    email,
    password_hash,
    phone_number,
    role,
    center_id,
    recruiter_id,
    commission_rate,
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
}

async function listUsers({ limit = 50, offset = 0, role = null } = {}) {
  let query = `
    SELECT id, full_name, email, phone_number, role, 
           center_id, recruiter_id, commission_rate, is_active, created_at
    FROM users
  `;
  const values = [];

  if (role) {
    values.push(role);
    query += ` WHERE role = $${values.length}`;
  }

  values.push(limit, offset);
  query += ` ORDER BY id DESC LIMIT $${values.length - 1} OFFSET $${values.length};`;

  const result = await pool.query(query, values);
  return result.rows;
}

module.exports = {
  findByEmail,
  findByPhone,
  findById,
  create,
  listUsers,
};

