/**
 * Soya Ventures - Payout Processing & Callback Service
 * 
 * Orchestrates payout batch creation, controlled concurrency dispatch,
 * callback state transitions, and reconciliation for missing callbacks.
 */

const payoutRepository = require('../repositories/payoutRepository');
const mpesaService = require('./mpesaService');
const config = require('../config/env');
const { AppError } = require('../middleware/errorHandler');
const { logger } = require('../config/logger');

/**
 * Submits an authorized payout batch to Safaricom Daraja B2C
 */
async function processBatch({ batchId, manager, dryRun = false, concurrency = 2 }) {
  const batch = await payoutRepository.getBatchById(batchId);
  if (!batch) {
    throw new AppError(`Payout batch #${batchId} not found.`, 404, 'BATCH_NOT_FOUND');
  }

  if (!['pending', 'processing'].includes(batch.status)) {
    throw new AppError(
      `Cannot process batch with status '${batch.status}'. Only pending or processing batches can be dispatched.`,
      400,
      'INVALID_BATCH_STATUS'
    );
  }

  const pendingItems = batch.items.filter((i) => i.status === 'pending');

  if (pendingItems.length === 0) {
    return {
      message: 'No pending items left to process in this batch.',
      batch_id: batch.id,
      item_count: 0,
    };
  }

  // Dry-run mode: validates batch without sending funds or calling external APIs
  if (dryRun) {
    logger.info('Dry run validation passed for payout batch', {
      batchId: batch.id,
      pendingItemsCount: pendingItems.length,
      totalAmount: batch.total_amount,
    });

    return {
      dry_run: true,
      valid: true,
      batch_id: batch.id,
      pending_items_count: pendingItems.length,
      total_amount: batch.total_amount,
      message: 'Batch dry run completed successfully. All recipients and amounts are valid.',
    };
  }

  const results = {
    dispatched: 0,
    rejected: 0,
    uncertain: 0,
  };

  logger.info('Starting live payout batch dispatch', {
    batchId: batch.id,
    itemCount: pendingItems.length,
    concurrency,
  });

  // Process items in controlled chunks to respect Daraja rate limits and connection pooling
  for (let i = 0; i < pendingItems.length; i += concurrency) {
    const chunk = pendingItems.slice(i, i + concurrency);

    await Promise.all(
      chunk.map(async (item) => {
        try {
          const res = await mpesaService.sendB2CPaymentRequest({
            phone: item.phone_number,
            amount: item.amount,
            remarks: 'Soya Commission Payout',
            payoutReference: item.payout_reference,
          });

          if (res.accepted) {
            // Daraja queued the request for processing
            await payoutRepository.updateItemWithDispatch({
              itemId: item.id,
              originatorConversationId: res.originatorConversationId,
              conversationId: res.conversationId,
            });
            results.dispatched++;
          } else {
            // Definite rejection by Daraja gateway
            await payoutRepository.updateItemWithResult({
              itemId: item.id,
              status: 'failed',
              resultCode: Number(res.errorCode) || 999,
              resultDesc: res.errorMessage || 'Rejected by M-Pesa gateway',
            });
            results.rejected++;
          }
        } catch (err) {
          // Network failure or gateway timeout is an UNCERTAIN outcome
          logger.warn(`Uncertain outcome for payout item #${item.id}: ${err.message}`, {
            itemId: item.id,
            batchId: batch.id,
            error: err.message,
          });

          results.uncertain++;
        }
      })
    );
  }

  return {
    batch_id: batch.id,
    ...results,
    message: `Batch #${batch.id} processed: ${results.dispatched} dispatched, ${results.rejected} rejected, ${results.uncertain} uncertain.`,
  };
}

/**
 * Handles Daraja B2C Callback Webhook
 */
