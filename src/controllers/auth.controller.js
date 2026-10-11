'use strict';

const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { signToken } = require('../middleware/auth');
const { ROLE_LABELS } = require('../config/roles');
const moduleAccess = require('../services/moduleAccess');
const access = require('../services/access.service');
const guard = require('../services/loginGuard');
const LoginEvent = require('../models/LoginEvent');
const audit = require('../services/audit.service');

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
    mustChangePassword: Boolean(user.mustChangePassword),
    modules: await moduleAccess.resolveModules(user.role),
  };
}

/** Records a sign-in attempt. History must never break signing in. */
async function recordAttempt(req, fields) {
  try {
    await LoginEvent.create({
      ip: String(req.ip || '').slice(0, 64),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
      ...fields,
    });
  } catch (err) {
    /* ignore */
  }
}

/** POST /api/auth  (alias: POST /api/auth/login) */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    throw ApiError.badRequest('Email and password are required');
  }

  const address = String(email).toLowerCase().trim();
  const now = new Date();
  const user = await User.findOne({ email: address }).select('+password');

  if (user && guard.isLocked(user, now)) {
    await recordAttempt(req, { user: user._id, email: address, success: false, reason: 'locked' });
    throw ApiError.tooMany(
      `Too many failed attempts. Try again in ${guard.minutesLeft(user, now)} minute(s), or ask HR to unlock the account.`
    );
  }

  // Same message for unknown email and wrong password so accounts can't be enumerated.
  if (!user || !(await user.comparePassword(password))) {
    if (user) {
      const next = guard.registerFailure(user, now);
      user.failedLogins = next.failedLogins;
      user.lockedUntil = next.lockedUntil;
      await user.save({ validateBeforeSave: false });
    }
    await recordAttempt(req, {
      user: user ? user._id : null,
      email: address,
      success: false,
      reason: user ? 'bad_password' : 'unknown_user',
    });
    throw ApiError.unauthorized('Invalid email or password');
  }
  if (!user.isActive) {
    await recordAttempt(req, { user: user._id, email: address, success: false, reason: 'deactivated' });
    throw ApiError.forbidden('Account has been deactivated, contact HR');
  }

  const ok = guard.registerSuccess();
  user.failedLogins = ok.failedLogins;
  user.lockedUntil = ok.lockedUntil;
  user.lastLoginAt = now;
  await user.save({ validateBeforeSave: false });
  await recordAttempt(req, { user: user._id, email: address, success: true, reason: 'ok' });

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

/** POST /api/auth/change-password */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) throw ApiError.badRequest('Current and new password are required');
  const problem = access.passwordProblem(newPassword);
  if (problem) throw ApiError.badRequest(problem);
  if (currentPassword === newPassword) throw ApiError.badRequest('Choose a password different from the current one');

  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.comparePassword(currentPassword))) throw ApiError.badRequest('Current password is incorrect');

  user.password = newPassword;
  user.mustChangePassword = false;
  await user.save();
  await audit.record(req, { action: 'password_change', objectType: 'User', objectId: String(user._id), summary: 'Changed own password' });

  // A fresh token, because the old one is void from this moment.
  res.json({ success: true, token: signToken(user), user: await toSession(user) });
});

/** POST /api/auth/logout-all — ends this account's sessions on every device, keeping this one. */
const logoutAll = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save({ validateBeforeSave: false });
  await audit.record(req, { action: 'sessions_revoked', objectType: 'User', objectId: String(user._id), summary: 'Signed out everywhere' });
  res.json({ success: true, token: signToken(user), user: await toSession(user) });
});

/** GET /api/auth/activity — the caller's own recent sign-ins */
const activity = asyncHandler(async (req, res) => {
  const rows = await LoginEvent.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(20);
  res.json({ success: true, events: rows.map((row) => row.toJSON()) });
});

module.exports = { login, me, logout, toSession, changePassword, logoutAll, activity };
