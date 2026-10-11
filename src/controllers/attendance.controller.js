'use strict';

const mongoose = require('mongoose');
const Attendance = require('../models/Attendance');
const AttendanceRequest = require('../models/AttendanceRequest');
const Employee = require('../models/Employee');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../services/audit.service');
const {
  resolveViewerEmployee,
  canViewSensitive,
  canDecideFor,
  isSelf,
  visibleEmployeeIds,
  approvalScope,
} = require('../services/employeeAccess');
const { shiftFor, monthRange, currentMonth, buildMonth } = require('../services/attendance.service');
const { STATUS_LABELS, metaPayload } = require('../config/attendance');
const { ROLES } = require('../config/roles');
const leave = require('../services/leave.service');
const ops = require('../services/attendanceOps.service');
const admin = require('../services/attendanceAdmin.service');
const importer = require('../services/attendanceImport.service');
const boards = require('../services/attendanceBoard.service');
const shifts = require('../services/shift.service');
const registry = require('../config/shiftRegistry');
const engine = require('../services/attendanceEngine');

const NO_RECORD_MESSAGE = 'Your login is not linked to an employee record yet. Ask HR to add you to Core HR.';

/** The signed-in user's own employee record; clocking always acts on this. */
async function requireOwnEmployee(user) {
  const employee = await resolveViewerEmployee(user);
  if (!employee) throw ApiError.badRequest(NO_RECORD_MESSAGE);
  return employee;
}

/** Whose attendance is being read — self by default, someone else only if allowed. */
async function resolveTargetEmployee(req) {
  const viewer = await resolveViewerEmployee(req.user);
  const requested = req.query.employee || (req.body && req.body.employee);

  if (!requested) {
    if (!viewer) throw ApiError.badRequest(NO_RECORD_MESSAGE);
    return viewer;
  }
  if (!mongoose.isValidObjectId(requested)) throw ApiError.notFound('Employee not found');
  const employee = await Employee.findById(requested);
  if (!employee) throw ApiError.notFound('Employee not found');
  if (!canViewSensitive(req.user, viewer, employee)) {
    throw ApiError.forbidden('You do not have access to this employee’s attendance');
  }
  return employee;
}

async function leaveSummary(employee, year) {
  const rows = await leave.balancesFor(employee, year);
  const annual = rows.filter((row) => row.code === 'annual')[0];
  const takenDays = annual ? annual.takenDays : 0;
  const entitlementDays = annual ? annual.entitlementDays : employee.annualLeaveDays || 0;
  return {
    year,
    entitlementDays,
    takenDays,
    pendingDays: annual ? annual.pendingDays : 0,
    balanceDays: annual ? annual.availableDays : Math.max(0, entitlementDays - takenDays),
  };
}

function presentEmployee(employee) {
  return {
    id: employee.id,
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    designation: employee.designation,
    department: employee.department,
    restDays: employee.restDays,
    attendanceMode: employee.attendanceMode,
    shift: shiftFor(employee.shiftType),
  };
}

const isHr = (user) => user.role === ROLES.HR_ADMIN;

/* ------------------------------------------------------------------ meta */

/** GET /api/attendance/meta */
const meta = asyncHandler(async (_req, res) => {
  const policy = await ops.getPolicy();
  res.json({
    success: true,
    meta: Object.assign(metaPayload(), {
      timezone: ops.TZ,
      shifts: registry.all().map((s) => ({ code: s.code, label: s.label, startTime: s.startTime, endTime: s.endTime, expectedHours: s.expectedHours, fixed: s.fixed, overnight: s.overnight })),
      requestTypes: Object.keys(admin.TYPE_LABELS).map((value) => ({ value, label: admin.TYPE_LABELS[value] })),
      regularization: { maxBackDays: policy.regularization.maxBackDays },
      webPunchAllowed: policy.webPunch.allowed,
    }),
  });
});

