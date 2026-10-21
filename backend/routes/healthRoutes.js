/**
 * Soya Ventures - Health & Readiness Routes
 * Mounted at /api/health
 */

const express = require('express');
const { getHealth, getDatabaseReadiness } = require('../controllers/healthController');

const router = express.Router();

router.get('/', getHealth);
router.get('/db', getDatabaseReadiness);

module.exports = router;

