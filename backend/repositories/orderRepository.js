/**
 * Soya Ventures - Order Repository & Transactional State Machine
 */

const { pool } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

async function createOrder({
  order_type,
  requester_id,
  target_id,
  center_id,
  notes = null,
  items, // [{ product_id, quantity }]
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch trusted prices for all requested products
    const productIds = items.map((i) => i.product_id);
    const prodRes = await client.query(
      'SELECT id, name, price, is_active FROM products WHERE id = ANY($1::int[])',
      [productIds]
    );

    const productMap = new Map(prodRes.rows.map((p) => [p.id, p]));

    // Validate that all products exist and are active
    let calculatedTotal = 0;
    const validatedItems = [];

    for (const item of items) {
      const product = productMap.get(item.product_id);
      if (!product) {
        throw new AppError(`Product with ID ${item.product_id} not found.`, 400, 'PRODUCT_NOT_FOUND');
      }
      if (!product.is_active) {
        throw new AppError(`Product '${product.name}' is inactive and cannot be ordered.`, 400, 'INACTIVE_PRODUCT');
      }

      const unit_price = Number(product.price);
      const lineTotal = unit_price * item.quantity;
      calculatedTotal += lineTotal;

      validatedItems.push({
        product_id: product.id,
        name: product.name,
        quantity: item.quantity,
        unit_price,
        total: lineTotal,
      });
    }

    // Insert order header
    const orderQuery = `
      INSERT INTO orders (
        order_type, requester_id, target_id, center_id, 
        total_amount, status, notes
      )
      VALUES ($1, $2, $3, $4, $5, 'pending', $6)
      RETURNING id, order_type, requester_id, target_id, center_id, 
                total_amount, status, notes, created_at, updated_at;
    `;
    const orderRes = await client.query(orderQuery, [
      order_type,
      requester_id,
      target_id,
      center_id,
      calculatedTotal,
      notes,
    ]);
    const createdOrder = orderRes.rows[0];

    // Insert order items
    const insertedItems = [];
    for (const item of validatedItems) {
      const itemQuery = `
        INSERT INTO order_items (order_id, product_id, quantity, unit_price)
        VALUES ($1, $2, $3, $4)
        RETURNING id, order_id, product_id, quantity, unit_price, created_at;
      `;
      const itemRes = await client.query(itemQuery, [
        createdOrder.id,
        item.product_id,
        item.quantity,
        item.unit_price,
      ]);
      insertedItems.push({
        ...itemRes.rows[0],
        product_name: item.name,
      });
    }

    await client.query('COMMIT');

    return {
      ...createdOrder,
      items: insertedItems,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getOrderById(orderId) {
  const orderQuery = `
    SELECT o.id, o.order_type, o.requester_id, o.target_id, o.center_id,
           o.total_amount, o.status, o.approved_by, o.approved_at, o.fulfilled_at,
           o.notes, o.created_at, o.updated_at,
           req.full_name AS requester_name, req.role AS requester_role,
           tar.full_name AS target_name, tar.role AS target_role,
           c.name AS center_name
    FROM orders o
    JOIN users req ON req.id = o.requester_id
    JOIN users tar ON tar.id = o.target_id
    LEFT JOIN centers c ON c.id = o.center_id
    WHERE o.id = $1
    LIMIT 1;
  `;
  const orderRes = await pool.query(orderQuery, [orderId]);
  if (orderRes.rows.length === 0) return null;

  const order = orderRes.rows[0];

  const itemsQuery = `
    SELECT oi.id, oi.product_id, oi.quantity, oi.unit_price,
           p.name AS product_name, p.sku
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = $1
    ORDER BY oi.id ASC;
  `;
  const itemsRes = await pool.query(itemsQuery, [orderId]);
  order.items = itemsRes.rows;

  return order;
}

async function listOrders({ user, status = null, limit = 50, offset = 0 } = {}) {
  const { role, id: userId, center_id: centerId } = user;

  let filter = '';
  const values = [];

  if (role === 'admin') {
    // Admin sees all orders
    filter = 'WHERE 1=1';
  } else if (role === 'manager') {
    // Manager sees all center_to_manager orders or orders targeted to them
    values.push(userId);
    filter = `WHERE (o.order_type = 'center_to_manager' OR o.target_id = $${values.length})`;
  } else if (role === 'center') {
    // Center operator sees orders for their center or targeted to them
    values.push(centerId, userId);
    filter = `WHERE (o.center_id = $${values.length - 1} OR o.target_id = $${values.length} OR o.requester_id = $${values.length})`;
  } else if (role === 'agent') {
    // Agent only sees their own orders
    values.push(userId);
    filter = `WHERE o.requester_id = $${values.length}`;
  }

  if (status) {
    values.push(status);
    filter += ` AND o.status = $${values.length}`;
  }

  values.push(limit, offset);
  const query = `
    SELECT o.id, o.order_type, o.requester_id, o.target_id, o.center_id,
           o.total_amount, o.status, o.created_at, o.updated_at,
           req.full_name AS requester_name,
           tar.full_name AS target_name,
           c.name AS center_name,
           (SELECT count(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
    FROM orders o
    JOIN users req ON req.id = o.requester_id
    JOIN users tar ON tar.id = o.target_id
    LEFT JOIN centers c ON c.id = o.center_id
    ${filter}
    ORDER BY o.id DESC
    LIMIT $${values.length - 1} OFFSET $${values.length};
  `;

  const result = await pool.query(query, values);
  return result.rows;
}

/**
 * Executes state machine transition with concurrency control and stock updates
 */
async function transitionOrderStatus({ orderId, newStatus, reviewer, notes = null }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock the order row to prevent race conditions
    const lockQuery = `
      SELECT id, order_type, requester_id, target_id, center_id, status
      FROM orders
      WHERE id = $1
      FOR UPDATE;
    `;
    const lockRes = await client.query(lockQuery, [orderId]);
    if (lockRes.rows.length === 0) {
      throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    }

    const order = lockRes.rows[0];

    // 2. State transition rules
    const validTransitions = {
      pending: ['approved', 'rejected', 'cancelled'],
      approved: ['fulfilled', 'cancelled'],
      rejected: [],
      fulfilled: [],
      cancelled: [],
    };

    const allowedNext = validTransitions[order.status] || [];
    if (!allowedNext.includes(newStatus)) {
      throw new AppError(
        `Cannot transition order from '${order.status}' to '${newStatus}'. Allowed: [${allowedNext.join(', ')}].`,
        400,
        'INVALID_STATUS_TRANSITION'
      );
    }

    // 3. Authorization checks: Requester cannot approve their own orders!
    if (['approved', 'rejected', 'fulfilled'].includes(newStatus)) {
      if (reviewer.id === order.requester_id) {
        throw new AppError(
          'Conflict of interest: You cannot approve or fulfill your own order.',
          403,
          'CANNOT_APPROVE_OWN_ORDER'
        );
      }

      if (order.order_type === 'agent_to_center') {
        // Must be center operator for that center or admin/manager
        const isPermittedCenter = reviewer.role === 'center' && reviewer.center_id === order.center_id;
        const isAdminOrManager = ['admin', 'manager'].includes(reviewer.role);
        if (!isPermittedCenter && !isAdminOrManager) {
          throw new AppError('Access denied: Only the designated Center Hub operator or Managers can approve/fulfill this order.', 403, 'FORBIDDEN');
        }
      } else if (order.order_type === 'center_to_manager') {
        // Must be manager or admin
        if (!['admin', 'manager'].includes(reviewer.role)) {
          throw new AppError('Access denied: Only Managers or Admins can approve/fulfill restocking requests.', 403, 'FORBIDDEN');
        }
      }
    }

    // Cancellation can only be done by requester or admin
    if (newStatus === 'cancelled') {
      if (reviewer.id !== order.requester_id && reviewer.role !== 'admin') {
        throw new AppError('Only the order requester or an admin can cancel this order.', 403, 'FORBIDDEN');
      }
    }

    // 4. Fetch line items
    const itemsRes = await client.query(
      'SELECT product_id, quantity FROM order_items WHERE order_id = $1',
      [orderId]
    );
    const items = itemsRes.rows;

    // 5. Handle stock updates on fulfillment
    if (newStatus === 'fulfilled') {
      if (order.order_type === 'agent_to_center') {
        // Deduct inventory from Center Hub with row lock
        for (const item of items) {
          const stockRes = await client.query(
            'SELECT quantity FROM stock WHERE center_id = $1 AND product_id = $2 FOR UPDATE',
            [order.center_id, item.product_id]
          );

          const currentQty = stockRes.rows[0] ? stockRes.rows[0].quantity : 0;
          if (currentQty < item.quantity) {
            throw new AppError(
              `Insufficient stock at Center Hub to fulfill product ID ${item.product_id}. Available: ${currentQty}, Required: ${item.quantity}.`,
              400,
              'INSUFFICIENT_STOCK'
            );
          }

          // Deduct stock
          await client.query(
            'UPDATE stock SET quantity = quantity - $1 WHERE center_id = $2 AND product_id = $3',
            [item.quantity, order.center_id, item.product_id]
          );

          // Record in audit ledger
          await client.query(`
            INSERT INTO stock_movements (
              center_id, product_id, change_quantity, balance_after,
              movement_type, reference_type, reference_id, performed_by, notes
            )
            VALUES ($1, $2, $3, $4, 'order_fulfillment', 'order', $5, $6, $7)
          `, [
            order.center_id,
            item.product_id,
            -item.quantity,
            currentQty - item.quantity,
            orderId,
            reviewer.id,
            notes || `Fulfilled Agent order #${orderId}`,
          ]);
        }
      } else if (order.order_type === 'center_to_manager') {
        // Replenish inventory at Center Hub
        for (const item of items) {
          const stockRes = await client.query(`
            INSERT INTO stock (center_id, product_id, quantity)
            VALUES ($1, $2, $3)
            ON CONFLICT (center_id, product_id)
            DO UPDATE SET quantity = stock.quantity + EXCLUDED.quantity
            RETURNING quantity;
          `, [order.center_id, item.product_id, item.quantity]);

          const newQty = stockRes.rows[0].quantity;

          // Record in audit ledger
          await client.query(`
            INSERT INTO stock_movements (
              center_id, product_id, change_quantity, balance_after,
              movement_type, reference_type, reference_id, performed_by, notes
            )
            VALUES ($1, $2, $3, $4, 'order_receipt', 'order', $5, $6, $7)
          `, [
            order.center_id,
            item.product_id,
            item.quantity,
            newQty,
            orderId,
            reviewer.id,
            notes || `Fulfilled Manager replenishment order #${orderId}`,
          ]);
        }
      }
    }

    // 6. Update order status and audit timestamps
    let updateFields = 'status = $1, updated_at = NOW()';
    const updateValues = [newStatus];

    if (newStatus === 'approved') {
      updateValues.push(reviewer.id);
      updateFields += `, approved_by = $${updateValues.length}, approved_at = NOW()`;
    } else if (newStatus === 'fulfilled') {
      updateFields += ', fulfilled_at = NOW()';
    }

    if (notes) {
      updateValues.push(notes);
      updateFields += `, notes = $${updateValues.length}`;
    }

    updateValues.push(orderId);
    const updateQuery = `
      UPDATE orders
      SET ${updateFields}
      WHERE id = $${updateValues.length}
      RETURNING id, order_type, requester_id, target_id, center_id, status,
                approved_by, approved_at, fulfilled_at, notes, updated_at;
    `;
    const updateRes = await client.query(updateQuery, updateValues);

    await client.query('COMMIT');
    return updateRes.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  createOrder,
  getOrderById,
  listOrders,
  transitionOrderStatus,
};

