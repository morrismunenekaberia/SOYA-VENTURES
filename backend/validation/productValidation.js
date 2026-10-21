/**
 * Soya Ventures - Product Validation Middleware
 */

const { AppError } = require('../middleware/errorHandler');

function validateCreateProduct(req, res, next) {
  const { name, price, sku, commission_per_unit } = req.body || {};

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return next(new AppError('Product name is required.', 400, 'INVALID_PRODUCT_NAME'));
  }

  const parsedPrice = Number(price);
  if (isNaN(parsedPrice) || parsedPrice <= 0) {
    return next(new AppError('Product price must be a valid positive number.', 400, 'INVALID_PRODUCT_PRICE'));
  }

  let parsedCommission = 50.00;
  if (commission_per_unit !== undefined && commission_per_unit !== null) {
    parsedCommission = Number(commission_per_unit);
    if (isNaN(parsedCommission) || parsedCommission < 0) {
      return next(new AppError('Commission per unit must be a non-negative number.', 400, 'INVALID_COMMISSION_PER_UNIT'));
    }
  }

  req.body.name = name.trim();
  req.body.price = parsedPrice;
  req.body.sku = sku ? String(sku).trim() : null;
  req.body.commission_per_unit = parsedCommission;

  next();
}

function validateUpdateProduct(req, res, next) {
  const { name, price, sku, commission_per_unit, is_active } = req.body || {};

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      return next(new AppError('Product name cannot be empty.', 400, 'INVALID_PRODUCT_NAME'));
    }
    req.body.name = name.trim();
  }

  if (price !== undefined) {
    const parsedPrice = Number(price);
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      return next(new AppError('Product price must be a positive number.', 400, 'INVALID_PRODUCT_PRICE'));
    }
    req.body.price = parsedPrice;
  }

  if (sku !== undefined) {
    req.body.sku = sku ? String(sku).trim() : null;
  }

  if (commission_per_unit !== undefined) {
    const parsedCommission = Number(commission_per_unit);
    if (isNaN(parsedCommission) || parsedCommission < 0) {
      return next(new AppError('Commission per unit must be a non-negative number.', 400, 'INVALID_COMMISSION_PER_UNIT'));
    }
    req.body.commission_per_unit = parsedCommission;
  }

  if (is_active !== undefined) {
    req.body.is_active = Boolean(is_active);
  }

  next();
}

module.exports = {
  validateCreateProduct,
  validateUpdateProduct,
};

