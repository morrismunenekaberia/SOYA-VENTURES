/**
 * Soya Ventures - Authentication Controller
 */

const authService = require('../services/authService');

async function register(req, res, next) {
  try {
    const { user, token } = await authService.registerAgent(req.body);
    res.status(201).json({
      success: true,
      message: 'Agent registration successful',
      data: {
        user,
        token,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { user, token } = await authService.login(req.body);
    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user,
        token,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function getProfile(req, res) {
  res.status(200).json({
    success: true,
    data: {
      user: req.user,
    },
  });
}

async function createUser(req, res, next) {
  try {
    const user = await authService.createUserByAdmin(req.body);
    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: {
        user,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  register,
  login,
  getProfile,
  createUser,
};

