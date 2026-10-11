'use strict';

const test = require('node:test');
const assert = require('node:assert');
const imp = require('../src/services/attendanceImport.service');
const { buildMonth, monthRange } = require('../src/services/attendance.service');
const { computePayslip } = require('../src/services/payroll.service');
const z = require('../src/utils/zoned');

test('device exports are read in the layouts clocks actually produce', () => {
  assert.strictEqual(imp.parseDateKey('2026-10-05'), '2026-10-05');
  assert.strictEqual(imp.parseDateKey('05/10/2026'), '2026-10-05');
  assert.strictEqual(imp.parseDateKey('05-OCT-2026'), '2026-10-05');
  assert.strictEqual(imp.parseDateKey('31/02/2026'), null);
  assert.strictEqual(imp.parseClock('09:05:33'), '09:05');
  assert.strictEqual(imp.parseClock('9:05 PM'), '21:05');
  assert.strictEqual(imp.parseClock('12:30 AM'), '00:30');
  assert.strictEqual(imp.parseClock('25:00'), null);
  assert.strictEqual(imp.parseDirection('Check-In'), 'in');
  assert.strictEqual(imp.parseDirection('C/Out'), 'out');
  assert.strictEqual(imp.parseDirection(''), 'auto');
});

test('a bare time is read on the company clock; an explicit offset is respected', () => {
  const local = imp.parseMoment({ 'Emp Code': 'A1', 'Date Time': '2026-10-05 09:00:12' });
  assert.strictEqual(local.toISOString(), z.zonedTime('2026-10-05', '09:00', 'Asia/Karachi').toISOString());
  const split = imp.parseMoment({ code: 'A1', date: '05/10/2026', time: '18:30' });
  assert.strictEqual(split.toISOString(), z.zonedTime('2026-10-05', '18:30', 'Asia/Karachi').toISOString());
  const utc = imp.parseMoment({ code: 'A1', timestamp: '2026-10-05T04:00:00Z' });
  assert.strictEqual(utc.toISOString(), '2026-10-05T04:00:00.000Z');
  assert.strictEqual(imp.parseMoment({ code: 'A1' }), null);
});

const employee = { dateOfJoining: new Date('2026-01-01'), restDays: ['sunday'], shiftType: 'general' };
const range = monthRange('2026-09');
const rec = (date, extra) => Object.assign({ date: new Date(`${date}T00:00:00Z`), shiftStatus: 'present', timeIn: new Date(`${date}T04:00:00Z`), timeOut: new Date(`${date}T13:00:00Z`), hoursWorked: 8, overtimeHours: 0, shortfallHours: 0, flags: [] }, extra);

test('month view: missed punches, lateness and exempt staff', () => {
  const records = [
    rec('2026-09-01'),
    rec('2026-09-02', { lateMinutes: 25 }),
    rec('2026-09-03', { timeOut: null, flags: ['missed_punch'], hoursWorked: 0 }),
  ];
  const { days, summary } = buildMonth(employee, range, records, new Date('2026-09-10T12:00:00Z'));
  assert.strictEqual(days[2].status, 'missing_punch');
  assert.strictEqual(summary.missedPunchDays, 1);
  assert.strictEqual(summary.lateCount, 1);
  assert.strictEqual(summary.lateMinutes, 25);
  assert.ok(summary.absentDays >= 4); // 4-9 Sep minus the Sunday are working days with no record

  const exempt = buildMonth(Object.assign({}, employee, { attendanceMode: 'exempt' }), range, [], new Date('2026-09-10T12:00:00Z'));
  assert.strictEqual(exempt.summary.absentDays, 0);
  assert.ok(exempt.summary.presentDays >= 7);
});

test('payroll: a missed punch is counted as absent and flagged; late marks can cost pay', () => {
  const period = { month: '2026-09', calendarDays: 30, workingDays: 26, employedWorkingDays: 26, isComplete: true };
  const emp = { employeeCategory: 'non_executive', shiftType: 'general', compensation: { baseSalary: 26000, currency: 'PKR', fixedAllowances: [] } };
  const base = computePayslip({ employee: emp, period, attendance: { presentDays: 24, absentDays: 2, recordedDays: 24 } });
  const slip = computePayslip({ employee: emp, period, attendance: { presentDays: 24, absentDays: 3, missedPunchDays: 1, lateCount: 6, latePenaltyDays: 1, recordedDays: 24 } });
  // 1000 a day: two more days of loss than the baseline (one extra absence is already in absentDays)
  assert.strictEqual(slip.deductions.absence - base.deductions.absence, 100000);
  assert.strictEqual(slip.deductions.latePenalty, 100000);
  assert.ok(slip.warnings.some((w) => /missed punch/.test(w)));
  assert.ok(slip.warnings.some((w) => /late arrival/.test(w)));
});
