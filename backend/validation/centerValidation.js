/**
 * Soya Ventures - Center & Inventory Validation
 */

const { AppError } = require('../middleware/errorHandler');

function validateCreateCenter(req, res, next) {
  const { name, location, contact_phone } = req.body || {};

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return next(new AppError('Center name is required.', 400, 'INVALID_CENTER_NAME'));
  }

  req.body.name = name.trim();
  req.body.location = location ? String(location).trim() : null;
  req.body.contact_phone = contact_phone ? String(contact_phone).trim() : null;

  next();
}

function validateUpdateCenter(req, res, next) {
  const { name, location, contact_phone, is_active } = req.body || {};

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      return next(new AppError('Center name cannot be empty.', 400, 'INVALID_CENTER_NAME'));
    }
    req.body.name = name.trim();
  }

  if (location !== undefined) {
    req.body.location = location ? String(location).trim() : null;
  }

  if (contact_phone !== undefined) {
    req.body.contact_phone = contact_phone ? String(contact_phone).trim() : null;
  }

  if (is_active !== undefined) {
    req.body.is_active = Boolean(is_active);
  }

  next();
}

function validateRestock(req, res, next) {
  const { center_id, product_id, quantity, notes } = req.body || {};

  const parsedCenter = Number(center_id);
  if (isNaN(parsedCenter) || parsedCenter <= 0) {
    return next(new AppError('Valid center_id is required.', 400, 'INVALID_CENTER'));
  }

  const parsedProduct = Number(product_id);
  if (isNaN(parsedProduct) || parsedProduct <= 0) {
    return next(new AppError('Valid product_id is required.', 400, 'INVALID_PRODUCT'));
  }

  const parsedQty = Number(quantity);
  if (isNaN(parsedQty) || parsedQty <= 0 || !Number.isInteger(parsedQty)) {
    return next(new AppError('Quantity must be a positive integer.', 400, 'INVALID_QUANTITY'));
  }

  req.body.center_id = parsedCenter;
  req.body.product_id = parsedProduct;
  req.body.quantity = parsedQty;
  req.body.notes = notes ? String(notes).trim() : null;

  next();
}

module.exports = {
  validateCreateCenter,
  validateUpdateCenter,
  validateRestock,
};

