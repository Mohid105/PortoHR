'use strict';

/**
 * Figures below were taken from a real fixed-rate payslip and salary sheet
 * (numbers only — no personal data), so the engine is held to the arithmetic
 * an actual payroll department produced.
 */

const test = require('node:test');
const assert = require('node:assert');
const { computePayslip } = require('../src/services/payroll.service');

const rupees = (minor) => minor / 100;
const month = { month: '2026-03', calendarDays: 31, workingDays: 26, employedWorkingDays: 26, isComplete: true };

test('worker payslip: salary/26, double-rate overtime, gazetted-holiday pay, EOBI and loan recovery', () => {
  const slip = computePayslip({
    employee: { employeeCategory: 'worker', shiftType: 'general', compensation: { baseSalary: 45205, currency: 'PKR', fixedAllowances: [] } },
    period: month,
    attendance: { presentDays: 20, absentDays: 5.78, overtimeHours: 211.57, recordedDays: 20 },
    variable: { gazettedHolidayHours: 75, loanRecovery: 1390900 },
  });

  assert.ok(Math.abs(rupees(slip.earnings.adjustedGross) - 35156) <= 1, 'adjusted pay');
  assert.ok(Math.abs(rupees(slip.earnings.overtimePay) - 91961) <= 2, 'overtime amount');
  assert.ok(Math.abs(rupees(slip.earnings.gazettedHolidayPay) - 32600) <= 2, 'salary in lieu of gazetted holidays');
  assert.strictEqual(rupees(slip.deductions.socialSecurity), 310, 'EOBI');
  assert.strictEqual(rupees(slip.deductions.incomeTax), 0, 'below the tax threshold');
  assert.ok(Math.abs(rupees(slip.deductions.total - slip.deductions.attendanceTotal) - 14219) <= 1, 'total deductions (excluding absence, as a salary sheet shows them)');
  assert.ok(Math.abs(rupees(slip.netPay) - 145498) <= 3, 'net payable');
});

test('executive salary sheet: absent days cost 1/26 each and executives earn no overtime', () => {
  const slip = computePayslip({
    employee: { employeeCategory: 'executive', shiftType: 'general', compensation: { baseSalary: 230000, currency: 'PKR', fixedAllowances: [] } },
    period: month,
    attendance: { presentDays: 20, absentDays: 6, overtimeHours: 40, recordedDays: 20 },
    variable: { incentive: 353800 },
  });

  assert.ok(Math.abs(rupees(slip.earnings.adjustedGross) - 176923) <= 1, 'adjusted gross');
  assert.strictEqual(slip.earnings.overtimePay, 0);
  assert.ok(Math.abs(rupees(slip.earnings.gross - slip.deductions.attendanceTotal) - 180461) <= 1, 'total salary');
  assert.strictEqual(slip.attendance.paymentDays, 20);
  assert.ok(slip.warnings.some((w) => /earns no overtime/.test(w)));
});

test('recoveries never push net pay below zero', () => {
  const slip = computePayslip({
    employee: { employeeCategory: 'worker', shiftType: 'general', compensation: { baseSalary: 30000, currency: 'PKR', fixedAllowances: [] } },
    period: month,
    attendance: { presentDays: 26, recordedDays: 26 },
    variable: { loanRecovery: 9000000 },
  });
  assert.ok(slip.netPay >= 0);
  assert.ok(slip.warnings.some((w) => /could not be fully recovered/.test(w)));
});

test('salaried income tax follows the slabs', () => {
  const slip = computePayslip({
    employee: { employeeCategory: 'executive', shiftType: 'general', compensation: { baseSalary: 200000, currency: 'PKR', fixedAllowances: [] } },
    period: month,
    attendance: { presentDays: 26, recordedDays: 26 },
  });
  // annual taxable = (200000 - 310) x 12 = 2,396,280 -> 6,000 + 110,000 + 23% x 196,280
  const annual = 6000 + 110000 + Math.round(0.23 * (2396280 - 2200000));
  assert.ok(Math.abs(slip.incomeTaxDetail.annualTax / 100 - annual) <= 5);
});
