/**
 * Soya Ventures - Commission Controller
 */

const saleRepository = require('../repositories/saleRepository');

async function getCommissions(req, res, next) {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const status = req.query.status || null;
    const type = req.query.type || null;

    const commissions = await saleRepository.listCommissions({
      user: req.user,
      status,
      type,
      limit,
      offset,
    });

    res.status(200).json({
      success: true,
      data: {
        commissions,
        count: commissions.length,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getCommissions,
};

