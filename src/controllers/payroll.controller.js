'use strict';

const mongoose = require('mongoose');
const Payslip = require('../models/Payslip');
const Employee = require('../models/Employee');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/roles');
const { toMajor } = require('../utils/money');
const {
  resolveViewerEmployee,
  canViewSensitive,
  visibleEmployeeIds,
} = require('../services/employeeAccess');
const { monthRange } = require('../services/attendance.service');
const { buildPeriod, computePayslip, gatherAttendance, gatherVariable } = require('../services/payroll.service');
const arrears = require('../services/arrears.service');
const {
  STATUS_TRANSITIONS,
  STATUS_LABELS,
  metaPayload,
} = require('../config/payroll');
const audit = require('../services/audit.service');
const webhooks = require('../services/webhooks.service');

/**
 * Payslips are stored in minor units. These are the field names that hold
 * money, wherever they appear in the document, so the response can be converted
 * to major units in one pass instead of twenty hand-written assignments.
 */
const MONEY_FIELDS = new Set([
  'amount',
  'contractedBasic',
  'contractedGross',
  'perDayWage',
  'hourlyRate',
  'overtimeRate',
  'basic',
  'totalAllowances',
  'overtimePay',
  'gazettedHolidayPay',
  'medicalAllowance',
  'incentive',
  'otherEarnings',
  'adjustedGross',
  'providentFund',
  'loanRecovery',
  'messCharges',
  'otherDeductions',
  'gross',
  'absence',
  'shortDay',
  'lwp',
  'latePenalty',
  'attendanceTotal',
  'socialSecurity',
  'socialSecurityBase',
  'incomeTax',
  'total',
  'taxableGross',
  'netPay',
  'annualTaxable',
  'annualTax',
  'taxable',
  'tax',
  'from',
  'to',
]);

/**
 * Only plain objects are walked. ObjectIds and Dates are objects too, and
 * recursing into them would rebuild them as anonymous bags of internals.
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function toMajorDeep(value, key) {
  if (Array.isArray(value)) return value.map((item) => toMajorDeep(item, key));

  if (isPlainObject(value)) {
    return Object.keys(value).reduce((acc, childKey) => {
      acc[childKey] = toMajorDeep(value[childKey], childKey);
      return acc;
    }, {});
  }

  if (typeof value === 'number' && MONEY_FIELDS.has(key)) return toMajor(value);
  return value;
}

function present(payslip) {
  return toMajorDeep(payslip.toJSON(), null);
}

// ------------------------------------------------------------------- access

/** A draft is a working figure, not an approved one, so only HR may see it. */
function canSeeDrafts(user) {
  return user.role === ROLES.HR_ADMIN;
}

// ---------------------------------------------------------------- generation

/**
 * Runs the engine for one employee and writes the result.
 *
 * Re-running a month is deliberately safe: a draft is overwritten in place so a
 * correction in Core HR or Attendance can simply be re-generated, while an
 * approved payslip is left untouched and reported as skipped.
 */
async function generateFor(employee, range, user) {
  const existing = await Payslip.findOne({ employee: employee._id, month: range.month });

  if (existing && existing.status !== 'draft') {
    return {
      outcome: 'skipped',
      reason: `A ${STATUS_LABELS[existing.status].toLowerCase()} payslip already exists for ${range.month}`,
      payslip: existing,
    };
  }

  const [attendance, variable, period] = [
    await gatherAttendance(employee, range),
    await gatherVariable(employee, range),
    buildPeriod(employee, range, new Date()),
  ];
  const computed = computePayslip({ employee, period, attendance, variable });
  if (period.isComplete && !(await require('../services/attendanceOps.service').lockedMonths([`${range.month}-01`])).size) {
    computed.warnings.push('Attendance for this month is not locked yet, so these figures can still change.');
  }

  const fields = {
    employee: employee._id,
    month: range.month,
    currency: computed.currency,
    snapshot: {
      employeeCode: employee.employeeCode,
      fullName: employee.fullName,
      designation: employee.designation,
      department: employee.department,
      team: employee.team,
      employmentType: employee.employmentType,
      shiftType: employee.shiftType,
      dateOfJoining: employee.dateOfJoining,
      contractedBasic: computed.contracted.basic,
      contractedAllowances: computed.contracted.allowances,
      contractedGross: computed.contracted.gross,
    },
    period: computed.period,
    attendance: computed.attendance,
    rates: computed.rates,
    earnings: computed.earnings,
    deductions: computed.deductions,
    incomeTaxDetail: computed.incomeTaxDetail,
    taxableGross: computed.taxableGross,
    netPay: computed.netPay,
    warnings: computed.warnings,
    engineVersion: computed.engineVersion,
    status: 'draft',
    generatedBy: user._id,
    generatedAt: new Date(),
    finalisedAt: null,
    paidAt: null,
  };

  if (existing) {
    existing.set(fields);
    await existing.save();
    return { outcome: 'regenerated', payslip: existing };
  }

  const payslip = await Payslip.create(fields);
  return { outcome: 'created', payslip };
}

