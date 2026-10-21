/**
 * Soya Ventures - Sales Controller
 */

const saleRepository = require('../repositories/saleRepository');

async function recordSale(req, res, next) {
  try {
    const { product_id, quantity, customer_phone } = req.body;

    const result = await saleRepository.recordSale({
      agent: req.user,
      product_id,
      quantity,
      customer_phone,
    });

    res.status(201).json({
      success: true,
      message: 'Sale recorded and commissions generated successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

async function getSales(req, res, next) {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const agentId = req.query.agent_id ? Number(req.query.agent_id) : null;
    const centerId = req.query.center_id ? Number(req.query.center_id) : null;
    const productId = req.query.product_id ? Number(req.query.product_id) : null;

    const sales = await saleRepository.listSales({
      user: req.user,
      agentId,
      centerId,
      productId,
      limit,
      offset,
    });

    res.status(200).json({
      success: true,
      data: {
        sales,
        count: sales.length,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  recordSale,
  getSales,
};

