/**
 * Soya Ventures - Order Validation
 */

const { AppError } = require('../middleware/errorHandler');

function validateCreateOrder(req, res, next) {
  const { order_type, items, target_id, notes } = req.body || {};

  const allowedTypes = ['agent_to_center', 'center_to_manager'];
  if (!order_type || !allowedTypes.includes(order_type)) {
    return next(new AppError(`order_type must be one of: [${allowedTypes.join(', ')}].`, 400, 'INVALID_ORDER_TYPE'));
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return next(new AppError('Order must include at least one product item in items array.', 400, 'EMPTY_ORDER_ITEMS'));
  }

  const validatedItems = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const productId = Number(item.product_id);
    const quantity = Number(item.quantity);

    if (isNaN(productId) || productId <= 0) {
      return next(new AppError(`Item at index ${i} has an invalid product_id.`, 400, 'INVALID_PRODUCT_ID'));
    }

    if (isNaN(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
      return next(new AppError(`Item at index ${i} has an invalid quantity (must be positive integer).`, 400, 'INVALID_QUANTITY'));
    }

    validatedItems.push({
      product_id: productId,
      quantity,
    });
  }

  // Enforce role-based ordering hierarchy
  if (order_type === 'agent_to_center') {
    if (req.user.role !== 'agent') {
      return next(new AppError('Only agents can place agent-to-center stock orders.', 403, 'FORBIDDEN_ROLE'));
    }
    if (!req.user.center_id) {
      return next(new AppError('You are not assigned to any Center Hub. Contact support.', 400, 'UNASSIGNED_CENTER'));
    }
  } else if (order_type === 'center_to_manager') {
    if (req.user.role !== 'center') {
      return next(new AppError('Only center hub operators can place center-to-manager replenishment orders.', 403, 'FORBIDDEN_ROLE'));
    }
    if (!req.user.center_id) {
      return next(new AppError('You are not assigned to any Center Hub.', 400, 'UNASSIGNED_CENTER'));
    }
    if (!target_id || isNaN(Number(target_id))) {
      return next(new AppError('target_id (Manager User ID) is required for replenishment orders.', 400, 'MISSING_TARGET_MANAGER'));
    }
  }

  req.body.items = validatedItems;
  req.body.target_id = target_id ? Number(target_id) : null;
  req.body.notes = notes ? String(notes).trim() : null;

  next();
}

function validateOrderStatusTransition(req, res, next) {
  const { status, notes } = req.body || {};

  const allowedStatuses = ['approved', 'rejected', 'fulfilled', 'cancelled'];
  if (!status || !allowedStatuses.includes(status)) {
    return next(new AppError(`status must be one of: [${allowedStatuses.join(', ')}].`, 400, 'INVALID_STATUS'));
  }

  req.body.status = status;
  req.body.notes = notes ? String(notes).trim() : null;

  next();
}

module.exports = {
  validateCreateOrder,
  validateOrderStatusTransition,
};

