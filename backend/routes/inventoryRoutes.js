/**
 * Soya Ventures - Inventory & Stock Routes
 * Mounted at /api/inventory
 */

const express = require('express');
const {
  getCenterStock,
  getStockItem,
  restock,
} = require('../controllers/inventoryController');
const { validateRestock } = require('../validation/centerValidation');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

const router = express.Router();

router.use(authenticateToken);

// View center stock (Scoped by user role & center assignment)
router.get('/', getCenterStock);
router.get('/center/:centerId', getCenterStock);
router.get('/center/:centerId/product/:productId', getStockItem);

// Restock center inventory (Admin & Manager only)
router.post('/restock', requireRole('admin', 'manager'), validateRestock, restock);

module.exports = router;

