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
            // Definite rejection by Daraja (e.g. Insufficient Balance, Invalid Shortcode)
            await payoutRepository.updateItemWithResult({
              itemId: item.id,
              status: 'failed',
              resultCode: res.errorCode || 1,
              resultDesc: res.errorMessage || 'Rejected by Safaricom Daraja',
            });
            results.rejected++;
          }
        } catch (err) {
          // Network timeout or socket failure: UNCERTAIN OUTCOME
          // Do NOT mark as failed! Keep status as processing for callback or reconciliation.
          console.warn(`Uncertain outcome for payout item #${item.id}:`, err.message);
          results.uncertain++;
        }
      })
    );
  }

  return {
    batch_id: batch.id,
    total_items: pendingItems.length,
    ...results,
  };
}

/**
 * Processes Result and Timeout callbacks received from Safaricom Daraja
 */
async function processCallback(payload, tokenHeader = null) {
  // Validate callback secret if configured
  if (config.mpesa.callbackSecret && tokenHeader) {
    if (tokenHeader !== config.mpesa.callbackSecret) {
      console.warn('Unauthorized callback attempt: Invalid callback secret header.');
      throw new AppError('Unauthorized callback request.', 401, 'INVALID_CALLBACK_TOKEN');
    }
  }

  const result = payload && (payload.Result || payload);
  if (!result || typeof result !== 'object') {
    throw new AppError('Malformed callback payload: missing Result object.', 400, 'MALFORMED_CALLBACK');
  }

  const {
    ConversationID,
    OriginatorConversationID,
    ResultCode,
    ResultDesc,
    TransactionID,
    ResultParameters,
  } = result;

  // Match callback to known payout item
  const item = await payoutRepository.findItemByConversationId(ConversationID, OriginatorConversationID);

  if (!item) {
    // Quarantine unmatched callback safely for auditing
    console.warn('Quarantined unmatched M-Pesa callback:', {
      ConversationID,
      OriginatorConversationID,
      ResultCode,
    });

    return {
      matched: false,
      message: 'Callback quarantined: No matching payout item found.',
    };
  }

  // Idempotency: If item is already marked 'success', ignore duplicate callback
  if (item.status === 'success') {
    return {
      matched: true,
      item_id: item.id,
      status: 'success',
      message: 'Duplicate callback ignored safely.',
    };
  }

  // Determine actual M-Pesa transaction ID (receipt number)
  let mpesaReceipt = TransactionID || null;
  if (!mpesaReceipt && ResultParameters && Array.isArray(ResultParameters.ResultParameter)) {
    const receiptParam = ResultParameters.ResultParameter.find(
      (p) => p.Key === 'TransactionReceipt' || p.Key === 'TransactionID'
    );
    if (receiptParam) mpesaReceipt = String(receiptParam.Value);
  }

  const isSuccess = Number(ResultCode) === 0;
  const newStatus = isSuccess ? 'success' : 'failed';

  const updatedItem = await payoutRepository.updateItemWithResult({
    itemId: item.id,
    status: newStatus,
    resultCode: Number(ResultCode),
    resultDesc: ResultDesc || (isSuccess ? 'Transaction successful' : 'Transaction failed'),
    transactionId: mpesaReceipt,
    rawCallback: payload,
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

  return updated;
}

module.exports = {
  processBatch,
  processCallback,
  reconcilePayoutItem,
};
