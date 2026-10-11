'use strict';

const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const LeaveRequest = require('../models/LeaveRequest');
const Holiday = require('../models/Holiday');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/roles');
const { metaPayload } = require('../config/leave');
const {
  resolveViewerEmployee,
  canViewSensitive,
  canDecideFor,
  isSelf,
  visibleEmployeeIds,
  approvalScope,
} = require('../services/employeeAccess');
const { monthRange, currentMonth } = require('../services/attendance.service');
const leave = require('../services/leave.service');
const webhooks = require('../services/webhooks.service');

const NO_RECORD_MESSAGE =
  'Your login is not linked to an employee record yet. Ask HR to add you to Core HR.';

async function requireOwnEmployee(user) {
  const employee = await resolveViewerEmployee(user);
  if (!employee) throw ApiError.badRequest(NO_RECORD_MESSAGE);
  return employee;
}

async function resolveTargetEmployee(req) {
  const viewer = await resolveViewerEmployee(req.user);
  const requested = req.query.employee;

  if (!requested) {
    if (!viewer) throw ApiError.badRequest(NO_RECORD_MESSAGE);
    return viewer;
  }

  if (!mongoose.isValidObjectId(requested)) throw ApiError.notFound('Employee not found');
  const employee = await Employee.findById(requested);
  if (!employee) throw ApiError.notFound('Employee not found');
  if (!canViewSensitive(req.user, viewer, employee)) {
    throw ApiError.forbidden('You do not have access to this employee’s leave');
  }
  return employee;
}

/** GET /api/leave/meta */
const meta = asyncHandler(async (_req, res) => {
  await leave.ensureLeaveTypes();
  const year = new Date().getUTCFullYear();
  const holidays = await Holiday.find({
    date: { $gte: new Date(Date.UTC(year, 0, 1)), $lt: new Date(Date.UTC(year + 1, 0, 1)) },
  }).sort({ date: 1 });

  res.json({
    success: true,
    meta: Object.assign(metaPayload(), {
      holidays: holidays.map((row) => ({
        id: String(row._id),
        date: leave.ymd(row.date),
        name: row.name,
        location: row.location || 'All locations',
      })),
    }),
  });
});

/** GET /api/leave/balances?employee=&year= */
const balances = asyncHandler(async (req, res) => {
  const employee = await resolveTargetEmployee(req);
  const year = Number(req.query.year) || new Date().getUTCFullYear();
  if (year < 2000 || year > 2100) throw ApiError.badRequest('Year is out of range');

  const rows = await leave.balancesFor(employee, year);
  res.json({
    success: true,
    year,
    employee: {
      id: String(employee._id),
      employeeCode: employee.employeeCode,
      fullName: employee.fullName,
    },
    balances: rows,
  });
});

/** GET /api/leave — scope=mine|queue, status, employee */
const list = asyncHandler(async (req, res) => {
  const { status, scope } = req.query;
  const filter = {};

  if (status) {
    const allowed = ['pending', 'approved', 'rejected', 'cancelled'];
    if (allowed.indexOf(status) === -1) {
      throw ApiError.badRequest(`Status must be one of: ${allowed.join(', ')}`);
    }
    filter.status = status;
  }

  const queue = await approvalScope(req.user);
  let sort = { createdAt: -1 };

  if (scope === 'queue') {
    if (!queue) {
      return res.json({ success: true, total: 0, pendingCount: 0, canApprove: false, requests: [] });
    }
    Object.assign(filter, queue);
    if (!status) filter.status = 'pending';
    sort = { createdAt: 1 };
  } else if (scope === 'mine') {
    const viewer = await requireOwnEmployee(req.user);
    filter.employee = viewer._id;
  } else if (req.query.employee) {
    const employee = await resolveTargetEmployee(req);
    filter.employee = employee._id;
  } else {
    const allowed = await visibleEmployeeIds(req.user);
    if (allowed) filter.employee = { $in: allowed };
  }

  const [requests, total, pendingCount] = await Promise.all([
    LeaveRequest.find(filter).sort(sort).limit(200),
    LeaveRequest.countDocuments(filter),
    queue ? LeaveRequest.countDocuments(Object.assign({}, queue, { status: 'pending' })) : 0,
  ]);

  res.json({
    success: true,
    total,
    pendingCount,
    canApprove: Boolean(queue),
    requests: requests.map(leave.presentRequest),
  });
});

/** GET /api/leave/calendar?month=YYYY-MM */
const calendar = asyncHandler(async (req, res) => {
  const range = monthRange(req.query.month || currentMonth());
  if (!range) throw ApiError.badRequest('Month must be in YYYY-MM format');

  const allowed = await visibleEmployeeIds(req.user);
  const filter = allowed ? { _id: { $in: allowed } } : {};
  const employees = await Employee.find(filter)
    .select('employeeCode firstName lastName designation department team restDays location')
    .sort({ firstName: 1, lastName: 1 })
    .limit(80);

  const payload = await leave.calendarEntries(employees, range.start, range.end);
  res.json({
    success: true,
    month: range.month,
    ...payload,
  });
});

