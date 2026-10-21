
const express = require('express');
require('dotenv').config();

const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Check whether the API is running.
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Soya Ventures API is running',
  });
});

// Retrieve all products from PostgreSQL.
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, price, created_at FROM products ORDER BY id'
    );

    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Failed to retrieve products:', error.message);

    res.status(500).json({
      error: 'Failed to retrieve products',
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Soya Ventures API running on port ${PORT}`);
});
