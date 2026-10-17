const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { connectDB, disconnectDB } = require('./config/db');
const { getJwtSecret } = require('./middleware/auth');
const healthRoutes = require('./routes/healthRoutes');
const authRoutes = require('./routes/authRoutes');
const societyRoutes = require('./routes/societyRoutes');
const { csrfProtection } = require('./middleware/csrf');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

// Security HTTP headers with content security policy permitting self scripts and Google Fonts
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"]
      }
    }
  })
);

// EJS View Engine configuration
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static assets from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Global rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later.'
  }
});
app.use(limiter);

// Body parsing with reasonable limits
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Cookie parsing for HttpOnly JWT authentication
app.use(cookieParser());

// CSRF defense middleware
app.use(csrfProtection);

// Mount API routes
app.use('/', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/societies', societyRoutes);

// Mount Web UI routes
const webRoutes = require('./routes/webRoutes');
app.use('/', webRoutes);

// 404 handler for undefined routes
app.use(notFoundHandler);

// Centralized error handler
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

/**
 * Start the HTTP server after connecting to MongoDB.
 * Fails startup if the database connection cannot be established.
 */
async function startServer() {
  try {
    // Proactively validate JWT security configuration before opening listeners
    getJwtSecret();
    await connectDB();
    const server = app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
    });
    return server;
  } catch (error) {
    console.error('Startup aborted due to database connection failure:', error.message);
    process.exit(1);
  }
}

// Start listener only when executed directly
if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  startServer,
  connectDB,
  disconnectDB
};
