/**
 * Soya Ventures - Order Controller
 */

const orderRepository = require('../repositories/orderRepository');
const userRepository = require('../repositories/userRepository');
const { pool } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

async function createOrder(req, res, next) {
  try {
    const { order_type, items, notes } = req.body;
    let target_id = req.body.target_id;
    const center_id = req.user.center_id;

    if (order_type === 'agent_to_center') {
      if (!target_id) {
        // Automatically route to the center operator of the agent's center
        const centerOperatorRes = await pool.query(
          "SELECT id FROM users WHERE center_id = $1 AND role = 'center' AND is_active = TRUE LIMIT 1",
          [center_id]
        );

        if (centerOperatorRes.rows.length > 0) {
          target_id = centerOperatorRes.rows[0].id;
        } else {
          // If no specific center operator user exists, route to first active manager/admin
          const managerRes = await pool.query(
            "SELECT id FROM users WHERE role IN ('manager', 'admin') AND is_active = TRUE ORDER BY id ASC LIMIT 1"
          );
          if (managerRes.rows.length === 0) {
            return next(new AppError('No active center operator or manager found to process this order.', 500, 'NO_RECIPIENT_AVAILABLE'));
          }
          target_id = managerRes.rows[0].id;
        }
      }
    } else if (order_type === 'center_to_manager') {
      const targetUser = await userRepository.findById(target_id);
      if (!targetUser || !['manager', 'admin'].includes(targetUser.role) || !targetUser.is_active) {
        return next(new AppError('target_id must be an active Manager or Admin.', 400, 'INVALID_TARGET_MANAGER'));
      }
    }

    const order = await orderRepository.createOrder({
      order_type,
      requester_id: req.user.id,
      target_id,
      center_id,
      notes,
      items,
    });

    res.status(201).json({
      success: true,
      message: 'Order placed successfully',
      data: {
        order,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function getOrders(req, res, next) {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const status = req.query.status || null;

    const orders = await orderRepository.listOrders({
      user: req.user,
      status,
      limit,
      offset,
    });

    res.status(200).json({
      success: true,
      data: {
        orders,
        count: orders.length,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function getOrderById(req, res, next) {
  try {
    const orderId = Number(req.params.id);
    const order = await orderRepository.getOrderById(orderId);

    if (!order) {
      return next(new AppError('Order not found.', 404, 'ORDER_NOT_FOUND'));
    }

    // Permission check
    const { role, id: userId, center_id: centerId } = req.user;
    if (role === 'agent' && order.requester_id !== userId) {
      return next(new AppError('Access denied: You cannot view another agent’s order.', 403, 'FORBIDDEN'));
    }
    if (role === 'center' && order.center_id !== centerId && order.target_id !== userId && order.requester_id !== userId) {
      return next(new AppError('Access denied: You cannot view orders for another center.', 403, 'FORBIDDEN'));
    }

    res.status(200).json({
      success: true,
      data: {
        order,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function updateOrderStatus(req, res, next) {
  try {
    const orderId = Number(req.params.id);
    const { status, notes } = req.body;

    const updated = await orderRepository.transitionOrderStatus({
      orderId,
      newStatus: status,
      reviewer: req.user,
      notes,
    });

    res.status(200).json({
      success: true,
      message: `Order #${orderId} transitioned to ${status}`,
      data: {
        order: updated,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createOrder,
  getOrders,
  getOrderById,
  updateOrderStatus,
};

