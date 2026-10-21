/**
 * Soya Ventures - Commission Routes
 * Mounted at /api/commissions
 */

const express = require('express');
const { getCommissions } = require('../controllers/commissionController');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.use(authenticateToken);

// List commissions (Scoped by role: Agent sees own, Admin/Manager sees all)
router.get('/', getCommissions);

module.exports = router;

