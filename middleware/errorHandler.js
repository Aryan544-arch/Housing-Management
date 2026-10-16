/**
 * 404 handler for unmatched routes.
 */
function notFoundHandler(req, res, next) {
  const error = new Error(`Resource not found - ${req.originalUrl}`);
  res.status(404);
  next(error);
}

/**
 * Centralized error handler middleware.
 * Safe error responses that do not expose stack traces in production.
 */
function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  let statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : (err.statusCode || 500);
  let message = err.message || 'Internal Server Error';

  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = err.message;
  } else if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid format for field "${err.path}".`;
  } else if (err.name === 'VersionError') {
    statusCode = 409;
    message = 'Conflict: The record was modified by another request. Please reload and try again.';
  }

  const response = {
    success: false,
    message
  };

  if (process.env.NODE_ENV !== 'production') {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

module.exports = {
  notFoundHandler,
  errorHandler
};
