'use strict';

const test = require('node:test');
const assert = require('node:assert');
const guard = require('../src/services/loginGuard');

const rules = { maxFailedLogins: 3, lockMinutes: 10 };
const now = new Date('2026-10-04T10:00:00Z');

test('failures accumulate and then lock the account', () => {
  let state = { failedLogins: 0, lockedUntil: null };
  state = guard.registerFailure(state, now, rules);
  assert.strictEqual(state.failedLogins, 1);
  assert.strictEqual(guard.isLocked(state, now), false);
  state = guard.registerFailure(state, now, rules);
  state = guard.registerFailure(state, now, rules);
  assert.strictEqual(state.justLocked, true);
  assert.strictEqual(state.failedLogins, 0);
  assert.strictEqual(guard.isLocked(state, now), true);
  assert.strictEqual(guard.minutesLeft(state, now), 10);
});

test('a lock expires, and success clears the count', () => {
  const state = guard.registerFailure({ failedLogins: 2 }, now, rules);
  assert.strictEqual(guard.isLocked(state, new Date(now.getTime() + 11 * 60000)), false);
  assert.deepStrictEqual(guard.registerSuccess(), { failedLogins: 0, lockedUntil: null });
});

test('attrition is leavers over average headcount', () => {
  const { attritionRate } = require('../src/services/company.service');
  assert.strictEqual(attritionRate(5, 45, 55), 10);
  assert.strictEqual(attritionRate(0, 0, 0), null);
});
