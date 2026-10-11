'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const User = require('../models/User');
const { ROLE_LABELS } = require('../config/roles');
const moduleAccess = require('../services/moduleAccess');

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, tv: user.tokenVersion || 0 }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/** Verifies the JWT and attaches the live user document to req.user. */
const authenticate = asyncHandler(async (req, _res, next) => {
  const token = extractToken(req);
  if (!token) throw ApiError.unauthorized('Missing authentication token');

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch (err) {
    const message =
      err.name === 'TokenExpiredError' ? 'Session expired, please sign in again' : 'Invalid token';
    throw ApiError.unauthorized(message);
  }

  const user = await User.findById(payload.sub);
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  if (!user.isActive) throw ApiError.forbidden('Account has been deactivated');

  if (user.passwordChangedAt && payload.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)) {
    throw ApiError.unauthorized('Password was changed, please sign in again');
  }

  if ((payload.tv || 0) !== (user.tokenVersion || 0)) {
    throw ApiError.unauthorized('Your session was ended, please sign in again');
  }

  req.user = user;
  return next();
});

/** Restricts a route to one or more roles: authorize(ROLES.HR_ADMIN) */
function authorize(...allowedRoles) {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!allowedRoles.includes(req.user.role)) {
      return next(
        ApiError.forbidden(`This action is not available to the ${ROLE_LABELS[req.user.role]} role`)
      );
    }
    return next();
  };
}

/** Restricts a route to roles that own a given module, e.g. requireModule(MODULES.PAYROLL) */
function requireModule(moduleKey) {
  return asyncHandler(async (req, _res, next) => {
    if (!req.user) throw ApiError.unauthorized();
    const allowed = await moduleAccess.roleCanAccess(req.user.role, moduleKey);
    if (!allowed) throw ApiError.forbidden('Your role does not have access to this module');
    return next();
  });
}

module.exports = { signToken, authenticate, authorize, requireModule };
