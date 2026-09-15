'use strict';

const mongoose = require('mongoose');
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { resolveViewerEmployee, canViewSensitive } = require('../services/employeeAccess');
const {
  attendanceDate,
  shiftFor,
  computeTotals,
  monthRange,
  currentMonth,
  buildMonth,
  round2,
} = require('../services/attendance.service');
const {
  SHIFT_STATUSES,
  STATUS_LABELS,
  MAX_OPEN_SHIFT_HOURS,
  metaPayload,
} = require('../config/attendance');
const leave = require('../services/leave.service');

const NO_RECORD_MESSAGE =
  'Your login is not linked to an employee record yet. Ask HR to add you to Core HR.';

/** The signed-in user's own employee record; clocking always acts on this. */
async function requireOwnEmployee(user) {
  const employee = await resolveViewerEmployee(user);
  if (!employee) throw ApiError.badRequest(NO_RECORD_MESSAGE);
  return employee;
}

/** Whose attendance is being read — self by default, someone else only if allowed. */
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
    throw ApiError.forbidden('You do not have access to this employee’s attendance');
  }
  return employee;
}

/**
 * Annual leave balance is owned by the Leave module. Attendance still counts
 * `on_leave` days for the month view; the entitlement widget reads the same
 * figures employees see when they apply.
 */
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
    shift: shiftFor(employee.shiftType),
  };
}

/** GET /api/attendance/meta */
const meta = asyncHandler(async (_req, res) => {
  res.json({ success: true, meta: metaPayload() });
});

/** GET /api/attendance/today */
const today = asyncHandler(async (req, res) => {
  const employee = await requireOwnEmployee(req.user);
  const date = attendanceDate();

  const record = await Attendance.findOne({ employee: employee._id, date });
  const open = record && record.timeIn && !record.timeOut;

  res.json({
    success: true,
    date: date.toISOString().slice(0, 10),
    employee: presentEmployee(employee),
    status: record ? (open ? 'in_progress' : record.shiftStatus) : 'not_started',
    statusLabel: record ? STATUS_LABELS[open ? 'in_progress' : record.shiftStatus] : 'Not clocked in',
    canClockIn: !record || (!record.timeIn && record.shiftStatus !== 'on_leave'),
    canClockOut: Boolean(open),
    record: record || null,
    elapsedHours: open ? round2((Date.now() - record.timeIn.getTime()) / 3600000) : 0,
  });
});

/** POST /api/attendance/clock-in */
const clockIn = asyncHandler(async (req, res) => {
  const employee = await requireOwnEmployee(req.user);
  const date = attendanceDate();

  let record = await Attendance.findOne({ employee: employee._id, date });
  if (record && record.timeIn) throw ApiError.conflict('You have already clocked in today');
  if (record && record.shiftStatus === 'on_leave') {
    throw ApiError.conflict('Today is marked as leave — ask HR to change it before clocking in');
  }

  const shift = shiftFor(employee.shiftType);
  if (!record) record = new Attendance({ employee: employee._id, date });

  record.timeIn = new Date();
  record.timeOut = null;
  record.shiftType = employee.shiftType;
  record.expectedHours = shift.expectedHours;
  record.shiftStatus = 'present';
  record.hoursWorked = 0;
  record.overtimeHours = 0;
  record.shortfallHours = 0;

  try {
    await record.save();
  } catch (err) {
    // Two clock-ins racing each other both miss the findOne; the unique index
    // catches the loser.
    if (err.code === 11000) throw ApiError.conflict('You have already clocked in today');
    throw err;
  }

  res.status(201).json({
    success: true,
    message: 'Clocked in',
    shift,
    record,
  });
});

/** POST /api/attendance/clock-out */
const clockOut = asyncHandler(async (req, res) => {
  const employee = await requireOwnEmployee(req.user);

  // Found by open state rather than by today's date: a night shift is clocked
  // out on the following calendar day.
  const record = await Attendance.findOne({
    employee: employee._id,
    timeIn: { $ne: null },
    timeOut: null,
  }).sort({ date: -1 });

  if (!record) throw ApiError.badRequest('You are not currently clocked in');

  const now = new Date();
  const hoursOpen = (now.getTime() - record.timeIn.getTime()) / 3600000;
  if (hoursOpen > MAX_OPEN_SHIFT_HOURS) {
    throw ApiError.conflict(
      'This shift has been open for more than a day — ask HR to correct the record'
    );
  }

  const shift = shiftFor(record.shiftType);
  const totals = computeTotals(record.timeIn, now, {
    breakMinutes: shift.breakMinutes,
    expectedHours: record.expectedHours || shift.expectedHours,
  });

  record.timeOut = now;
  record.hoursWorked = totals.hoursWorked;
  record.overtimeHours = totals.overtimeHours;
  record.shortfallHours = totals.shortfallHours;
  record.shiftStatus = totals.shiftStatus;
  await record.save();

  res.json({
    success: true,
    message:
      totals.shiftStatus === 'short_day'
        ? `Clocked out — ${totals.shortfallHours}h short of the ${record.expectedHours}h shift`
        : totals.overtimeHours > 0
          ? `Clocked out — ${totals.overtimeHours}h overtime`
          : 'Clocked out',
    record,
  });
});

/** GET /api/attendance?month=YYYY-MM&employee=<id> */
const month = asyncHandler(async (req, res) => {
  const employee = await resolveTargetEmployee(req);

  const range = monthRange(req.query.month || currentMonth());
  if (!range) throw ApiError.badRequest('Month must be in YYYY-MM format');

  const records = await Attendance.find({
    employee: employee._id,
    date: { $gte: range.start, $lt: range.end },
  }).sort({ date: 1 });

  const { days, summary } = buildMonth(employee, range, records, new Date());
  const leave = await leaveSummary(employee, range.year);

  res.json({
    success: true,
    month: range.month,
    employee: presentEmployee(employee),
    days,
    summary,
    leave,
  });
});

/**
 * PATCH /api/attendance/day — HR marks a day that has no clock times of its own,
 * which is how absences and paid leave get onto the calendar.
 */
const markDay = asyncHandler(async (req, res) => {
  const { employee: employeeId, date, shiftStatus, notes } = req.body || {};

  if (!employeeId || !mongoose.isValidObjectId(employeeId)) {
    throw ApiError.badRequest('A valid employee is required');
  }
  if (['absent', 'on_leave'].indexOf(shiftStatus) === -1) {
    throw ApiError.badRequest('Only absent or on_leave can be marked manually');
  }

  const parsedDate = date ? new Date(date) : null;
  if (!parsedDate || isNaN(parsedDate.getTime())) throw ApiError.badRequest('A valid date is required');

  const employee = await Employee.findById(employeeId);
  if (!employee) throw ApiError.notFound('Employee not found');

  const day = attendanceDate(parsedDate);
  const record = await Attendance.findOneAndUpdate(
    { employee: employee._id, date: day },
    {
      $set: {
        shiftStatus,
        notes: (notes || '').trim(),
        timeIn: null,
        timeOut: null,
        hoursWorked: 0,
        overtimeHours: 0,
        shortfallHours: 0,
        expectedHours: 0,
        shiftType: employee.shiftType,
        recordedBy: req.user._id,
      },
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );

  res.json({
    success: true,
    message: `${employee.fullName} marked ${STATUS_LABELS[shiftStatus].toLowerCase()} on ${day
      .toISOString()
      .slice(0, 10)}`,
    record,
  });
});

module.exports = { meta, today, clockIn, clockOut, month, markDay, SHIFT_STATUSES };
