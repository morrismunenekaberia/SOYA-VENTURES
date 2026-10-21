/**
 * Soya Ventures - Inventory Controller
 */

const inventoryRepository = require('../repositories/inventoryRepository');
const centerRepository = require('../repositories/centerRepository');
const productRepository = require('../repositories/productRepository');
const { AppError } = require('../middleware/errorHandler');

/**
 * Helper to enforce permitted center inventory scope
 */
function resolvePermittedCenterId(user, requestedCenterId) {
  const { role, center_id } = user;

  // Admin and Manager can inspect any center
  if (['admin', 'manager'].includes(role)) {
    if (!requestedCenterId) {
      throw new AppError('center_id parameter is required for administrative stock lookup.', 400, 'MISSING_CENTER_ID');
    }
    return Number(requestedCenterId);
  }

  // Center operators and Agents are strictly confined to their assigned center
  if (!center_id) {
    throw new AppError('You are not assigned to any Center Hub.', 403, 'UNASSIGNED_CENTER');
  }

  if (requestedCenterId && Number(requestedCenterId) !== center_id) {
    throw new AppError("Access denied: You are not authorized to view another center's inventory.", 403, 'FORBIDDEN_CENTER_SCOPE');
  }

  return center_id;
}

async function getCenterStock(req, res, next) {
  try {
    const requestedCenterId = req.params.centerId || req.query.center_id;
    const centerId = resolvePermittedCenterId(req.user, requestedCenterId);

    const center = await centerRepository.findById(centerId);
    if (!center) {
      return next(new AppError('Center hub not found.', 404, 'CENTER_NOT_FOUND'));
    }

    const stock = await inventoryRepository.getStockByCenter(centerId);
    res.status(200).json({
      success: true,
      data: {
        center: {
          id: center.id,
          name: center.name,
          location: center.location,
        },
        stock,
        item_count: stock.length,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function getStockItem(req, res, next) {
  try {
    const requestedCenterId = req.params.centerId;
    const centerId = resolvePermittedCenterId(req.user, requestedCenterId);
    const productId = Number(req.params.productId);

    const stockItem = await inventoryRepository.getStockItem(centerId, productId);
    if (!stockItem) {
      return res.status(200).json({
        success: true,
        data: {
          center_id: centerId,
          product_id: productId,
          quantity: 0,
        },
      });
    }

    res.status(200).json({
      success: true,
      data: {
        stock_item: stockItem,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function restock(req, res, next) {
  try {
    const { center_id, product_id, quantity, notes } = req.body;

    const center = await centerRepository.findById(center_id);
    if (!center || !center.is_active) {
      return next(new AppError('Specified center hub does not exist or is inactive.', 400, 'INVALID_CENTER'));
    }

    const product = await productRepository.findById(product_id);
    if (!product || !product.is_active) {
      return next(new AppError('Specified product does not exist or is inactive.', 400, 'INVALID_PRODUCT'));
    }

    const result = await inventoryRepository.restockCenter({
      centerId: center_id,
      productId: product_id,
      quantity,
      performedBy: req.user.id,
      notes,
    });

    res.status(200).json({
      success: true,
      message: `Successfully restocked ${quantity} units of ${product.name}`,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getCenterStock,
  getStockItem,
  restock,
};

