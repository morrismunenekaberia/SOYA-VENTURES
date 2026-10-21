/**
 * Soya Ventures - Order Routes
 * Mounted at /api/orders
 */

const express = require('express');
const {
  createOrder,
  getOrders,
  getOrderById,
  updateOrderStatus,
} = require('../controllers/orderController');
const {
  validateCreateOrder,
  validateOrderStatusTransition,
} = require('../validation/orderValidation');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.use(authenticateToken);

// Place an order (Agent -> Center or Center -> Manager)
router.post('/', validateCreateOrder, createOrder);

// List orders (Scoped by role)
router.get('/', getOrders);

// View order details
router.get('/:id', getOrderById);

// Transition status (Approve, Reject, Fulfill, Cancel)
router.put('/:id/status', validateOrderStatusTransition, updateOrderStatus);

module.exports = router;

