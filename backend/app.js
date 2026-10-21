/**
 * Soya Ventures - Express Application Configuration
 */

const express = require('express');
const { requestLogger } = require('./middleware/requestLogger');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

// Route imports
const healthRoutes = require('./routes/healthRoutes');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const { pool } = require('./config/db');

const app = express();

// Disable x-powered-by header for security
app.disable('x-powered-by');

// Allow JSON body payloads
app.use(express.json());

// Request tracking & timing interceptor
app.use(requestLogger);

// Mount domain routes
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);

// Preserve existing products endpoint (read-only)
app.get('/api/products', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, name, price, is_active, created_at FROM products ORDER BY id'
    );
    res.status(200).json({
      success: true,
      data: {
        products: result.rows,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Centralized 404 handler for unrecognized endpoints
app.use(notFoundHandler);

// Centralized operational and unhandled error handler
app.use(errorHandler);

module.exports = app;

