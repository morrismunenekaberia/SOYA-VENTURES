/**
 * Soya Ventures - Payout Validation Middleware
 */

const { AppError } = require('../middleware/errorHandler');

function validateCreateBatch(req, res, next) {
  const { commission_ids, notes } = req.body || {};

  if (!commission_ids || !Array.isArray(commission_ids) || commission_ids.length === 0) {
    return next(new AppError('commission_ids must be a non-empty array of integer IDs.', 400, 'INVALID_COMMISSION_IDS'));
  }

  const parsedIds = [];
  for (const id of commission_ids) {
    const num = Number(id);
    if (isNaN(num) || num <= 0 || !Number.isInteger(num)) {
      return next(new AppError('All commission_ids must be positive integers.', 400, 'INVALID_COMMISSION_ID'));
    }
    parsedIds.push(num);
  }

  req.body.commission_ids = parsedIds;
  req.body.notes = notes ? String(notes).trim() : null;

  next();
}

function validateProcessBatch(req, res, next) {
  const body = req.body || {};
  const dryRun = req.query.dry_run === 'true' || body.dry_run === true;
  let concurrency = Number(req.query.concurrency || body.concurrency) || 2;

  if (concurrency < 1 || concurrency > 5) {
    concurrency = 2;
  }

  req.payoutOptions = {
    dryRun,
    concurrency,
  };

  next();
}

function validateReconciliation(req, res, next) {
  const { action, transaction_id, notes } = req.body || {};

  if (!action || !['mark_success', 'mark_failed'].includes(action)) {
    return next(new AppError("action must be 'mark_success' or 'mark_failed'.", 400, 'INVALID_ACTION'));
  }

  if (action === 'mark_success' && (!transaction_id || typeof transaction_id !== 'string' || transaction_id.trim().length === 0)) {
    return next(new AppError('transaction_id (M-Pesa receipt) is required to reconcile an item as success.', 400, 'MISSING_TRANSACTION_ID'));
  }

  req.body.action = action;
  req.body.transaction_id = transaction_id ? String(transaction_id).trim() : null;
  req.body.notes = notes ? String(notes).trim() : null;

  next();
}

module.exports = {
  validateCreateBatch,
  validateProcessBatch,
  validateReconciliation,
};
