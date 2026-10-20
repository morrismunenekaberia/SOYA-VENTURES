
const express = require('express');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Allow the API to receive JSON request bodies.
app.use(express.json());

// Health-check endpoint.
app.get('/api/health', (req, res) => { // req is request, what the 
  res.status(200).json({
    status: 'ok',
    message: 'Soya Ventures API is running',
  });
});

// Start the server.
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Soya Ventures API running on port ${PORT}`);
});