/* ----------------------------------------------------------- clock in/out */

function stateStatus(state) {
  if (state.onLeave) return 'on_leave';
  if (state.open) return (state.record && (state.record.flags || []).includes('missed_punch')) ? 'missing_punch' : 'in_progress';
  if (state.record) return state.record.shiftStatus;
  return 'not_started';
}

/** GET /api/attendance/today */
const today = asyncHandler(async (req, res) => {
  const employee = await requireOwnEmployee(req.user);
  const state = await ops.todayState(employee);
  const status = stateStatus(state);
  res.json({
    success: true,
    date: state.dayKey,
    timezone: ops.TZ,
    serverTime: new Date(),
    employee: presentEmployee(employee),
    shift: state.shift,
    status,
    statusLabel: status === 'not_started' ? (state.restDay ? 'Rest day' : state.holiday ? 'Gazetted holiday' : 'Not clocked in') : STATUS_LABELS[status] || status,
    restDay: state.restDay,
    holiday: state.holiday,
    canClockIn: state.canClockIn,
    canClockOut: state.canClockOut,
    webPunchAllowed: state.webPunchAllowed,
    undoMinutes: (await ops.getPolicy()).webPunch.undoMinutes,
    punches: state.punches,
    record: state.record,
    elapsedHours: state.elapsedHours,
  });
});

async function punch(req, res, direction) {
  const employee = await requireOwnEmployee(req.user);
  const result = await ops.webPunch(employee, req.user, { direction, at: req.body && req.body.at });
  const state = await ops.todayState(employee);
  const rec = result.record;
  let message = direction === 'in' ? 'Clocked in' : 'Clocked out';
  if (direction === 'out' && rec) {
    if (rec.shiftStatus === 'short_day') message = `Clocked out. ${rec.shortfallHours}h short of the ${rec.expectedHours}h shift`;
    else if (rec.overtimeHours > 0) message = `Clocked out. ${rec.overtimeHours}h overtime`;
  }
  if (direction === 'in' && rec && rec.lateMinutes) message = `Clocked in. ${rec.lateMinutes} minutes after the shift start`;
  res.status(201).json({ success: true, message, shift: state.shift, record: rec, punch: result.punch });
}

/** POST /api/attendance/clock-in */
const clockIn = asyncHandler((req, res) => punch(req, res, 'in'));

/** POST /api/attendance/clock-out */
const clockOut = asyncHandler((req, res) => punch(req, res, 'out'));

/** POST /api/attendance/clock-undo — take back your last clock punch (short window) */
const clockUndo = asyncHandler(async (req, res) => {
  const employee = await requireOwnEmployee(req.user);
  const result = await ops.undoLastPunch(employee, req.user);
  await audit.record(req, { action: 'attendance_punch_undo', employee: employee._id, objectType: 'AttendancePunch', objectId: String(result.punch._id || result.punch.id), summary: `${result.dayKey}: punch taken back` });
  res.json({ success: true, message: 'Your last punch was taken back' });
});

/* ----------------------------------------------------------- month and day */

/** GET /api/attendance?month=YYYY-MM&employee=<id> */
const month = asyncHandler(async (req, res) => {
  const employee = await resolveTargetEmployee(req);
  const range = monthRange(req.query.month || currentMonth());
  if (!range) throw ApiError.badRequest('Month must be in YYYY-MM format');

  const [records, holidayKeys, requests, locks, policy] = await Promise.all([
    Attendance.find({ employee: employee._id, date: { $gte: range.start, $lt: range.end } }).sort({ date: 1 }),
    leave.holidayKeys(range.start, new Date(range.end.getTime() - 86400000), employee.location),
    AttendanceRequest.find({ employee: employee._id, date: { $gte: range.start, $lt: range.end }, status: { $in: ['pending', 'approved'] } }).lean(),
    ops.lockedMonths([`${range.month}-01`]),
    ops.getPolicy(),
  ]);

  const { days, summary } = buildMonth(employee, range, records, new Date(), holidayKeys);
  const requestByDay = new Map(requests.map((r) => [r.date.toISOString().slice(0, 10), r]));
  days.forEach((d) => {
    const r = requestByDay.get(d.date);
    d.request = r ? { id: String(r._id), status: r.status, type: r.type } : null;
    d.canRequest = !locks.size && !d.isFuture && d.status !== 'not_employed' && d.status !== 'on_leave';
  });
  summary.latePenaltyDays = engine.latePenaltyDays(summary.lateCount, policy);

  res.json({
    success: true,
    month: range.month,
    locked: locks.size > 0,
    employee: presentEmployee(employee),
    days,
    summary,
    leave: await leaveSummary(employee, range.year),
  });
});

