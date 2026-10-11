'use strict';

/**
 * Pure account-lockout rules, kept apart from the database so they can be
 * tested directly. `state` is { failedLogins, lockedUntil }.
 */

const { SECURITY } = require('../config/security');

function isLocked(state, now) {
  return Boolean(state && state.lockedUntil && new Date(state.lockedUntil).getTime() > now.getTime());
}

function minutesLeft(state, now) {
  return Math.max(1, Math.ceil((new Date(state.lockedUntil).getTime() - now.getTime()) / 60000));
}

/** The state after one more wrong password. */
function registerFailure(state, now, cfg) {
  const rules = cfg || SECURITY;
  const failed = (state.failedLogins || 0) + 1;
  if (failed >= rules.maxFailedLogins) {
    return { failedLogins: 0, lockedUntil: new Date(now.getTime() + rules.lockMinutes * 60000), justLocked: true };
  }
  return { failedLogins: failed, lockedUntil: null, justLocked: false };
}

/** The state after a successful sign-in. */
function registerSuccess() {
  return { failedLogins: 0, lockedUntil: null };
}

module.exports = { isLocked, minutesLeft, registerFailure, registerSuccess };
