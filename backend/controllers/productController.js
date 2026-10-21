/**
 * Soya Ventures - Product Controller
 */

const productRepository = require('../repositories/productRepository');
const { AppError } = require('../middleware/errorHandler');

async function getProducts(req, res, next) {
  try {
    const isAdmin = req.user && req.user.role === 'admin';
    const includeInactive = isAdmin && req.query.include_inactive === 'true';

    const products = await productRepository.listProducts({ includeInactive });
    res.status(200).json({
      success: true,
      data: {
        products,
        count: products.length,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function getProductById(req, res, next) {
  try {
    const id = Number(req.params.id);
    const product = await productRepository.findById(id);

    if (!product) {
      return next(new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND'));
    }

    res.status(200).json({
      success: true,
      data: {
        product,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function createProduct(req, res, next) {
  try {
    const { name, price, sku, commission_per_unit } = req.body;

    if (sku) {
      const existing = await productRepository.findBySku(sku);
      if (existing) {
        return next(new AppError('A product with this SKU already exists.', 409, 'DUPLICATE_SKU'));
      }
    }

    const product = await productRepository.create({ name, price, sku, commission_per_unit });
    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: {
        product,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function updateProduct(req, res, next) {
  try {
    const id = Number(req.params.id);
    const existing = await productRepository.findById(id);
    if (!existing) {
      return next(new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND'));
    }

    if (req.body.sku && req.body.sku !== existing.sku) {
      const skuOwner = await productRepository.findBySku(req.body.sku);
      if (skuOwner && skuOwner.id !== id) {
        return next(new AppError('A product with this SKU already exists.', 409, 'DUPLICATE_SKU'));
      }
    }

    const product = await productRepository.update(id, req.body);
    res.status(200).json({
      success: true,
      message: 'Product updated successfully',
      data: {
        product,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function deactivateProduct(req, res, next) {
  try {
    const id = Number(req.params.id);
    const existing = await productRepository.findById(id);
    if (!existing) {
      return next(new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND'));
    }

    const product = await productRepository.deactivate(id);
    res.status(200).json({
      success: true,
      message: 'Product deactivated successfully',
      data: {
        product,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deactivateProduct,
};

