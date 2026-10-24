/**
 * Soya Ventures - Payout Routes
 * Mounted at /api/payouts
 */

const express = require('express');
const {
  createBatch,
  listBatches,
  getBatchById,
  processBatch,
  handleResultCallback,
  handleTimeoutCallback,
  reconcileItem,
} = require('../controllers/payoutController');
const {
  validateCreateBatch,
  validateProcessBatch,
  validateReconciliation,
} = require('../validation/payoutValidation');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

const router = express.Router();

// 1. Public Daraja Callback Webhooks (Received from Safaricom)
router.post('/b2c/result', handleResultCallback);
router.post('/b2c/timeout', handleTimeoutCallback);

// 2. Protected Manager/Admin Endpoints
router.use(authenticateToken);
router.use(requireRole('manager', 'admin'));

// Create a payout batch from eligible commissions
router.post('/batches', validateCreateBatch, createBatch);

// List payout batches
router.get('/batches', listBatches);

// Retrieve batch details and line items
router.get('/batches/:id', getBatchById);

// Submit and process batch (with dry-run support via ?dry_run=true)
router.post('/batches/:id/process', validateProcessBatch, processBatch);

// Reconcile a missing or timed-out payout item
router.post('/items/:id/reconcile', validateReconciliation, reconcileItem);

module.exports = router;
