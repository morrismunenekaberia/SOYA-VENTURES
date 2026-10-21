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
const productRoutes = require('./routes/productRoutes');
const centerRoutes = require('./routes/centerRoutes');
const inventoryRoutes = require('./routes/inventoryRoutes');
const orderRoutes = require('./routes/orderRoutes');
const saleRoutes = require('./routes/saleRoutes');
const commissionRoutes = require('./routes/commissionRoutes');

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
app.use('/api/products', productRoutes);
app.use('/api/centers', centerRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/commissions', commissionRoutes);

// Centralized 404 handler for unrecognized endpoints
app.use(notFoundHandler);

// Centralized operational and unhandled error handler
app.use(errorHandler);

module.exports = app;

