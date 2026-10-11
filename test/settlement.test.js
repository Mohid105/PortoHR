'use strict';

/** Figures from a real final-settlement bill (numbers only, no personal data). */

const test = require('node:test');
const assert = require('node:assert');
const { computeSettlement, serviceLength } = require('../src/services/settlement.service');

const rupees = (minor) => minor / 100;
const near = (actual, expected, tolerance = 2) => assert.ok(Math.abs(rupees(actual) - expected) <= tolerance, `${rupees(actual)} is not within ${tolerance} of ${expected}`);

test('final settlement reproduces a real bill', () => {
  const result = computeSettlement({
    gross: 3980800,
    attendanceDays: 4,
    fraction: 1,
    leaveRows: [
      { leaveType: 'annual', label: 'Annual leave', entitlement: 12, taken: 0 },
      { leaveType: 'casual', label: 'Casual leave', entitlement: 0, taken: 1.3495 },
    ],
    longServiceAllowance: 7700,
    longServiceDeduction: 7700,
    excessPaidSalary: 612400,
  });

  near(result.adjustedGross, 6124, 1);
  near(result.netSalaryPayable, 6201, 1);
  assert.strictEqual(result.leaveEncashmentDays, 12);
  near(result.leaveEncashment, 18373, 1);
  near(result.finalSettlement, 24574, 2);
  assert.strictEqual(result.deductions.excessLeaveDays, 1.35);
  near(result.deductions.excessLeaveRecovery, 2066, 2);
  near(result.deductions.total, 8267, 3);
  near(result.netPayable, 16307, 4);
});

test('overdrawn leave on a recovery-exempt type is not recovered', () => {
  const result = computeSettlement({
    gross: 2600000,
    attendanceDays: 26,
    fraction: 1,
    leaveRows: [{ leaveType: 'special', label: 'Special', entitlement: 0, taken: 15 }],
  });
  assert.strictEqual(result.deductions.excessLeaveRecovery, 0);
});

test('a settlement can come out negative when the employee owes the company', () => {
  const result = computeSettlement({ gross: 3000000, attendanceDays: 0, fraction: 1, leaveRows: [], shortTermLoan: 5000000 });
  assert.ok(result.netPayable < 0);
});

test('length of service', () => {
  const d = (s) => new Date(`${s}T00:00:00Z`);
  assert.deepStrictEqual(serviceLength(d('2017-02-11'), d('2025-06-18')), { years: 8, months: 4 });
});
