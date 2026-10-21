/**
 * Soya Ventures - Product Routes
 * Mounted at /api/products
 */

const express = require('express');
const {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deactivateProduct,
} = require('../controllers/productController');
const {
  validateCreateProduct,
  validateUpdateProduct,
} = require('../validation/productValidation');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

const router = express.Router();

// Optional auth for reading products (allows both guests and authenticated users)
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authenticateToken(req, res, next);
  }
  next();
}

// Public / Authenticated read routes
router.get('/', optionalAuth, getProducts);
router.get('/:id', optionalAuth, getProductById);

// Admin-only management routes
router.post('/', authenticateToken, requireRole('admin'), validateCreateProduct, createProduct);
router.put('/:id', authenticateToken, requireRole('admin'), validateUpdateProduct, updateProduct);
router.delete('/:id', authenticateToken, requireRole('admin'), deactivateProduct);

module.exports = router;

