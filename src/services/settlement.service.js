'use strict';

/**
 * Full-and-final settlement for a leaver. `computeSettlement` is pure — the same
 * inputs always give the same bill — and `prepare` gathers those inputs from
 * the rest of the system.
 */

const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const Employment = require('../models/Employment');
const Person = require('../models/Person');
const Loan = require('../models/Loan');
const Payslip = require('../models/Payslip');
const ExitTask = require('../models/ExitTask');
const FinalSettlement = require('../models/FinalSettlement');
const ApiError = require('../utils/ApiError');
const { toMinor, toMajor, multiply, divide, sum } = require('../utils/money');
const { SETTLEMENT } = require('../config/settlement');
const { STATUS_LABELS } = require('../config/settlement');
const { SEPARATION_TYPE_LABELS } = require('../config/org');
const { WEEKDAY_LABELS } = require('../config/hr');
const { attendanceDate } = require('./attendance.service');
const { gatherAttendance } = require('./payroll.service');
const { outstandingAfter } = require('./loanMath');
const leave = require('./leave.service');

const round2 = (value) => Math.round(value * 100) / 100;

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Whole years and remaining months between two dates (relieving day included). */
function serviceLength(from, to) {
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() + 1 < from.getUTCDate()) months -= 1;
  months = Math.max(0, months);
  return { years: Math.floor(months / 12), months: months % 12 };
}

/** The part of the leave year served, 0..1, for accruing entitlements. */
function accrualFraction(joined, relieved) {
  const year = relieved.getUTCFullYear();
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));
  const from = joined && joined > start ? joined : start;
  const served = Math.max(0, Math.round((relieved - from) / 86400000) + 1);
  return Math.min(1, served / Math.round((end - start) / 86400000));
}

function lines(list, label) {
  return (list || [])
    .map((row) => ({ label: String(row.label || '').trim(), amount: toMinor(row.amount) }))
    .filter((row) => row.label || row.amount)
    .map((row) => {
      if (!row.label) throw ApiError.badRequest(`Give every ${label} a description`);
      if (row.amount < 0) throw ApiError.badRequest(`A ${label} amount cannot be negative`);
      return row;
    });
}

/**
 * input: {
 *   gross, divisor, attendanceDays, leaveRows[{leaveType,label,entitlement,taken}],
 *   fraction, longServiceAllowance, longServiceDeduction, shortTermLoan,
 *   excessPaidSalary, additions[], others[]
 * }   — money in minor units
 */
function computeSettlement(input, policy) {
  const cfg = policy || SETTLEMENT;
  const divisor = input.divisor || cfg.dayDivisor;
  const perDayRate = divide(input.gross, divisor);
  const attendanceDays = Math.max(0, Number(input.attendanceDays) || 0);
  const adjustedGross = multiply(input.gross, Math.min(attendanceDays, divisor) / divisor);
  const longServiceAllowance = Math.max(0, Math.round(input.longServiceAllowance || 0));
  const netSalaryPayable = adjustedGross + longServiceAllowance;

  const leaveLines = [];
  let encashDays = 0;
  let excessDays = 0;
  (input.leaveRows || []).forEach((row) => {
    // Only this year's own entitlement accrues month by month; days carried in
    // or credited by HR are already earned.
    const fixed = (row.carried || 0) + (row.adjusted || 0);
    const fraction = input.fraction === undefined ? 1 : input.fraction;
    const accrued = round2(cfg.accrueByMonth ? (row.entitlement - fixed) * fraction + fixed : row.entitlement);
    const balance = round2(accrued - row.taken);
    const relevant = cfg.encashableLeaveTypes.includes(row.leaveType) || row.taken > 0 || balance < 0;
    if (relevant) leaveLines.push({ leaveType: row.leaveType, label: row.label, accruedDays: accrued, takenDays: row.taken, balanceDays: balance });
    if (balance > 0 && cfg.encashableLeaveTypes.includes(row.leaveType)) encashDays += balance;
    if (balance < 0 && !cfg.recoveryExemptLeaveTypes.includes(row.leaveType)) excessDays += -balance;
  });
  encashDays = round2(encashDays);
  excessDays = round2(excessDays);

  const leaveEncashment = multiply(perDayRate, encashDays);
  const excessLeaveRecovery = multiply(perDayRate, excessDays);
  const additions = input.additions || [];
  const finalSettlement = netSalaryPayable + leaveEncashment + sum(additions.map((a) => a.amount));

  const longServiceDeduction = Math.max(0, Math.round(input.longServiceDeduction || 0));
  const shortTermLoan = Math.max(0, Math.round(input.shortTermLoan || 0));
  const excessPaidSalary = Math.max(0, Math.round(input.excessPaidSalary || 0));
  const others = input.others || [];
  const totalDeductions =
    longServiceDeduction + shortTermLoan + excessPaidSalary + excessLeaveRecovery + sum(others.map((o) => o.amount));

  return {
    perDayRate,
    adjustedGross,
    netSalaryPayable,
    longServiceAllowance,
    leave: leaveLines,
    leaveEncashmentDays: encashDays,
    leaveEncashment,
    additions,
    finalSettlement,
    deductions: {
      longServiceDeduction,
      shortTermLoan,
      excessPaidSalary,
      excessLeaveDays: excessDays,
      excessLeaveRecovery,
      others,
      total: totalDeductions,
    },
    netPayable: finalSettlement - totalDeductions,
  };
}