/** GET /api/attendance/day?date=&employee= — the punches behind one day */
const day = asyncHandler(async (req, res) => {
  const employee = await resolveTargetEmployee(req);
  const key = String(req.query.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw ApiError.badRequest('A valid date is required');
  const [punches, record] = await Promise.all([ops.listPunches(employee, key), Attendance.findOne({ employee: employee._id, date: ops.dayDate(key) })]);
  res.json({ success: true, date: key, employee: presentEmployee(employee), punches, record });
});

/* ---------------------------------------------------------- corrections */

/** PATCH /api/attendance/day — HR sets a day by hand (absent, leave, present) or clears it */
const markDay = asyncHandler(async (req, res) => {
  const { employee: employeeId } = req.body || {};
  if (!employeeId || !mongoose.isValidObjectId(employeeId)) throw ApiError.badRequest('A valid employee is required');
  const employee = await Employee.findById(employeeId);
  if (!employee) throw ApiError.notFound('Employee not found');
  const record = await ops.markDay(employee, req.user, req.body || {});
  await audit.record(req, { action: 'attendance_mark', employee: employee._id, objectType: 'Attendance', objectId: String(req.body.date), summary: `${req.body.date}: ${req.body.shiftStatus}` });
  res.json({ success: true, message: 'Day updated', record });
});

/** POST /api/attendance/punches — HR adds a punch by hand */
const addPunch = asyncHandler(async (req, res) => {
  const employee = await resolveTargetEmployee(req);
  const result = await ops.addManualPunch(employee, req.user, req.body || {});
  await audit.record(req, { action: 'attendance_punch_add', employee: employee._id, objectType: 'AttendancePunch', objectId: String(result.punch._id || result.punch.id), summary: `${result.dayKey}: ${req.body.note}` });
  res.status(201).json({ success: true, ...result });
});

/** DELETE /api/attendance/punches/:id — void a punch (it stays on file) */
const voidPunch = asyncHandler(async (req, res) => {
  const result = await ops.voidPunch(req.params.id, req.user, (req.body || {}).reason);
  await audit.record(req, { action: 'attendance_punch_void', employee: result.employee._id, objectType: 'AttendancePunch', objectId: req.params.id, summary: `${result.dayKey}: ${req.body.reason}` });
  res.json({ success: true, record: result.record });
});

/* ------------------------------------------------------------- requests */

/** GET /api/attendance/requests?scope=mine|queue&status= */
const listRequests = asyncHandler(async (req, res) => {
  const { scope, status } = req.query;
  const filter = {};
  if (status) {
    if (!['pending', 'approved', 'rejected', 'cancelled'].includes(status)) throw ApiError.badRequest('Unknown status');
    filter.status = status;
  }
  const queue = await approvalScope(req.user);
  let sort = { createdAt: -1 };

  if (scope === 'queue') {
    if (!queue) return res.json({ success: true, total: 0, pendingCount: 0, canApprove: false, requests: [] });
    Object.assign(filter, queue);
    if (!status) filter.status = 'pending';
    sort = { createdAt: 1 };
  } else {
    const viewer = await requireOwnEmployee(req.user);
    filter.employee = viewer._id;
  }
  const [rows, pendingCount] = await Promise.all([
    AttendanceRequest.find(filter).sort(sort).limit(200),
    queue ? AttendanceRequest.countDocuments(Object.assign({}, queue, { status: 'pending' })) : 0,
  ]);
  res.json({ success: true, total: rows.length, pendingCount, canApprove: Boolean(queue), requests: rows.map(admin.present) });
});

/** POST /api/attendance/requests */
const createRequest = asyncHandler(async (req, res) => {
  const body = req.body || {};
  let employee;
  if (body.employee && isHr(req.user)) {
    if (!mongoose.isValidObjectId(body.employee)) throw ApiError.badRequest('A valid employee is required');
    employee = await Employee.findById(body.employee);
    if (!employee) throw ApiError.notFound('Employee not found');
  } else {
    employee = await requireOwnEmployee(req.user);
  }
  const request = await admin.createRequest(employee, req.user, body);
  res.status(201).json({ success: true, message: 'Request submitted for approval', request });
});

/** PATCH /api/attendance/requests/:id/status */
const decideRequest = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Request not found');
  const request = await AttendanceRequest.findById(req.params.id);
  if (!request) throw ApiError.notFound('Request not found');
  const employee = await Employee.findById(request.employee);
  if (!employee) throw ApiError.notFound('Employee not found');
  const viewer = await resolveViewerEmployee(req.user);
  if (!(await canDecideFor(req.user, viewer, employee, 'attendance'))) {
    throw ApiError.forbidden(isSelf(req.user, viewer, employee) ? 'You cannot approve your own correction. It needs a second pair of eyes' : 'You are not the approver for this request');
  }
  const result = await admin.decideRequest(request, employee, req.user, (req.body || {}).status, (req.body || {}).decisionNote);
  await audit.record(req, { action: 'attendance_request_decide', employee: employee._id, objectType: 'AttendanceRequest', objectId: String(request._id), summary: `${result.date}: ${result.status}` });
  res.json({ success: true, message: `Request ${result.status}`, request: result });
});

