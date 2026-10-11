'use strict';

/** Month-specific pay items (incentives, mess bills, ...) and the salary register built from payslips. */

const PayrollInput = require('../models/PayrollInput');
const Payslip = require('../models/Payslip');
const Employee = require('../models/Employee');
const ApiError = require('../utils/ApiError');
const { toMinor, toMajor } = require('../utils/money');
const { monthRange } = require('./attendance.service');

const MONEY_KEYS = ['incentive', 'medicalAllowance', 'otherEarnings', 'messCharges', 'otherDeductions'];

function amount(value, label) {
  if (value === undefined || value === null || value === '') return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw ApiError.badRequest(`${label} must be zero or a positive number`);
  return toMinor(number);
}

function present(row) {
  const json = row.toJSON();
  const out = { id: String(json.id || json._id), employee: String(json.employee), month: json.month, note: json.note || '' };
  MONEY_KEYS.forEach((key) => {
    out[key] = toMajor(json[key] || 0);
  });
  out.gazettedHolidayHours =
    json.gazettedHolidayHours === null || json.gazettedHolidayHours === undefined ? null : json.gazettedHolidayHours;
  return out;
}

async function assertOpen(employeeId, month) {
  const slip = await Payslip.findOne({ employee: employeeId, month }).select('status');
  if (slip && slip.status !== 'draft') {
    throw ApiError.conflict(`The ${month} payslip is already ${slip.status}. Reopen it before changing its inputs.`);
  }
}

