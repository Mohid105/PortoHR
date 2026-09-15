'use strict';

const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { signToken } = require('../middleware/auth');
const { ROLE_LABELS } = require('../config/roles');
const moduleAccess = require('../services/moduleAccess');

async function toSession(user) {
  return {
    id: user.id,
    employeeId: user.employeeId,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    roleLabel: ROLE_LABELS[user.role],
    designation: user.designation,
    department: user.department,
    modules: await moduleAccess.resolveModules(user.role),
  };
}

/** POST /api/auth  (alias: POST /api/auth/login) */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    throw ApiError.badRequest('Email and password are required');
  }

  const user = await User.findOne({ email: String(email).toLowerCase().trim() }).select('+password');

  // Same message for unknown email and wrong password so accounts can't be enumerated.
  if (!user || !(await user.comparePassword(password))) {
    throw ApiError.unauthorized('Invalid email or password');
  }
  if (!user.isActive) {
    throw ApiError.forbidden('Account has been deactivated, contact HR');
  }

  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });

  res.json({
    success: true,
    token: signToken(user),
    user: await toSession(user),
  });
});

/** GET /api/auth/me */
const me = asyncHandler(async (req, res) => {
  res.json({ success: true, user: await toSession(req.user) });
});

/** POST /api/auth/logout — stateless JWT, the client discards the token. */
const logout = asyncHandler(async (_req, res) => {
  res.json({ success: true, message: 'Signed out' });
});

module.exports = { login, me, logout, toSession };