/** POST /api/attendance/requests/:id/cancel */
const cancelRequest = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Request not found');
  const request = await AttendanceRequest.findById(req.params.id);
  if (!request) throw ApiError.notFound('Request not found');
  const viewer = await resolveViewerEmployee(req.user);
  if (!isHr(req.user) && !(viewer && String(viewer._id) === String(request.employee))) throw ApiError.forbidden('You can only withdraw your own requests');
  res.json({ success: true, request: await admin.cancelRequest(request, req.user) });
});

/* ------------------------------------------------------ management views */

/** GET /api/attendance/board?date=&department=&q= */
const board = asyncHandler(async (req, res) => {
  const ids = await visibleEmployeeIds(req.user);
  res.json({ success: true, ...(await boards.board(ids, req.query || {})) });
});

/** GET /api/attendance/register?month=&department=&q=&page= */
const register = asyncHandler(async (req, res) => {
  const ids = await visibleEmployeeIds(req.user);
  res.json({ success: true, ...(await boards.register(ids, req.query || {})) });
});

/* ---------------------------------------------------------- import / undo */

/** POST /api/attendance/import — { rows, commit } */
const importPunches = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const result = await importer.run(body.rows, { commit: body.commit === true }, req.user);
  if (result.committed) {
    await audit.record(req, { action: 'attendance_import', objectType: 'AttendancePunch', objectId: result.batch, summary: `${result.valid} punches for ${result.employees} employees, ${result.from} to ${result.to}` });
  }
  res.status(result.committed ? 201 : 200).json({ success: true, ...result });
});

const importBatches = asyncHandler(async (_req, res) => {
  res.json({ success: true, batches: await importer.listBatches() });
});