// ------------------------------------------------------------------- routes

/** GET /api/payroll/meta */
const meta = asyncHandler(async (_req, res) => {
  res.json({ success: true, meta: metaPayload() });
});

/** POST /api/payroll/generate */
const generate = asyncHandler(async (req, res) => {
  const range = monthRange((req.body || {}).month);
  if (!range) throw ApiError.badRequest('Pay period must be in YYYY-MM format');

  const requested = (req.body || {}).employee;
  let employees;

  if (requested) {
    if (!mongoose.isValidObjectId(requested)) throw ApiError.notFound('Employee not found');
    const employee = await Employee.findById(requested);
    if (!employee) throw ApiError.notFound('Employee not found');
    employees = [employee];
  } else {
    // Anyone who had joined by the end of the period earns for it, including
    // leavers — their final month still has to be paid.
    employees = await Employee.find({ dateOfJoining: { $lt: range.end } }).sort({
      firstName: 1,
      lastName: 1,
    });
  }

  if (!employees.length) {
    throw ApiError.badRequest(`No employees had joined by the end of ${range.month}`);
  }

  const results = [];
  for (const employee of employees) {
    results.push(await generateFor(employee, range, req.user));
  }

  const written = results.filter((result) => result.outcome !== 'skipped');
  const totals = written.reduce(
    (acc, result) => {
      acc.gross += result.payslip.earnings.gross;
      acc.deductions += result.payslip.deductions.total;
      acc.net += result.payslip.netPay;
      return acc;
    },
    { gross: 0, deductions: 0, net: 0 }
  );

  res.status(201).json({
    success: true,
    month: range.month,
    created: results.filter((r) => r.outcome === 'created').length,
    regenerated: results.filter((r) => r.outcome === 'regenerated').length,
    skipped: results
      .filter((r) => r.outcome === 'skipped')
      .map((r) => ({ employee: r.payslip.snapshot.fullName, reason: r.reason })),
    totals: {
      headcount: written.length,
      gross: toMajor(totals.gross),
      deductions: toMajor(totals.deductions),
      net: toMajor(totals.net),
    },
    payslips: written.map((result) => present(result.payslip)),
  });
});

/** GET /api/payroll */
const list = asyncHandler(async (req, res) => {
  const { month, employee, status } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));

  const filter = {};
  if (month) {
    if (!monthRange(month)) throw ApiError.badRequest('Pay period must be in YYYY-MM format');
    filter.month = month;
  }

  // The requested status is intersected with the ones the caller may see, never
  // substituted for them — asking for drafts must return nothing, not everything.
  let statuses = canSeeDrafts(req.user) ? null : ['finalised', 'paid'];
  if (status) statuses = statuses ? statuses.filter((value) => value === status) : [status];
  if (statuses) filter.status = { $in: statuses };

  const allowed = await visibleEmployeeIds(req.user);
  if (allowed) filter.employee = { $in: allowed };

  if (employee) {
    if (!mongoose.isValidObjectId(employee)) throw ApiError.notFound('Employee not found');
    if (allowed && !allowed.some((id) => String(id) === String(employee))) {
      throw ApiError.forbidden('You do not have access to this employee’s payslips');
    }
    filter.employee = new mongoose.Types.ObjectId(employee);
  }

  const [payslips, total, totals] = await Promise.all([
    Payslip.find(filter).sort({ month: -1, 'snapshot.fullName': 1 }).skip((page - 1) * limit).limit(limit),
    Payslip.countDocuments(filter),
    Payslip.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          gross: { $sum: '$earnings.gross' },
          overtime: { $sum: '$earnings.overtimePay' },
          deductions: { $sum: '$deductions.total' },
          tax: { $sum: '$deductions.incomeTax' },
          net: { $sum: '$netPay' },
        },
      },
    ]),
  ]);

  const totalsRow = totals[0] || { gross: 0, overtime: 0, deductions: 0, tax: 0, net: 0 };

  res.json({
    success: true,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit) || 1,
    totals: {
      headcount: total,
      gross: toMajor(totalsRow.gross),
      overtime: toMajor(totalsRow.overtime),
      deductions: toMajor(totalsRow.deductions),
      tax: toMajor(totalsRow.tax),
      net: toMajor(totalsRow.net),
    },
    payslips: payslips.map(present),
  });
});

