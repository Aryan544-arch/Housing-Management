const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();

/**
 * Health check endpoint reporting service status, runtime uptime, and DB connectivity.
 */
router.get('/health', (req, res) => {
  const isDbConnected = mongoose.connection.readyState === 1;

  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    database: {
      status: isDbConnected ? 'connected' : 'disconnected'
    }
  });
});

module.exports = router;
