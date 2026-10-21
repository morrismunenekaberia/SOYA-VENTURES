/**
 * Soya Ventures - Center Controller
 */

const centerRepository = require('../repositories/centerRepository');
const { AppError } = require('../middleware/errorHandler');

async function getCenters(req, res, next) {
  try {
    const isAdminOrManager = req.user && ['admin', 'manager'].includes(req.user.role);
    const includeInactive = isAdminOrManager && req.query.include_inactive === 'true';

    const centers = await centerRepository.listCenters({ includeInactive });
    res.status(200).json({
      success: true,
      data: {
        centers,
        count: centers.length,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function getCenterById(req, res, next) {
  try {
    const id = Number(req.params.id);
    const center = await centerRepository.findById(id);

    if (!center) {
      return next(new AppError('Center hub not found.', 404, 'CENTER_NOT_FOUND'));
    }

    res.status(200).json({
      success: true,
      data: {
        center,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function createCenter(req, res, next) {
  try {
    const center = await centerRepository.create(req.body);
    res.status(201).json({
      success: true,
      message: 'Center created successfully',
      data: {
        center,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function updateCenter(req, res, next) {
  try {
    const id = Number(req.params.id);
    const existing = await centerRepository.findById(id);
    if (!existing) {
      return next(new AppError('Center hub not found.', 404, 'CENTER_NOT_FOUND'));
    }

    const center = await centerRepository.update(id, req.body);
    res.status(200).json({
      success: true,
      message: 'Center updated successfully',
      data: {
        center,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function deactivateCenter(req, res, next) {
  try {
    const id = Number(req.params.id);
    const existing = await centerRepository.findById(id);
    if (!existing) {
      return next(new AppError('Center hub not found.', 404, 'CENTER_NOT_FOUND'));
    }

    const center = await centerRepository.deactivate(id);
    res.status(200).json({
      success: true,
      message: 'Center deactivated successfully',
      data: {
        center,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getCenters,
  getCenterById,
  createCenter,
  updateCenter,
  deactivateCenter,
};