const undoImport = asyncHandler(async (req, res) => {
  const result = await importer.undoBatch(req.params.batch, req.user);
  await audit.record(req, { action: 'attendance_import_undo', objectType: 'AttendancePunch', objectId: req.params.batch, summary: `${result.voided} punches voided` });
  res.json({ success: true, ...result });
});

/* ------------------------------------------------------ shifts and roster */

const listShifts = asyncHandler(async (_req, res) => {
  res.json({ success: true, shifts: await shifts.list() });
});

const createShift = asyncHandler(async (req, res) => {
  const shift = await shifts.create(req.body || {});
  await audit.record(req, { action: 'shift_create', objectType: 'Shift', objectId: shift.id, summary: shift.name });
  res.status(201).json({ success: true, shift });
});

const updateShift = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Shift not found');
  const shift = await shifts.update(req.params.id, req.body || {});
  await audit.record(req, { action: 'shift_update', objectType: 'Shift', objectId: shift.id, summary: shift.name });
  res.json({ success: true, shift });
});

const listRoster = asyncHandler(async (req, res) => {
  const ids = await visibleEmployeeIds(req.user);
  res.json({ success: true, entries: await admin.listRoster(req.query || {}, ids) });
});

const setRoster = asyncHandler(async (req, res) => {
  const ids = await visibleEmployeeIds(req.user);
  const result = await admin.setRoster(req.body || {}, req.user, ids);
  await audit.record(req, { action: 'roster_set', objectType: 'ShiftRoster', summary: `${result.employees} employees on ${result.shift}, ${result.from} to ${result.to}` });
  res.status(201).json({ success: true, ...result });
});

const removeRoster = asyncHandler(async (req, res) => {
  await admin.removeRoster(req.params.id);
  await audit.record(req, { action: 'roster_remove', objectType: 'ShiftRoster', objectId: req.params.id, summary: 'Roster entry removed' });
  res.json({ success: true });
});

/* ------------------------------------------------------- policy and locks */

const getPolicy = asyncHandler(async (_req, res) => {
  res.json({ success: true, policy: (await ops.getPolicy()).toJSON() });
});

const savePolicy = asyncHandler(async (req, res) => {
  const policy = await ops.savePolicy(req.body || {});
  await audit.record(req, { action: 'attendance_policy', objectType: 'AttendancePolicy', summary: 'Attendance rules changed' });
  res.json({ success: true, policy });
});

const listLocks = asyncHandler(async (_req, res) => {
  const [locks, current] = await Promise.all([admin.listLocks(), ops.todayKey().slice(0, 7)]);
  res.json({ success: true, locks, currentMonth: current });
});

const lockReadiness = asyncHandler(async (req, res) => {
  res.json({ success: true, month: req.params.month, ...(await admin.lockReadiness(req.params.month)) });
});

const lockMonth = asyncHandler(async (req, res) => {
  const lock = await admin.lockMonth((req.body || {}).month, req.user, req.body || {});
  await audit.record(req, { action: 'attendance_lock', objectType: 'AttendanceLock', objectId: lock.month, summary: `Locked ${lock.month}` });
  res.status(201).json({ success: true, lock });
});

const unlockMonth = asyncHandler(async (req, res) => {
  await admin.unlockMonth(req.params.month);
  await audit.record(req, { action: 'attendance_unlock', objectType: 'AttendanceLock', objectId: req.params.month, summary: `Reopened ${req.params.month}` });
  res.json({ success: true });
});

module.exports = {
  meta,
  today,
  clockIn,
  clockOut,
  clockUndo,
  month,
  day,
  markDay,
  addPunch,
  voidPunch,
  listRequests,
  createRequest,
  decideRequest,
  cancelRequest,
  board,
  register,
  importPunches,
  importBatches,
  undoImport,
  listShifts,
  createShift,
  updateShift,
  listRoster,
  setRoster,
  removeRoster,
  getPolicy,
  savePolicy,
  listLocks,
  lockReadiness,
  lockMonth,
  unlockMonth,
};
