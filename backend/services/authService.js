/**
 * Soya Ventures - Authentication & User Management Service
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const userRepository = require('../repositories/userRepository');
const { AppError } = require('../middleware/errorHandler');
const { pool } = require('../config/db');

const BCRYPT_SALT_ROUNDS = 10;

async function hashPassword(plainTextPassword) {
  return bcrypt.hash(plainTextPassword, BCRYPT_SALT_ROUNDS);
}

async function verifyPassword(plainTextPassword, passwordHash) {
  return bcrypt.compare(plainTextPassword, passwordHash);
}

function generateToken(user) {
  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    centerId: user.center_id || null,
  };

  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });
}

/**
 * Public registration service:
 * STRICTLY restricted to the 'agent' role.
 */
async function registerAgent({
  full_name,
  email,
  password,
  phone_number,
  recruiter_id = null,
}) {
  // Check email uniqueness
  const existingEmail = await userRepository.findByEmail(email);
  if (existingEmail) {
    throw new AppError('An account with this email address already exists.', 409, 'DUPLICATE_EMAIL');
  }

  // Check phone uniqueness
  const existingPhone = await userRepository.findByPhone(phone_number);
  if (existingPhone) {
    throw new AppError('An account with this phone number already exists.', 409, 'DUPLICATE_PHONE');
  }

  // Validate recruiter if provided
  if (recruiter_id) {
    const recruiter = await userRepository.findById(recruiter_id);
    if (!recruiter) {
      throw new AppError('The specified recruiter does not exist.', 400, 'INVALID_RECRUITER');
    }
    if (!recruiter.is_active) {
      throw new AppError('The specified recruiter account is inactive.', 400, 'INACTIVE_RECRUITER');
    }
  }

  const password_hash = await hashPassword(password);

  // Force role to 'agent' regardless of any external input
  const newUser = await userRepository.create({
    full_name,
    email,
    password_hash,
    phone_number,
    role: 'agent',
    recruiter_id: recruiter_id || null,
    commission_rate: 0,
  });

  const token = generateToken(newUser);

  return {
    user: newUser,
    token,
  };
}

/**
 * User login service
 */
async function login({ email, password }) {
  const user = await userRepository.findByEmail(email);
  if (!user) {
    throw new AppError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
  }

  if (!user.is_active) {
    throw new AppError('This account has been deactivated. Please contact support.', 403, 'ACCOUNT_DEACTIVATED');
  }

  const isValidPassword = await verifyPassword(password, user.password_hash);
  if (!isValidPassword) {
    throw new AppError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
  }

  // Clean user object before returning
  const { password_hash, ...safeUser } = user;
  const token = generateToken(safeUser);

  return {
    user: safeUser,
    token,
  };
}

/**
 * Protected administrative user creation (admin only)
 */
async function createUserByAdmin({
  full_name,
  email,
  password,
  phone_number,
  role,
  center_id = null,
  commission_rate = 0,
}) {
  const existingEmail = await userRepository.findByEmail(email);
  if (existingEmail) {
    throw new AppError('An account with this email address already exists.', 409, 'DUPLICATE_EMAIL');
  }

  const existingPhone = await userRepository.findByPhone(phone_number);
  if (existingPhone) {
    throw new AppError('An account with this phone number already exists.', 409, 'DUPLICATE_PHONE');
  }

  if (center_id) {
    const centerRes = await pool.query('SELECT id, is_active FROM centers WHERE id = $1', [center_id]);
    if (centerRes.rows.length === 0) {
      throw new AppError('The specified center hub does not exist.', 400, 'INVALID_CENTER');
    }
    if (!centerRes.rows[0].is_active) {
      throw new AppError('The specified center hub is inactive.', 400, 'INACTIVE_CENTER');
    }
  }

  const password_hash = await hashPassword(password);

  const newUser = await userRepository.create({
    full_name,
    email,
    password_hash,
    phone_number,
    role,
    center_id: center_id || null,
    commission_rate: commission_rate || 0,
  });

  return newUser;
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateToken,
  registerAgent,
  login,
  createUserByAdmin,
};

