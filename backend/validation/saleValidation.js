/**
 * Soya Ventures - Sales Request Validation
 */

const { AppError } = require('../middleware/errorHandler');

function validateRecordSale(req, res, next) {
  const { product_id, quantity, customer_phone } = req.body || {};

  const parsedProduct = Number(product_id);
  if (isNaN(parsedProduct) || parsedProduct <= 0) {
    return next(new AppError('A valid product_id is required.', 400, 'INVALID_PRODUCT_ID'));
  }

  const parsedQty = Number(quantity);
  if (isNaN(parsedQty) || parsedQty <= 0 || !Number.isInteger(parsedQty)) {
    return next(new AppError('Quantity must be a positive integer.', 400, 'INVALID_QUANTITY'));
  }

  // Explicitly ignore any client-supplied prices or commission amounts
  req.body = {
    product_id: parsedProduct,
    quantity: parsedQty,
    customer_phone: customer_phone ? String(customer_phone).trim() : null,
  };

  next();
}

module.exports = {
  validateRecordSale,
};

