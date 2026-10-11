'use strict';

const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

/** Catch-all for unmatched API routes. */
function notFound(req, _res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}

/** Translates driver/library errors into a consistent ApiError shape. */
function normalize(err) {
  if (err instanceof ApiError) return err;

  if (err.name === 'ValidationError') {
    const details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    return ApiError.badRequest('Validation failed', details);
  }

  if (err.name === 'CastError') {
    return ApiError.badRequest(`Invalid value for ${err.path}`);
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return ApiError.conflict(`A record with that ${field} already exists`);
  }

  if (err.type === 'entity.too.large') {
    return new ApiError(413, 'That upload is too large');
  }

  if (err.type === 'entity.parse.failed') {
    return ApiError.badRequest('Request body is not valid JSON');
  }

  const wrapped = ApiError.internal(err.message || 'Something went wrong');
  wrapped.isOperational = false;
  wrapped.stack = err.stack;
  return wrapped;
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
function errorHandler(err, req, res, _next) {
  const error = normalize(err);

  if (error.statusCode >= 500) {
    logger.error(`${req.method} ${req.originalUrl} ->`, error.stack || error.message);
  }

  const body = {
    success: false,
    message: error.statusCode >= 500 && env.isProduction ? 'Something went wrong' : error.message,
  };
  if (error.details) body.details = error.details;
  if (!env.isProduction && error.statusCode >= 500) body.stack = error.stack;

  res.status(error.statusCode).json(body);
}

module.exports = { notFound, errorHandler };