async function save(body, user) {
  const range = monthRange(body.month);
  if (!range) throw ApiError.badRequest('Pay period must be in YYYY-MM format');
  const employee = await Employee.findById(body.employee);
  if (!employee) throw ApiError.notFound('Employee not found');
  await assertOpen(employee._id, range.month);

  const fields = { updatedBy: user._id, note: String(body.note || '').slice(0, 200) };
  fields.incentive = amount(body.incentive, 'Incentive');
  fields.medicalAllowance = amount(body.medicalAllowance, 'Medical allowance');
  fields.otherEarnings = amount(body.otherEarnings, 'Other earnings');
  fields.messCharges = amount(body.messCharges, 'Mess charges');
  fields.otherDeductions = amount(body.otherDeductions, 'Other deductions');
  if (body.gazettedHolidayHours === undefined || body.gazettedHolidayHours === null || body.gazettedHolidayHours === '') {
    fields.gazettedHolidayHours = null;
  } else {
    const hours = Number(body.gazettedHolidayHours);
    if (!Number.isFinite(hours) || hours < 0 || hours > 400) throw ApiError.badRequest('Gazetted-holiday hours must be between 0 and 400');
    fields.gazettedHolidayHours = hours;
  }

  const row = await PayrollInput.findOneAndUpdate(
    { employee: employee._id, month: range.month },
    { $set: fields },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return present(row);
}

async function list(month) {
  const range = monthRange(month);
  if (!range) throw ApiError.badRequest('Pay period must be in YYYY-MM format');
  const [employees, rows, slips] = await Promise.all([
    Employee.find({ dateOfJoining: { $lt: range.end }, employmentStatus: { $nin: ['terminated'] } })
      .select('employeeCode firstName lastName designation department employeeCategory')
      .sort({ firstName: 1, lastName: 1 }),
    PayrollInput.find({ month: range.month }),
    Payslip.find({ month: range.month }).select('employee status'),
  ]);
  const byEmployee = new Map(rows.map((row) => [String(row.employee), row]));
  const status = new Map(slips.map((slip) => [String(slip.employee), slip.status]));
  return employees.map((employee) => ({
    employee: String(employee._id),
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    designation: employee.designation,
    department: employee.department,
    payslipStatus: status.get(String(employee._id)) || null,
    input: byEmployee.has(String(employee._id)) ? present(byEmployee.get(String(employee._id))) : null,
  }));
}

/** Rows keyed by employee code, as pasted from a spreadsheet. Reports what it could not apply. */
async function importRows(month, rows, user) {
  const range = monthRange(month);
  if (!range) throw ApiError.badRequest('Pay period must be in YYYY-MM format');
  if (!Array.isArray(rows) || !rows.length) throw ApiError.badRequest('There are no rows to import');
  if (rows.length > 2000) throw ApiError.badRequest('Import at most 2,000 rows at a time');

  const codes = rows.map((row) => String(row.employeeCode || '').trim().toUpperCase()).filter(Boolean);
  const employees = await Employee.find({ employeeCode: { $in: codes } }).select('employeeCode');
  const byCode = new Map(employees.map((employee) => [employee.employeeCode, employee]));

  const applied = [];
  const failed = [];
  for (const row of rows) {
    const code = String(row.employeeCode || '').trim().toUpperCase();
    const employee = byCode.get(code);
    if (!employee) {
      failed.push({ employeeCode: code || '(blank)', reason: 'No employee with this code' });
      continue;
    }
    try {
      await save({ ...row, employee: employee._id, month: range.month }, user);
      applied.push(code);
    } catch (err) {
      failed.push({ employeeCode: code, reason: err.message });
    }
  }
  return { month: range.month, applied: applied.length, failed };
}

/** One row per payslip, laid out like the monthly salary sheet. Money in major units. */
async function register(month) {
  const range = monthRange(month);
  if (!range) throw ApiError.badRequest('Pay period must be in YYYY-MM format');
  const slips = await Payslip.find({ month: range.month }).sort({ 'snapshot.employeeCode': 1 });
  const employees = await Employee.find({ _id: { $in: slips.map((slip) => slip.employee) } }).select(
    'grade team department employeeCategory'
  );
  const meta = new Map(employees.map((employee) => [String(employee._id), employee]));

  const rows = slips.map((slip, index) => {
    const e = meta.get(String(slip.employee)) || {};
    const earn = slip.earnings || {};
    const ded = slip.deductions || {};
    const att = slip.attendance || {};
    const totalSalary = (earn.gross || 0) - (ded.attendanceTotal || 0);
    const otherThanAbsence = (ded.total || 0) - (ded.attendanceTotal || 0);
    return {
      sr: index + 1,
      employeeCode: slip.snapshot.employeeCode,
      name: slip.snapshot.fullName,
      position: slip.snapshot.designation,
      grade: e.grade || '',
      department: slip.snapshot.department,
      status: slip.status,
      unadjustedGross: toMajor(slip.snapshot.contractedGross),
      workingDays: att.paymentDays,
      absentDays: att.absentDays,
      approvedLeaves: att.leaveDays,
      lwpDays: att.lwpDays,
      adjustedGross: toMajor(earn.adjustedGross),
      overtimeHours: att.overtimeHours,
      overtimeRate: toMajor(slip.rates && slip.rates.overtimeRate),
      overtimeAmount: toMajor(earn.overtimePay),
      gazettedHolidayHours: att.gazettedHolidayHours,
      gazettedHolidayPay: toMajor(earn.gazettedHolidayPay),
      totalOvertime: toMajor((earn.overtimePay || 0) + (earn.gazettedHolidayPay || 0)),
      medicalAllowance: toMajor(earn.medicalAllowance),
      incentive: toMajor(earn.incentive),
      otherEarnings: toMajor(earn.otherEarnings),
      totalSalary: toMajor(totalSalary),
      loanRecovery: toMajor(ded.loanRecovery),
      providentFund: toMajor(ded.providentFund),
      messCharges: toMajor(ded.messCharges),
      incomeTax: toMajor(ded.incomeTax),
      eobi: toMajor(ded.socialSecurity),
      otherDeductions: toMajor(ded.otherDeductions),
      totalDeductions: toMajor(otherThanAbsence),
      netPayable: toMajor(slip.netPay),
    };
  });

  const sumKeys = [
    'unadjustedGross', 'adjustedGross', 'overtimeAmount', 'gazettedHolidayPay', 'totalOvertime', 'medicalAllowance', 'incentive',
    'otherEarnings', 'totalSalary', 'loanRecovery', 'providentFund', 'messCharges', 'incomeTax', 'eobi', 'otherDeductions',
    'totalDeductions', 'netPayable',
  ];
  const totals = { headcount: rows.length };
  sumKeys.forEach((key) => {
    totals[key] = Math.round(rows.reduce((total, row) => total + (row[key] || 0), 0) * 100) / 100;
  });
  return { month: range.month, currency: slips[0] ? slips[0].currency : '', rows, totals };
}

module.exports = { save, list, importRows, register };