/** GET /api/payroll/:id */
const getOne = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Payslip not found');

  const payslip = await Payslip.findById(req.params.id);
  if (!payslip) throw ApiError.notFound('Payslip not found');

  if (req.user.role !== ROLES.HR_ADMIN) {
    const employee = await Employee.findById(payslip.employee);
    const viewer = await resolveViewerEmployee(req.user);
    if (!employee || !canViewSensitive(req.user, viewer, employee)) {
      throw ApiError.forbidden('You do not have access to this payslip');
    }
    if (payslip.status === 'draft') {
      throw ApiError.forbidden('This payslip has not been finalised yet');
    }
  }

  res.json({ success: true, payslip: present(payslip) });
});

/** PATCH /api/payroll/:id/status */
const updateStatus = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Payslip not found');

  const payslip = await Payslip.findById(req.params.id);
  if (!payslip) throw ApiError.notFound('Payslip not found');

  const next = (req.body || {}).status;
  const allowed = STATUS_TRANSITIONS[payslip.status] || [];

  if (!next) throw ApiError.badRequest('A target status is required');
  if (allowed.indexOf(next) === -1) {
    throw ApiError.conflict(
      allowed.length
        ? `A ${STATUS_LABELS[payslip.status].toLowerCase()} payslip can only move to: ${allowed.join(', ')}`
        : `A ${STATUS_LABELS[payslip.status].toLowerCase()} payslip cannot be changed`
    );
  }

  payslip.status = next;
  if (next === 'finalised') payslip.finalisedAt = new Date();
  if (next === 'paid') payslip.paidAt = new Date();
  // Reopening clears the approval trail so it cannot look approved by accident.
  if (next === 'draft') {
    payslip.finalisedAt = null;
    payslip.paidAt = null;
  }
  await payslip.save();

  if (next === 'paid') {
    const remaining = await Payslip.countDocuments({ month: payslip.month, status: { $ne: 'paid' } });
    if (remaining === 0) {
      webhooks.emit('payroll.closed', {
        month: payslip.month,
        payslipId: String(payslip._id),
        employeeCode: payslip.snapshot && payslip.snapshot.employeeCode,
        closedAt: payslip.paidAt,
      });
    }
  }

  res.json({
    success: true,
    message: `${payslip.snapshot.fullName}'s ${payslip.month} payslip is now ${STATUS_LABELS[next].toLowerCase()}`,
    payslip: present(payslip),
  });
});

/** DELETE /api/payroll/:id */
const remove = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Payslip not found');

  const payslip = await Payslip.findById(req.params.id);
  if (!payslip) throw ApiError.notFound('Payslip not found');

  if (payslip.status !== 'draft') {
    throw ApiError.conflict('Only a draft payslip can be deleted — reopen it first');
  }

  await payslip.deleteOne();
  res.json({
    success: true,
    message: `Draft payslip for ${payslip.snapshot.fullName} (${payslip.month}) deleted`,
  });
});

/** GET /api/payroll/arrears */
const listArrears = asyncHandler(async (req, res) => {
  const allowed = await visibleEmployeeIds(req.user);
  const adjustments = await arrears.list(req.user, req.query || {}, allowed);
  res.json({ success: true, total: adjustments.length, adjustments });
});

/** POST /api/payroll/arrears/simulate */
const simulateArrears = asyncHandler(async (req, res) => {
  const result = await arrears.simulate(req.user, req.body || {});
  await audit.record(req, {
    action: 'payroll_arrears_simulate',
    employee: result.adjustment.employee,
    objectType: 'ArrearsAdjustment',
    objectId: result.adjustment.id,
    summary: `${result.adjustment.sourceMonth} delta net ${result.adjustment.deltaNet}`,
  });
  res.status(201).json({
    success: true,
    message: 'Closed payslip left unchanged. Delta stored as a simulation.',
    ...result,
  });
});