/* ---------------- presentation ---------------- */

const MONEY_TOP = ['unadjustedGross', 'adjustedGross', 'longServiceAllowance', 'netSalaryPayable', 'perDayRate', 'leaveEncashment', 'finalSettlement', 'netPayable'];
const MONEY_DED = ['longServiceDeduction', 'shortTermLoan', 'excessPaidSalary', 'excessLeaveRecovery', 'total'];

function present(doc) {
  const json = doc.toJSON();
  json.id = String(json.id || json._id);
  MONEY_TOP.forEach((key) => { json[key] = toMajor(json[key]); });
  MONEY_DED.forEach((key) => { json.deductions[key] = toMajor(json.deductions[key]); });
  json.additions = (json.additions || []).map((row) => ({ label: row.label, amount: toMajor(row.amount) }));
  json.deductions.others = (json.deductions.others || []).map((row) => ({ label: row.label, amount: toMajor(row.amount) }));
  json.statusLabel = STATUS_LABELS[json.status];
  json.owedByEmployee = json.netPayable < 0;
  return json;
}

/* ---------------- orchestration ---------------- */

async function nextRequestNo(year) {
  const rows = await FinalSettlement.find({ requestNo: new RegExp(`^FS-${year}-`) }).select('requestNo');
  const max = rows.reduce((top, row) => Math.max(top, Number(row.requestNo.split('-')[2]) || 0), 0);
  return `FS-${year}-${String(max + 1).padStart(4, '0')}`;
}

async function gather(employee, body) {
  if (!['resigned', 'terminated', 'notice_period'].includes(employee.employmentStatus) || !employee.lastWorkingDay) {
    throw ApiError.badRequest('Separate the employee in Core HR (with a last working day) before preparing a settlement');
  }
  const relieved = attendanceDate(employee.lastWorkingDay);
  const finalMonth = monthKey(relieved);
  const monthStart = new Date(Date.UTC(relieved.getUTCFullYear(), relieved.getUTCMonth(), 1));
  const range = { month: finalMonth, start: monthStart, end: new Date(relieved.getTime() + 86400000) };

  const [attendance, balances, loans, payslip, person, employment] = await Promise.all([
    gatherAttendance(employee, range),
    leave.balancesFor(employee, relieved.getUTCFullYear()),
    Loan.find({ employee: employee._id, status: 'approved' }),
    Payslip.findOne({ employee: employee._id, month: finalMonth, status: { $in: ['finalised', 'paid'] } }),
    employee.person ? Person.findById(employee.person) : null,
    employee.employment ? Employment.findById(employee.employment) : null,
  ]);

  const gross = toMinor((employee.compensation && employee.compensation.baseSalary) || 0) +
    toMinor(((employee.compensation && employee.compensation.fixedAllowances) || []).reduce((t, a) => t + (Number(a.amount) || 0), 0));
  const attendanceDays = (attendance.presentDays || 0) + (attendance.shortDays || 0) + (attendance.leaveDays || 0) + (attendance.holidayDays || 0);

  const manual = body || {};
  const autoLoan = loans.reduce((total, loan) => total + outstandingAfter(loan, finalMonth), 0);
  const autoPaid = payslip ? payslip.earnings.adjustedGross || 0 : 0;
  const pick = (key, auto) => (manual[key] === undefined || manual[key] === null || manual[key] === '' ? auto : toMinor(manual[key]));

  const warnings = [];
  if (autoPaid) warnings.push(`The ${finalMonth} payslip is already ${payslip.status}; its adjusted pay is recovered here so the month is not paid twice.`);
  if (autoLoan) warnings.push('An outstanding salary loan balance is deducted from this settlement.');
  if (!attendance.recordedDays && !attendanceDays) warnings.push('No attendance was recorded for the final month, so no salary is payable for it.');

  const computed = computeSettlement({
    gross,
    attendanceDays,
    fraction: accrualFraction(employee.dateOfJoining ? attendanceDate(employee.dateOfJoining) : null, relieved),
    leaveRows: balances
      .filter((row) => row.entitlementDays > 0 || row.takenDays > 0)
      .map((row) => ({
        leaveType: row.code,
        label: row.label,
        entitlement: row.entitlementDays,
        carried: row.carriedDays,
        adjusted: row.adjustedDays,
        taken: row.takenDays,
      })),
    longServiceAllowance: pick('longServiceAllowance', 0),
    longServiceDeduction: pick('longServiceDeduction', 0),
    shortTermLoan: pick('shortTermLoan', autoLoan),
    excessPaidSalary: pick('excessPaidSalary', autoPaid),
    additions: lines(manual.additions, 'addition'),
    others: lines(manual.otherDeductions, 'deduction'),
  });

  const service = serviceLength(
    employee.dateOfJoining ? attendanceDate(employee.dateOfJoining) : relieved,
    relieved
  );
  const restDay = (employee.restDays || []).map((day) => WEEKDAY_LABELS[day] || day).join(' & ');
  const national = person && (person.nationalIds || []).find((id) => id.type === 'cnic') || (person && person.nationalIds && person.nationalIds[0]);

  return {
    currency: (employee.compensation && employee.compensation.currency) || 'PKR',
    snapshot: {
      employeeCode: employee.employeeCode,
      fullName: employee.fullName,
      fatherName: (person && person.fatherName) || '',
      nationalId: (national && (national.number || national.value)) || '',
      designation: employee.designation,
      department: employee.department,
      team: employee.team,
      address: employee.address || '',
      dateOfJoining: employee.dateOfJoining,
      dateOfRelieving: relieved,
      quitReason: SEPARATION_TYPE_LABELS[(employment && employment.separationType) || ''] || employee.employmentStatus,
      serviceYears: service.years,
      serviceMonths: service.months,
    },
    days: {
      month: finalMonth,
      restDay,
      skipDays: 0,
      absentDays: attendance.absentDays || 0,
      withoutPayLeaveDays: attendance.lwpDays || 0,
      attendanceDays,
    },
    unadjustedGross: gross,
    ...computed,
    warnings,
  };
}

