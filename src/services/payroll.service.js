'use strict';

const { WEEKDAYS } = require('../config/hr');
const { PAYROLL, ENGINE_VERSION } = require('../config/payroll');
const { attendanceDate, weekdayKey, shiftFor } = require('./attendance.service');
const { toMinor, multiply, divide, sum, roundMinor } = require('../utils/money');

/**
 * Counts the days that matter for a month's pay.
 *
 * `workingDays` is the divisor for the daily rate: every day of the month the
 * employee is rostered for, whether or not they turned up. `employedWorkingDays`
 * excludes days before they joined, which is what prorates a mid-month starter.
 */
function buildPeriod(employee, range, now) {
  const restDays = employee.restDays || [];
  const joined = employee.dateOfJoining ? attendanceDate(employee.dateOfJoining) : null;
  const today = attendanceDate(now);

  let calendarDays = 0;
  let workingDays = 0;
  let employedWorkingDays = 0;

  for (
    let cursor = new Date(range.start);
    cursor < range.end;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const date = new Date(cursor);
    calendarDays += 1;
    if (restDays.indexOf(weekdayKey(date)) !== -1) continue;

    workingDays += 1;
    if (!joined || date >= joined) employedWorkingDays += 1;
  }

  return {
    month: range.month,
    start: range.start,
    end: range.end,
    calendarDays,
    workingDays,
    employedWorkingDays,
    /** False while the month still has days to come, so figures may yet change. */
    isComplete: today >= attendanceDate(new Date(range.end.getTime() - 86400000)),
  };
}

/**
 * Progressive income tax.
 *
 * A month's taxable pay is annualised, taxed band by band, and the resulting
 * annual charge is divided back by twelve. Taxing the monthly figure directly
 * against annual bands would put everyone in the lowest band.
 */
function annualisedIncomeTax(monthlyTaxableMinor, bands) {
  const annualTaxable = Math.max(0, monthlyTaxableMinor) * 12;

  let lowerBound = 0;
  let annualTax = 0;
  const breakdown = [];

  for (const band of bands) {
    if (annualTaxable <= lowerBound) break;

    const upperBound = band.upTo === null ? Infinity : toMinor(band.upTo);
    const taxable = Math.min(annualTaxable, upperBound) - lowerBound;
    const tax = roundMinor(taxable * band.rate);

    breakdown.push({
      from: lowerBound,
      to: isFinite(upperBound) ? upperBound : null,
      rate: band.rate,
      taxable,
      tax,
    });

    annualTax += tax;
    lowerBound = upperBound;
    if (!isFinite(upperBound)) break;
  }

  return {
    annualTaxable,
    annual: annualTax,
    monthly: divide(annualTax, 12),
    bands: breakdown,
  };
}

/**
 * Produces a complete payslip from an employee record, the month's calendar and
 * the month's attendance totals.
 *
 * Pure: no database, no clock, no configuration lookups beyond what is passed
 * in — the same inputs always produce the same payslip, which is what makes a
 * payroll run auditable and re-runnable.
 *
 * EVERY amount returned is an integer number of minor units (cents).
 */