/** PATCH /api/payroll/arrears/:id/status */
const updateArrearsStatus = asyncHandler(async (req, res) => {
  const next = (req.body || {}).status;
  if (!next) throw ApiError.badRequest('A target status is required');
  const adjustment = await arrears.setStatus(req.user, req.params.id, next);
  await audit.record(req, {
    action: 'payroll_arrears_status',
    employee: adjustment.employee,
    objectType: 'ArrearsAdjustment',
    objectId: adjustment.id,
    summary: next,
  });
  res.json({
    success: true,
    message: `${adjustment.snapshot.fullName}'s ${adjustment.sourceMonth} arrears is now ${next}`,
    adjustment,
  });
});

const inputsService = require('../services/payrollInputs.service');

/** GET /api/payroll/inputs?month= */
const listInputs = asyncHandler(async (req, res) => {
  res.json({ success: true, month: req.query.month, people: await inputsService.list(req.query.month) });
});

/** PUT /api/payroll/inputs */
const saveInput = asyncHandler(async (req, res) => {
  const input = await inputsService.save(req.body || {}, req.user);
  await audit.record(req, { action: 'payroll_input', employee: input.employee, objectType: 'PayrollInput', objectId: input.id, summary: `${input.month} inputs` });
  res.json({ success: true, input });
});

/** POST /api/payroll/inputs/import */
const importInputs = asyncHandler(async (req, res) => {
  const result = await inputsService.importRows((req.body || {}).month, (req.body || {}).rows, req.user);
  await audit.record(req, { action: 'payroll_input_import', objectType: 'PayrollInput', summary: `${result.month}: ${result.applied} rows applied, ${result.failed.length} failed` });
  res.json({ success: true, ...result });
});

/** GET /api/payroll/register?month= */
const register = asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await inputsService.register(req.query.month)) });
});

const settlements = require('../services/settlement.service');

const settlementList = asyncHandler(async (req, res) => {
  res.json({ success: true, settlements: await settlements.list(req.query || {}), pending: await settlements.pending() });
});

const settlementGet = asyncHandler(async (req, res) => {
  res.json({ success: true, settlement: await settlements.getOne(req.params.id) });
});

const settlementPrepare = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const settlement = await settlements.prepare(body.employee, body, req.user);
  await audit.record(req, { action: 'settlement_prepare', employee: settlement.employee, objectType: 'FinalSettlement', objectId: settlement.id, summary: `${settlement.requestNo} net ${settlement.netPayable}` });
  res.status(201).json({ success: true, settlement });
});

const settlementStatus = asyncHandler(async (req, res) => {
  const next = (req.body || {}).status;
  if (!next) throw ApiError.badRequest('A target status is required');
  const settlement = await settlements.setStatus(req.params.id, next, req.body, req.user);
  await audit.record(req, { action: 'settlement_status', employee: settlement.employee, objectType: 'FinalSettlement', objectId: settlement.id, summary: `${settlement.requestNo} → ${next}` });
  res.json({ success: true, settlement });
});

const reportsService = require('../services/payrollReports.service');

/** GET /api/payroll/bank-advice?month= — contains account numbers, so every read is audited */
const bankAdvice = asyncHandler(async (req, res) => {
  const advice = await reportsService.bankAdvice(req.query.month);
  await audit.record(req, { action: 'payroll_bank_advice', objectType: 'Payslip', summary: `${advice.month}: ${advice.transfers.length} transfers, ${advice.totals.transfer}` });
  res.json({ success: true, ...advice });
});

/** GET /api/payroll/statutory?month= */
const statutoryReport = asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await reportsService.statutory(req.query.month)) });
});

module.exports = {
  bankAdvice,
  statutoryReport,
  settlementList,
  settlementGet,
  settlementPrepare,
  settlementStatus,
  listInputs,
  saveInput,
  importInputs,
  register,
  meta,
  generate,
  list,
  getOne,
  updateStatus,
  remove,
  listArrears,
  simulateArrears,
  updateArrearsStatus,
};
