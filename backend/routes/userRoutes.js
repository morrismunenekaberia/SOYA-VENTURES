/**
 * Soya Ventures - Administrative User Management Routes
 * Mounted at /api/users
 */

const express = require('express');
const { getUsers, getUserById } = require('../controllers/userController');
const { createUser } = require('../controllers/authController');
const { validateCreateUser } = require('../validation/authValidation');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

const router = express.Router();

// All user management routes require valid authentication
router.use(authenticateToken);

// List users (Admin & Manager access)
router.get('/', requireRole('admin', 'manager'), getUsers);

// Create privileged user account (Admin only)
router.post('/', requireRole('admin'), validateCreateUser, createUser);

// View user details by ID (Admin & Manager access)
router.get('/:id', requireRole('admin', 'manager'), getUserById);

module.exports = router;

