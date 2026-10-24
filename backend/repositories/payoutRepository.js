/**
 * Soya Ventures - Payout Ledger Repository
 * 
 * Manages payout batches, individual payout items, and transactional status synchronization.
 */

const crypto = require('crypto');
const { pool } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');
const { logger, maskPhone } = require('../config/logger');

function generateReference(prefix = 'PAY') {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
}

async function createBatchFromCommissions({ managerId, commissionIds, notes = null }) {
  if (!commissionIds || !Array.isArray(commissionIds) || commissionIds.length === 0) {
    throw new AppError('At least one commission ID must be selected for payout.', 400, 'EMPTY_COMMISSION_LIST');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock and validate selected commissions
    const commQuery = `
      SELECT c.id, c.earner_id, c.amount, c.status, c.payout_item_id,
             u.phone_number, u.full_name, u.is_active
      FROM commissions c
      JOIN users u ON u.id = c.earner_id
      WHERE c.id = ANY($1::int[])
      FOR UPDATE;
    `;
    const commRes = await client.query(commQuery, [commissionIds]);

    if (commRes.rows.length !== commissionIds.length) {
      throw new AppError('One or more selected commissions could not be found.', 404, 'COMMISSION_NOT_FOUND');
    }

    let totalAmount = 0;
    const validatedCommissions = [];

    for (const comm of commRes.rows) {
      // Validate payable status
      if (comm.status !== 'payable' || comm.payout_item_id !== null) {
        throw new AppError(
          `Commission #${comm.id} is not eligible for payout (Current status: '${comm.status}').`,
          400,
          'INELIGIBLE_COMMISSION'
        );
      }

      // Validate recipient account status
      if (!comm.is_active) {
        throw new AppError(
          `Recipient '${comm.full_name}' for commission #${comm.id} has an inactive account.`,
          400,
          'INACTIVE_RECIPIENT'
        );
      }

      // Validate recipient phone number format (2547... or 2541...)
      if (!comm.phone_number || !/^254[17]\d{8}$/.test(comm.phone_number)) {
        throw new AppError(
          `Recipient '${comm.full_name}' has an invalid or missing Safaricom phone number: ${comm.phone_number || 'none'}.`,
          400,
          'INVALID_RECIPIENT_PHONE'
        );
      }

      const amount = Number(comm.amount);
      if (isNaN(amount) || amount <= 0) {
        throw new AppError(`Invalid payout amount for commission #${comm.id}: ${comm.amount}`, 400, 'INVALID_AMOUNT');
      }

      totalAmount += amount;
      validatedCommissions.push(comm);
    }

    // 2. Create payout_batches record
    const batchReference = generateReference('BATCH');
    const batchQuery = `
      INSERT INTO payout_batches (
        batch_reference, initiating_manager_id, status,
        total_amount, item_count, currency, notes
      )
      VALUES ($1, $2, 'pending', $3, $4, 'KES', $5)
      RETURNING id, batch_reference, initiating_manager_id, status,
                total_amount, item_count, currency, notes, created_at, updated_at;
    `;
    const batchRes = await client.query(batchQuery, [
      batchReference,
      managerId,
      Number(totalAmount.toFixed(2)),
      validatedCommissions.length,
      notes,
    ]);
    const createdBatch = batchRes.rows[0];

    // 3. Create individual payout_items and update commissions
    const items = [];
    for (const comm of validatedCommissions) {
      const payoutReference = generateReference('PAY');
      const itemQuery = `
        INSERT INTO payout_items (
          batch_id, recipient_id, phone_number, commission_id,
          amount, currency, payout_reference, status
        )
        VALUES ($1, $2, $3, $4, $5, 'KES', $6, 'pending')
        RETURNING id, batch_id, recipient_id, phone_number, commission_id,
                  amount, currency, payout_reference, status, created_at;
      `;
      const itemRes = await client.query(itemQuery, [
        createdBatch.id,
        comm.earner_id,
        comm.phone_number,
        comm.id,
        comm.amount,
        payoutReference,
      ]);
      const createdItem = itemRes.rows[0];

      // Update commission status to processing and link payout_item_id
      await client.query(`
        UPDATE commissions
        SET status = 'processing', payout_item_id = $1, updated_at = NOW()
        WHERE id = $2;
      `, [createdItem.id, comm.id]);

      items.push({
        ...createdItem,
        recipient_name: comm.full_name,
      });
    }

    await client.query('COMMIT');

    logger.info('Payout batch created', {
      batchId: createdBatch.id,
      batchReference: createdBatch.batch_reference,
      managerId,
      itemCount: items.length,
      totalAmount: createdBatch.total_amount,
    });

    return {
      batch: createdBatch,
      items,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getBatchById(batchId) {
  const batchQuery = `
    SELECT b.id, b.batch_reference, b.initiating_manager_id, b.status,
           b.total_amount, b.item_count, b.currency, b.notes,
           b.created_at, b.updated_at, b.completed_at,
           u.full_name AS manager_name, u.email AS manager_email
    FROM payout_batches b
    JOIN users u ON u.id = b.initiating_manager_id
    WHERE b.id = $1
    LIMIT 1;
  `;
  const batchRes = await pool.query(batchQuery, [batchId]);
  if (batchRes.rows.length === 0) return null;

  const batch = batchRes.rows[0];

  const itemsQuery = `
    SELECT pi.id, pi.batch_id, pi.recipient_id, pi.phone_number, pi.commission_id,
           pi.amount, pi.currency, pi.payout_reference, pi.originator_conversation_id,
           pi.conversation_id, pi.transaction_id, pi.status, pi.result_code,
           pi.result_desc, pi.created_at, pi.updated_at, pi.processed_at,
           u.full_name AS recipient_name
    FROM payout_items pi
    JOIN users u ON u.id = pi.recipient_id
    WHERE pi.batch_id = $1
    ORDER BY pi.id ASC;
  `;
  const itemsRes = await pool.query(itemsQuery, [batchId]);
  batch.items = itemsRes.rows;

  return batch;
}

async function listBatches({ limit = 50, offset = 0, status = null } = {}) {
  let filter = '';
  const values = [];

  if (status) {
    values.push(status);
    filter = `WHERE b.status = $${values.length}`;
  }

  values.push(limit, offset);
  const query = `
    SELECT b.id, b.batch_reference, b.initiating_manager_id, b.status,
           b.total_amount, b.item_count, b.currency, b.notes,
           b.created_at, b.updated_at, b.completed_at,
           u.full_name AS manager_name
    FROM payout_batches b
    JOIN users u ON u.id = b.initiating_manager_id
    ${filter}
    ORDER BY b.id DESC
    LIMIT $${values.length - 1} OFFSET $${values.length};
  `;
  const result = await pool.query(query, values);
  return result.rows;
}

async function getPayoutItemById(itemId) {
  const query = `
    SELECT pi.id, pi.batch_id, pi.recipient_id, pi.phone_number, pi.commission_id,
           pi.amount, pi.currency, pi.payout_reference, pi.originator_conversation_id,
           pi.conversation_id, pi.transaction_id, pi.status, pi.result_code,
           pi.result_desc, pi.raw_callback, pi.created_at, pi.updated_at, pi.processed_at,
           u.full_name AS recipient_name
    FROM payout_items pi
    JOIN users u ON u.id = pi.recipient_id
    WHERE pi.id = $1
    LIMIT 1;
  `;
  const res = await pool.query(query, [itemId]);
  return res.rows[0] || null;
}

async function findItemByConversationId(conversationId, originatorConversationId) {
  const query = `
    SELECT pi.*
    FROM payout_items pi
    WHERE (pi.conversation_id = $1 AND $1 IS NOT NULL)
       OR (pi.originator_conversation_id = $2 AND $2 IS NOT NULL)
    LIMIT 1;
  `;
  const res = await pool.query(query, [conversationId, originatorConversationId]);
  return res.rows[0] || null;
}

async function updateItemWithDispatch({ itemId, originatorConversationId, conversationId }) {
  const query = `
    UPDATE payout_items
    SET originator_conversation_id = $1,
        conversation_id = $2,
        status = 'processing',
        updated_at = NOW()
    WHERE id = $3
    RETURNING *;
  `;
  const res = await pool.query(query, [originatorConversationId, conversationId, itemId]);
  const item = res.rows[0] || null;

  if (item) {
    logger.info('Payout item marked processing (dispatched)', {
      itemId,
      conversationId,
      originatorConversationId,
    });
  }

  return item;
}

async function updateItemWithResult({
  itemId,
  status, // 'success' or 'failed'
  resultCode,
  resultDesc,
  transactionId = null,
  rawCallback = null,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock item row for update
    const lockRes = await client.query(
      'SELECT * FROM payout_items WHERE id = $1 FOR UPDATE;',
      [itemId]
    );
    if (lockRes.rows.length === 0) {
      throw new AppError(`Payout item #${itemId} not found.`, 404, 'ITEM_NOT_FOUND');
    }

    const item = lockRes.rows[0];

    // Idempotency check: If already in a terminal state, return existing record
    if (item.status === 'success') {
      await client.query('COMMIT');
      return item;
    }

    // Update payout item
    const updateQuery = `
      UPDATE payout_items
      SET status = $1,
          result_code = $2,
          result_desc = $3,
          transaction_id = COALESCE($4, transaction_id),
          raw_callback = $5,
          processed_at = NOW(),
          updated_at = NOW()
      WHERE id = $6
      RETURNING *;
    `;
    const updateRes = await client.query(updateQuery, [
      status,
      resultCode,
      resultDesc,
      transactionId,
      rawCallback ? JSON.stringify(rawCallback) : null,
      itemId,
    ]);
    const updatedItem = updateRes.rows[0];

    // Synchronize commission status
    if (item.commission_id) {
      if (status === 'success') {
        await client.query(`
          UPDATE commissions
          SET status = 'paid', updated_at = NOW()
          WHERE id = $1;
        `, [item.commission_id]);
      } else if (status === 'failed') {
        // Revert commission back to payable so it can be retried
        await client.query(`
          UPDATE commissions
          SET status = 'payable', payout_item_id = NULL, updated_at = NOW()
          WHERE id = $1;
        `, [item.commission_id]);
      }
    }

    // Check parent batch completion status
    const batchItemsRes = await client.query(
      'SELECT status FROM payout_items WHERE batch_id = $1',
      [item.batch_id]
    );
    const itemStatuses = batchItemsRes.rows.map((r) => r.status);
    const allTerminal = itemStatuses.every((s) => ['success', 'failed'].includes(s));

    if (allTerminal) {
      const hasFailed = itemStatuses.includes('failed');
      const hasSuccess = itemStatuses.includes('success');
      let batchStatus = 'completed';

      if (hasFailed && hasSuccess) {
        batchStatus = 'partially_completed';
      } else if (hasFailed && !hasSuccess) {
        batchStatus = 'failed';
      }

      await client.query(`
        UPDATE payout_batches
        SET status = $1, completed_at = NOW(), updated_at = NOW()
        WHERE id = $2;
      `, [batchStatus, item.batch_id]);
    } else {
      // Mark batch processing if not already
      await client.query(`
        UPDATE payout_batches
        SET status = 'processing', updated_at = NOW()
        WHERE id = $1 AND status = 'pending';
      `, [item.batch_id]);
    }

    await client.query('COMMIT');

    logger.info('Payout item status updated', {
      itemId,
      status: updatedItem.status,
      resultCode,
      transactionId: updatedItem.transaction_id,
    });

    return updatedItem;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  createBatchFromCommissions,
  getBatchById,
  listBatches,
  getPayoutItemById,
  findItemByConversationId,
  updateItemWithDispatch,
  updateItemWithResult,
};
