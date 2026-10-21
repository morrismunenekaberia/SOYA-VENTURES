/**
 * Soya Ventures - Center Routes
 * Mounted at /api/centers
 */

const express = require('express');
const {
  getCenters,
  getCenterById,
  createCenter,
  updateCenter,
  deactivateCenter,
} = require('../controllers/centerController');
const {
  validateCreateCenter,
  validateUpdateCenter,
} = require('../validation/centerValidation');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

const router = express.Router();

// Read centers (Authenticated)
router.get('/', authenticateToken, getCenters);
router.get('/:id', authenticateToken, getCenterById);

// Admin-only management
router.post('/', authenticateToken, requireRole('admin'), validateCreateCenter, createCenter);
router.put('/:id', authenticateToken, requireRole('admin'), validateUpdateCenter, updateCenter);
router.delete('/:id', authenticateToken, requireRole('admin'), deactivateCenter);

module.exports = router;