async function processCallback(payload) {
  const result = payload?.Result;
  if (!result) {
    throw new AppError('Invalid Daraja callback structure: missing Result payload.', 400, 'MALFORMED_CALLBACK');
  }

  const {
    ConversationID,
    OriginatorConversationID,
    ResultCode,
    ResultDesc,
    TransactionID,
    ResultParameters,
  } = result;

  logger.info('Processing Daraja B2C webhook callback', {
    conversationId: ConversationID,
    resultCode: ResultCode,
    resultDesc: ResultDesc,
  });

  // Extract M-Pesa receipt number from ResultParameters if TransactionID not top-level
  let mpesaReceipt = TransactionID || null;
  if (!mpesaReceipt && ResultParameters?.ResultParameter) {
    const receiptParam = ResultParameters.ResultParameter.find(
      (p) => p.Key === 'TransactionReceipt' || p.Key === 'ReceiptNo'
    );
    if (receiptParam) {
      mpesaReceipt = receiptParam.Value;
    }
  }

  // Find corresponding payout item
  const item = await payoutRepository.findItemByConversationId(ConversationID, OriginatorConversationID);

  if (!item) {
    // Quarantine unmatched callback for audit inspection
    logger.warn('Quarantined unmatched M-Pesa callback', {
      ConversationID,
      OriginatorConversationID,
      ResultCode,
    });

    return {
      matched: false,
      message: 'Callback quarantined: No matching payout item found.',
    };
  }

  // Idempotency check: Ignore duplicate callback if already terminal
  if (['success', 'failed'].includes(item.status)) {
    logger.info('Duplicate callback ignored safely', {
      itemId: item.id,
      status: item.status,
      conversationId: ConversationID,
    });

    return {
      matched: true,
      item_id: item.id,
      status: item.status,
      message: 'Duplicate callback ignored safely.',
    };
  }

  const isSuccess = ResultCode === 0 || ResultCode === '0';
  const newStatus = isSuccess ? 'success' : 'failed';

  const updatedItem = await payoutRepository.updateItemWithResult({
    itemId: item.id,
    status: newStatus,
    resultCode: Number(ResultCode),
    resultDesc: ResultDesc || (isSuccess ? 'Transaction successful' : 'Transaction failed'),
    transactionId: mpesaReceipt,
    rawCallback: payload,
  });

  logger.info('Payout item updated from callback', {
    itemId: updatedItem.id,
    conversationId: ConversationID,
    status: updatedItem.status,
    transactionId: updatedItem.transaction_id,
  });

  return {
    matched: true,
    item_id: updatedItem.id,
    status: updatedItem.status,
    transaction_id: updatedItem.transaction_id,
  };
}

/**
 * Reconciliation for payouts with missing callbacks
 */
async function reconcilePayoutItem({ itemId, manager, transactionId = null, action, notes = null }) {
  const item = await payoutRepository.getPayoutItemById(itemId);
  if (!item) {
    throw new AppError(`Payout item #${itemId} not found.`, 404, 'ITEM_NOT_FOUND');
  }

  if (item.status === 'success') {
    throw new AppError('Payout item has already been reconciled as successful.', 400, 'ALREADY_COMPLETED');
  }

  if (!['mark_success', 'mark_failed'].includes(action)) {
    throw new AppError("action must be 'mark_success' or 'mark_failed'.", 400, 'INVALID_ACTION');
  }

  const newStatus = action === 'mark_success' ? 'success' : 'failed';

  if (newStatus === 'success' && !transactionId) {
    throw new AppError('M-Pesa transactionId (Receipt) is required to reconcile as success.', 400, 'MISSING_TRANSACTION_ID');
  }

  const updated = await payoutRepository.updateItemWithResult({
    itemId: item.id,
    status: newStatus,
    resultCode: newStatus === 'success' ? 0 : 999,
    resultDesc: notes || `Reconciled manually by Manager #${manager.id}`,
    transactionId: transactionId || item.transaction_id,
    rawCallback: {
      reconciled_by: manager.id,
      reconciled_at: new Date().toISOString(),
      action,
      notes,
    },
  });

  logger.info('Manager manually reconciled payout item', {
    itemId: updated.id,
    managerId: manager.id,
    action,
    newStatus,
    transactionId: updated.transaction_id,
  });

  return updated;
}

module.exports = {
  processBatch,
  processCallback,
  reconcilePayoutItem,
};