/** GET /api/leave/:id */
const getOne = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Leave request not found');
  const request = await LeaveRequest.findById(req.params.id);
  if (!request) throw ApiError.notFound('Leave request not found');

  const employee = await Employee.findById(request.employee);
  const viewer = await resolveViewerEmployee(req.user);
  if (!employee || !canViewSensitive(req.user, viewer, employee)) {
    throw ApiError.forbidden('You do not have access to this leave request');
  }

  res.json({ success: true, request: leave.presentRequest(request) });
});

/** POST /api/leave — apply for the caller, or HR applying on someone’s behalf. */
const create = asyncHandler(async (req, res) => {
  const body = req.body || {};
  let employee;

  if (body.employee && req.user.role === ROLES.HR_ADMIN) {
    if (!mongoose.isValidObjectId(body.employee)) throw ApiError.badRequest('A valid employee is required');
    employee = await Employee.findById(body.employee);
    if (!employee) throw ApiError.notFound('Employee not found');
  } else {
    employee = await requireOwnEmployee(req.user);
  }

  const request = await leave.createRequest(employee, req.user, body);
  res.status(201).json({
    success: true,
    message: 'Leave request submitted and waiting for approval',
    request,
  });
});

/** PATCH /api/leave/:id/status */
const decide = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Leave request not found');
  const request = await LeaveRequest.findById(req.params.id);
  if (!request) throw ApiError.notFound('Leave request not found');

  const employee = await Employee.findById(request.employee);
  if (!employee) throw ApiError.notFound('Employee not found');

  const viewer = await resolveViewerEmployee(req.user);
  if (!(await canDecideFor(req.user, viewer, employee, 'leave'))) {
    throw ApiError.forbidden(
      isSelf(req.user, viewer, employee)
        ? 'You cannot approve your own leave — it needs a second pair of eyes'
        : 'You are not the approver for this leave request'
    );
  }

  const presented = await leave.decideRequest(
    request,
    employee,
    req.user,
    (req.body || {}).status,
    (req.body || {}).decisionNote
  );

  webhooks.emitApprovalCompleted({
    kind: 'leave',
    decision: presented.status,
    objectId: request._id,
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
  });

  res.json({
    success: true,
    message: `${employee.fullName}'s leave was ${presented.statusLabel.toLowerCase()}`,
    request: presented,
  });
});

/** POST /api/leave/:id/cancel */
const cancel = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Leave request not found');
  const request = await LeaveRequest.findById(req.params.id);
  if (!request) throw ApiError.notFound('Leave request not found');

  const employee = await Employee.findById(request.employee);
  const viewer = await resolveViewerEmployee(req.user);
  if (!employee) throw ApiError.notFound('Employee not found');

  const asHr = req.user.role === ROLES.HR_ADMIN;
  if (!asHr && !isSelf(req.user, viewer, employee)) {
    throw ApiError.forbidden('Only the person who raised a request, or HR, can cancel it');
  }

  const presented = await leave.cancelRequest(request, employee, req.user, asHr);
  res.json({
    success: true,
    message: 'Leave request cancelled',
    request: presented,
  });
});

/** POST /api/leave/holidays — HR adds a public holiday. */
const createHoliday = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const date = leave.parseDate(body.date, 'Holiday date');
  const name = String(body.name || '').trim();
  if (!name) throw ApiError.badRequest('Holiday name is required');

  try {
    const holiday = await Holiday.create({
      date,
      name,
      location: body.location || '',
      isOptional: Boolean(body.isOptional),
    });
    res.status(201).json({
      success: true,
      message: 'Holiday added',
      holiday: {
        id: String(holiday._id),
        date: leave.ymd(holiday.date),
        name: holiday.name,
        location: holiday.location || 'All locations',
        isOptional: holiday.isOptional,
      },
    });
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('A holiday already exists on that date for this location');
    throw err;
  }
});

/** GET /api/leave/statement?employee=&year= — the yearly leave record */
const statement = asyncHandler(async (req, res) => {
  const employee = await resolveTargetEmployee(req);
  const year = Number(req.query.year) || new Date().getUTCFullYear();
  if (year < 2000 || year > 2100) throw ApiError.badRequest('Year is out of range');
  const result = await leave.statementFor(employee, year);
  res.json({
    success: true,
    employee: {
      id: String(employee._id),
      employeeCode: employee.employeeCode,
      fullName: employee.fullName,
      designation: employee.designation,
      department: employee.department,
      team: employee.team,
      dateOfJoining: employee.dateOfJoining,
    },
    ...result,
  });
});

/** POST /api/leave/adjustments — HR credits or corrects someone's balance */
const createAdjustment = asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!mongoose.isValidObjectId(body.employee)) throw ApiError.badRequest('Choose an employee');
  const employee = await Employee.findById(body.employee);
  if (!employee) throw ApiError.notFound('Employee not found');
  const adjustment = await leave.createAdjustment(employee, body, req.user);
  res.status(201).json({ success: true, adjustment });
});

module.exports = { statement, createAdjustment, meta, balances, list, calendar, getOne, create, decide, cancel, createHoliday };