function computePayslip(input) {
  const employee = input.employee;
  const period = input.period;
  const attendance = input.attendance || {};
  const config = input.config || PAYROLL;
  const warnings = [];

  const compensation = employee.compensation || {};
  const currency = compensation.currency || 'USD';

  // ---- Contracted pay, straight from Core HR ----
  const contractedBasic = toMinor(compensation.baseSalary);
  const contractedAllowances = (compensation.fixedAllowances || []).map((allowance) => ({
    label: allowance.label,
    amount: toMinor(allowance.amount),
  }));
  const contractedGross = contractedBasic + sum(contractedAllowances.map((a) => a.amount));

  // ---- Rates, published on the payslip so the figures can be checked by hand ----
  const shift = shiftFor(employee.shiftType);
  const hoursPerDay =
    config.hourlyRateBasis === 'shift'
      ? shift.expectedHours || config.standardHoursPerDay
      : config.standardHoursPerDay;

  const perDayWage = divide(contractedGross, period.workingDays);
  const hourlyRate = divide(perDayWage, hoursPerDay);
  const overtimeRate = multiply(hourlyRate, config.overtimeMultiplier);

  if (!period.workingDays) {
    warnings.push('This month has no rostered working days, so no daily rate could be derived.');
  }

  // ---- Earnings ----
  const proration = period.workingDays ? period.employedWorkingDays / period.workingDays : 0;
  const basic = multiply(contractedBasic, proration);
  const allowances = contractedAllowances.map((allowance) => ({
    label: allowance.label,
    amount: multiply(allowance.amount, proration),
  }));
  const totalAllowances = sum(allowances.map((a) => a.amount));

  const overtimeHours = Number(attendance.overtimeHours) || 0;
  const overtimePay = multiply(overtimeRate, overtimeHours);
  const grossEarnings = basic + totalAllowances + overtimePay;

  if (period.employedWorkingDays < period.workingDays) {
    warnings.push(
      `Salary prorated to ${period.employedWorkingDays} of ${period.workingDays} working days because the employee joined during the month.`
    );
  }

  // ---- Attendance deductions ----
  const absentDays = Number(attendance.absentDays) || 0;
  const shortfallHours = Number(attendance.shortfallHours) || 0;
  const lwpDays = Number(attendance.lwpDays) || 0;

  let absence = multiply(perDayWage, absentDays);
  let shortDay = multiply(hourlyRate, shortfallHours);
  let lwp = multiply(perDayWage, lwpDays);
  let attendanceDeductions = absence + shortDay + lwp;

  // Pay can fall to zero but never below it, and the two lines must still add
  // up to the capped total, so the surplus is taken off proportionally.
  if (attendanceDeductions > grossEarnings) {
    warnings.push(
      'Attendance deductions exceeded gross earnings and have been capped, leaving net pay at zero.'
    );
    absence = multiply(absence, grossEarnings / attendanceDeductions);
    shortDay = multiply(shortDay, grossEarnings / attendanceDeductions);
    lwp = grossEarnings - absence - shortDay;
    attendanceDeductions = grossEarnings;
  }

  if (!attendance.recordedDays) {
    warnings.push(
      'No attendance was recorded for this month, so every working day counts as an unpaid absence.'
    );
  }
  if (attendance.inProgressDays) {
    warnings.push(
      `${attendance.inProgressDays} day(s) were clocked into but never clocked out, so they have been neither paid nor deducted.`
    );
  }
  if (!period.isComplete) {
    warnings.push('The month is not over yet — these figures will change as more days are worked.');
  }

  // ---- Statutory deductions ----
  const taxableGross = grossEarnings - attendanceDeductions;

  const ceiling = toMinor(config.socialSecurity.monthlyCeiling);
  const socialSecurityBase = Math.min(taxableGross, ceiling);
  const socialSecurity = multiply(socialSecurityBase, config.socialSecurity.rate);

  const incomeTaxBase = taxableGross - socialSecurity;
  const incomeTax = annualisedIncomeTax(incomeTaxBase, config.incomeTax.annualBands);

  const totalDeductions = attendanceDeductions + socialSecurity + incomeTax.monthly;
  const netPay = grossEarnings - totalDeductions;

  return {
    engineVersion: ENGINE_VERSION,
    currency,
    /** The contract as it stood at run time, kept for the payslip snapshot. */
    contracted: {
      basic: contractedBasic,
      allowances: contractedAllowances,
      gross: contractedGross,
    },
    period: {
      month: period.month,
      calendarDays: period.calendarDays,
      workingDays: period.workingDays,
      employedWorkingDays: period.employedWorkingDays,
      isComplete: period.isComplete,
    },
    attendance: {
      presentDays: Number(attendance.presentDays) || 0,
      shortDays: Number(attendance.shortDays) || 0,
      absentDays,
      leaveDays: Number(attendance.leaveDays) || 0,
      lwpDays,
      restDays: Number(attendance.restDays) || 0,
      recordedDays: Number(attendance.recordedDays) || 0,
      inProgressDays: Number(attendance.inProgressDays) || 0,
      hoursWorked: Number(attendance.hoursWorked) || 0,
      overtimeHours,
      shortfallHours,
    },
    rates: {
      hoursPerDay,
      perDayWage,
      hourlyRate,
      overtimeRate,
      overtimeMultiplier: config.overtimeMultiplier,
      prorationFactor: proration,
    },
    earnings: {
      basic,
      allowances,
      totalAllowances,
      overtimePay,
      gross: grossEarnings,
    },
    deductions: {
      absence,
      shortDay,
      lwp,
      attendanceTotal: attendanceDeductions,
      socialSecurity,
      socialSecurityBase,
      socialSecurityRate: config.socialSecurity.rate,
      incomeTax: incomeTax.monthly,
      total: totalDeductions,
    },
    incomeTaxDetail: {
      annualTaxable: incomeTax.annualTaxable,
      annualTax: incomeTax.annual,
      bands: incomeTax.bands,
    },
    taxableGross,
    netPay,
    warnings,
  };
}

/**
 * Attendance totals the payroll engine consumes for one employee and month.
 * Kept here so a retro simulation uses the same inputs as a live run.
 */
async function gatherAttendance(employee, range) {
  const Attendance = require('../models/Attendance');
  const leave = require('./leave.service');
  const { buildMonth } = require('./attendance.service');

  const records = await Attendance.find({
    employee: employee._id,
    date: { $gte: range.start, $lt: range.end },
  }).sort({ date: 1 });

  const { summary } = buildMonth(employee, range, records, new Date());
  const lwpDays = await leave.lwpDaysInRange(employee, range);
  return Object.assign({}, summary, {
    recordedDays: records.length,
    lwpDays,
    leaveDays: Math.max(0, (summary.leaveDays || 0) - lwpDays),
  });
}

module.exports = { buildPeriod, annualisedIncomeTax, computePayslip, gatherAttendance, WEEKDAYS };
