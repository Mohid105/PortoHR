'use strict';

const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const Payslip = require('../models/Payslip');
const ArrearsAdjustment = require('../models/ArrearsAdjustment');
const ApiError = require('../utils/ApiError');
const { monthRange, currentMonth } = require('./attendance.service');
const { buildPeriod, computePayslip, gatherAttendance, gatherVariable } = require('./payroll.service');
const { ARREARS_TRANSITIONS, ARREARS_STATUS_LABELS } = require('../config/payroll');

const CLOSED = new Set(['finalised', 'paid']);

function applyWhatIf(employee, whatIf) {
  const json = employee.toJSON ? employee.toJSON() : Object.assign({}, employee);
  json._id = employee._id || json._id;
  const compensation = Object.assign({}, json.compensation || {});
  if (!whatIf) {
    json.compensation = compensation;
    return json;
  }
  if (whatIf.baseSalary !== undefined && whatIf.baseSalary !== null && whatIf.baseSalary !== '') {
    const amount = Number(whatIf.baseSalary);
    if (!isFinite(amount) || amount < 0) throw ApiError.badRequest('What-if basic salary must be zero or more');
    compensation.baseSalary = amount;
  }
  json.compensation = compensation;
  return json;
}

function snapshotOf(employee) {
  return {
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    designation: employee.designation,
    department: employee.department,
  };
}

function present(doc) {
  if (!doc) return null;
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  json.employee = String(json.employee && (json.employee._id || json.employee));
  json.sourcePayslip = String(json.sourcePayslip && (json.sourcePayslip._id || json.sourcePayslip));
  ['originalGross', 'originalNet', 'recomputedGross', 'recomputedNet', 'deltaGross', 'deltaNet'].forEach((key) => {
    json[key] = Math.round(Number(json[key]) || 0) / 100;
  });
  return json;
}

async function runEngine(employee, range) {
  const attendance = await gatherAttendance(employee, range);
  const variable = await gatherVariable(employee, range);
  const period = buildPeriod(employee, range, new Date());
  return computePayslip({ employee, period, attendance, variable });
}

/**
 * Recomputes a closed month against current (or what-if) contract data.
 * The stored payslip is read-only; the delta is the arrears figure.
 */
async function simulate(user, body) {
  const range = monthRange(body && body.month);
  if (!range) throw ApiError.badRequest('Pay period must be in YYYY-MM format');
  if (!mongoose.isValidObjectId(body.employee)) throw ApiError.notFound('Employee not found');

  const employee = await Employee.findById(body.employee);
  if (!employee) throw ApiError.notFound('Employee not found');

  const payslip = await Payslip.findOne({ employee: employee._id, month: range.month });
  if (!payslip) throw ApiError.badRequest(`There is no payslip for ${employee.fullName} in ${range.month}`);
  if (!CLOSED.has(payslip.status)) {
    throw ApiError.conflict(
      `The ${range.month} payslip is still a draft — regenerate it instead of raising arrears`
    );
  }

  const scenario = applyWhatIf(employee, body.whatIf);
  const recomputed = await runEngine(scenario, range);
  if (payslip.engineVersion && payslip.engineVersion !== recomputed.engineVersion) {
    throw ApiError.conflict(
      `The ${range.month} payslip was produced by payroll engine ${payslip.engineVersion} and the current engine is ${recomputed.engineVersion}, so the difference would mix rule changes with real changes. Raise arrears manually for that month.`
    );
  }

  const originalGross = payslip.earnings.gross;
  const originalNet = payslip.netPay;
  const fields = {
    employee: employee._id,
    sourcePayslip: payslip._id,
    sourceMonth: range.month,
    settlementMonth: currentMonth(),
    currency: payslip.currency,
    snapshot: snapshotOf(employee),
    reason: String((body && body.reason) || '').trim(),
    whatIf: body.whatIf || null,
    originalGross,
    originalNet,
    recomputedGross: recomputed.earnings.gross,
    recomputedNet: recomputed.netPay,
    deltaGross: recomputed.earnings.gross - originalGross,
    deltaNet: recomputed.netPay - originalNet,
    status: 'simulated',
    simulatedBy: user._id,
    simulatedAt: new Date(),
    postedBy: null,
    postedAt: null,
    paidBy: null,
    paidAt: null,
  };

  const existing = await ArrearsAdjustment.findOne({
    employee: employee._id,
    sourceMonth: range.month,
    status: 'simulated',
  });

  let row;
  if (existing) {
    existing.set(fields);
    await existing.save();
    row = existing;
  } else {
    row = await ArrearsAdjustment.create(fields);
  }

  return {
    payslipUntouched: true,
    originalStatus: payslip.status,
    adjustment: present(row),
  };
}

async function list(user, query, visibleIds) {
  const filter = {};
  if (query.month) {
    if (!monthRange(query.month)) throw ApiError.badRequest('Pay period must be in YYYY-MM format');
    filter.sourceMonth = query.month;
  }
  if (query.status) filter.status = query.status;
  if (user.role !== 'hr_admin') {
    filter.status = { $in: ['posted', 'paid'] };
  }
  if (visibleIds) filter.employee = { $in: visibleIds };
  if (query.employee) {
    if (!mongoose.isValidObjectId(query.employee)) throw ApiError.notFound('Employee not found');
    if (visibleIds && !visibleIds.some((id) => String(id) === String(query.employee))) {
      throw ApiError.forbidden('You do not have access to this employee’s arrears');
    }
    filter.employee = query.employee;
  }

  const rows = await ArrearsAdjustment.find(filter).sort({ sourceMonth: -1, createdAt: -1 }).limit(100);
  return rows.map(present);
}

async function setStatus(user, id, next) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Arrears adjustment not found');
  const row = await ArrearsAdjustment.findById(id);
  if (!row) throw ApiError.notFound('Arrears adjustment not found');

  const allowed = ARREARS_TRANSITIONS[row.status] || [];
  if (allowed.indexOf(next) === -1) {
    throw ApiError.conflict(
      allowed.length
        ? `A ${ARREARS_STATUS_LABELS[row.status].toLowerCase()} adjustment can only move to: ${allowed.join(', ')}`
        : `A ${ARREARS_STATUS_LABELS[row.status].toLowerCase()} adjustment cannot be changed`
    );
  }

  if (next === 'posted' && row.deltaNet === 0 && row.deltaGross === 0) {
    throw ApiError.badRequest('There is nothing to post — the recomputed slip matches the closed one');
  }

  row.status = next;
  if (next === 'posted') {
    row.postedBy = user._id;
    row.postedAt = new Date();
    if (!row.settlementMonth) row.settlementMonth = currentMonth();
  }
  if (next === 'paid') {
    row.paidBy = user._id;
    row.paidAt = new Date();
  }
  await row.save();
  return present(row);
}

module.exports = { simulate, list, setStatus, present, applyWhatIf };
