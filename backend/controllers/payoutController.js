/**
 * Soya Ventures - Payout Controller
 */

const payoutRepository = require('../repositories/payoutRepository');
const payoutService = require('../services/payoutService');
const { AppError } = require('../middleware/errorHandler');

async function createBatch(req, res, next) {
  try {
    const { commission_ids, notes } = req.body;

    const result = await payoutRepository.createBatchFromCommissions({
      managerId: req.user.id,
      commissionIds: commission_ids,
      notes,
    });

    res.status(201).json({
      success: true,
      message: 'Payout batch created and commissions queued successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

async function listBatches(req, res, next) {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const status = req.query.status || null;

    const batches = await payoutRepository.listBatches({ limit, offset, status });
    res.status(200).json({
      success: true,
      data: {
        batches,
        count: batches.length,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function getBatchById(req, res, next) {
  try {
    const id = Number(req.params.id);
    const batch = await payoutRepository.getBatchById(id);

    if (!batch) {
      return next(new AppError('Payout batch not found.', 404, 'BATCH_NOT_FOUND'));
    }

    res.status(200).json({
      success: true,
      data: {
        batch,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function processBatch(req, res, next) {
  try {
    const batchId = Number(req.params.id);
    const { dryRun, concurrency } = req.payoutOptions;

    const result = await payoutService.processBatch({
      batchId,
      manager: req.user,
      dryRun,
      concurrency,
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

async function handleResultCallback(req, res, next) {
  try {
    const callbackToken = req.headers['x-callback-token'] || req.query.token || null;
    const result = await payoutService.processCallback(req.body, callbackToken);

    // Always acknowledge Safaricom with 200 HTTP response
    res.status(200).json({
      ResultCode: 0,
      ResultDesc: 'Callback received and acknowledged.',
      meta: result,
    });
  } catch (err) {
    // If invalid token, return 401; otherwise return 200 to acknowledge Safaricom
    if (err.statusCode === 401) {
      return next(err);
    }
    console.error('Error handling Daraja result callback:', err.message);
    res.status(200).json({
      ResultCode: 1,
      ResultDesc: 'Callback accepted with internal warning',
    });
  }
}

async function handleTimeoutCallback(req, res, next) {
  console.warn('Daraja QueueTimeOut callback received:', req.body);
  res.status(200).json({
    ResultCode: 0,
    ResultDesc: 'Queue timeout acknowledged.',
  });
}

async function reconcileItem(req, res, next) {
  try {
    const itemId = Number(req.params.id);
    const { action, transaction_id, notes } = req.body;

    const reconciled = await payoutService.reconcilePayoutItem({
      itemId,
      manager: req.user,
      action,
      transactionId: transaction_id,
      notes,
    });

    res.status(200).json({
      success: true,
      message: `Payout item #${itemId} reconciled successfully as ${reconciled.status}`,
      data: {
        item: reconciled,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createBatch,
  listBatches,
  getBatchById,
  processBatch,
  handleResultCallback,
  handleTimeoutCallback,
  reconcileItem,
};