async function prepare(employeeId, body, user) {
  if (!mongoose.isValidObjectId(employeeId)) throw ApiError.notFound('Employee not found');
  const employee = await Employee.findById(employeeId);
  if (!employee) throw ApiError.notFound('Employee not found');

  const existing = await FinalSettlement.findOne({ employee: employee._id }).sort({ createdAt: -1 });
  if (existing && existing.status !== 'draft') {
    throw ApiError.conflict(`A ${existing.status} settlement (${existing.requestNo}) already exists for this employee`);
  }

  const data = await gather(employee, body);
  const actor = `${user.firstName} ${user.lastName}`.trim();
  const fields = {
    ...data,
    notes: String((body && body.notes) || '').slice(0, 400),
    preparedBy: user._id,
    preparedByName: actor,
  };

  let row = existing;
  if (row) {
    row.set(fields);
    await row.save();
  } else {
    row = await FinalSettlement.create({
      ...fields,
      employee: employee._id,
      requestNo: await nextRequestNo(new Date().getFullYear()),
    });
  }
  return present(row);
}

async function setStatus(id, next, body, user) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Settlement not found');
  const row = await FinalSettlement.findById(id);
  if (!row) throw ApiError.notFound('Settlement not found');
  const allowed = SETTLEMENT.transitions[row.status] || [];
  if (!allowed.includes(next)) {
    throw ApiError.conflict(allowed.length ? `A ${row.status} settlement can only move to: ${allowed.join(', ')}` : `A ${row.status} settlement cannot be changed`);
  }

  if (next === 'approved') {
    row.approvedBy = user._id;
    row.approvedByName = `${user.firstName} ${user.lastName}`.trim();
    row.approvedAt = new Date();
  }
  if (next === 'draft') {
    row.approvedBy = null;
    row.approvedByName = '';
    row.approvedAt = null;
  }
  if (next === 'paid') {
    row.paidAt = new Date();
    row.paymentRef = String((body && body.paymentRef) || '').trim().slice(0, 80);
    await ExitTask.updateOne(
      { employee: row.employee, key: 'final_settlement' },
      { $set: { status: 'done', doneAt: new Date(), doneBy: user._id, note: `Settlement ${row.requestNo}` } }
    );
  }
  row.status = next;
  await row.save();
  return present(row);
}

async function list(query) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.employee && mongoose.isValidObjectId(query.employee)) filter.employee = query.employee;
  const rows = await FinalSettlement.find(filter).sort({ createdAt: -1 }).limit(100);
  return rows.map(present);
}

async function getOne(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Settlement not found');
  const row = await FinalSettlement.findById(id);
  if (!row) throw ApiError.notFound('Settlement not found');
  return present(row);
}

/** Separated employees who have no settlement yet — the "to do" list. */
async function pending() {
  const done = await FinalSettlement.find({}).select('employee');
  const has = new Set(done.map((row) => String(row.employee)));
  const leavers = await Employee.find({ employmentStatus: { $in: ['resigned', 'terminated', 'notice_period'] }, lastWorkingDay: { $ne: null } })
    .select('employeeCode firstName lastName designation department lastWorkingDay employmentStatus')
    .sort({ lastWorkingDay: -1 });
  return leavers
    .filter((employee) => !has.has(String(employee._id)))
    .map((employee) => ({
      id: String(employee._id),
      employeeCode: employee.employeeCode,
      fullName: employee.fullName,
      designation: employee.designation,
      department: employee.department,
      lastWorkingDay: employee.lastWorkingDay,
      status: employee.employmentStatus,
    }));
}

module.exports = { computeSettlement, serviceLength, accrualFraction, prepare, setStatus, list, getOne, pending };
