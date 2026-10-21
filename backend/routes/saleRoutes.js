/**
 * Soya Ventures - Sales Routes
 * Mounted at /api/sales
 */

const express = require('express');
const { recordSale, getSales } = require('../controllers/saleController');
const { validateRecordSale } = require('../validation/saleValidation');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

const router = express.Router();

router.use(authenticateToken);

// Record a sale (Agent only)
router.post('/', requireRole('agent'), validateRecordSale, recordSale);

// List sales (Scoped by role: Agent sees own, Center sees hub, Admin/Manager sees all)
router.get('/', getSales);

module.exports = router;

