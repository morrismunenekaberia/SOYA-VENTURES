/**
 * Soya Ventures - User Controller (Administrative)
 */

const userRepository = require('../repositories/userRepository');

async function getUsers(req, res, next) {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const role = req.query.role || null;

    const users = await userRepository.listUsers({ limit, offset, role });
    res.status(200).json({
      success: true,
      data: {
        users,
        count: users.length,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function getUserById(req, res, next) {
  try {
    const userId = Number(req.params.id);
    const user = await userRepository.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
        },
      });
    }

    res.status(200).json({
      success: true,
      data: {
        user,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getUsers,
  getUserById,
};

