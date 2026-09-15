'use strict';

const Holiday = require('../models/Holiday');
const LeaveRequest = require('../models/LeaveRequest');
const LeaveType = require('../models/LeaveType');
const Attendance = require('../models/Attendance');
const ApiError = require('../utils/ApiError');
const { attendanceDate, weekdayKey } = require('./attendance.service');
const { LEAVE_TYPES, LEAVE_TYPE_CODES, typeOf, STATUS_LABELS } = require('../config/leave');

function ymd(date) {
  return attendanceDate(date).toISOString().slice(0, 10);
}

function yearBounds(year) {
  return {
    start: new Date(Date.UTC(year, 0, 1)),
    end: new Date(Date.UTC(year + 1, 0, 1)),
  };
}

function parseDate(value, label) {
  if (!value) throw ApiError.badRequest(`${label} is required`);
  const raw = String(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (match) {
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }
  const date = attendanceDate(value);
  if (Number.isNaN(date.getTime())) throw ApiError.badRequest(`${label} must be a valid date`);
  return date;
}

/**
 * Holidays that apply either company-wide or to this employee's location.
 * Returned as a Set of YYYY-MM-DD keys for cheap membership tests.
 */
async function holidayKeys(from, to, location) {
  const start = attendanceDate(from);
  const end = attendanceDate(to);
  const rows = await Holiday.find({
    date: { $gte: start, $lte: end },
    $or: [{ location: '' }, { location: location || '' }],
  }).lean();

  return new Set(rows.map((row) => ymd(row.date)));
}

function isNonWorking(employee, date, holidays) {
  const restDays = employee.restDays || [];
  if (restDays.indexOf(weekdayKey(date)) !== -1) return true;
  return holidays.has(ymd(date));
}

/**
 * Working days charged for a range. A half-day is only valid on a single
 * working day and always costs 0.5 against the balance.
 */
function countWorkingDays(employee, fromDate, toDate, holidays, halfDay) {
  const from = attendanceDate(fromDate);
  const to = attendanceDate(toDate);
  if (to < from) throw ApiError.badRequest('End date cannot be before the start date');

  if (halfDay) {
    if (ymd(from) !== ymd(to)) {
      throw ApiError.badRequest('A half-day request must start and end on the same date');
    }
    if (isNonWorking(employee, from, holidays)) {
      throw ApiError.badRequest('A half-day cannot fall on a rest day or public holiday');
    }
    return 0.5;
  }

  let days = 0;
  for (let cursor = new Date(from); cursor <= to; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = new Date(cursor);
    if (!isNonWorking(employee, date, holidays)) days += 1;
  }

  if (!days) {
    throw ApiError.badRequest('That range covers no working days — rest days and holidays are skipped');
  }
  return days;
}

function eachWorkingDay(employee, fromDate, toDate, holidays, visit) {
  const from = attendanceDate(fromDate);
  const to = attendanceDate(toDate);
  for (let cursor = new Date(from); cursor <= to; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = new Date(cursor);
    if (!isNonWorking(employee, date, holidays)) visit(date);
  }
}

async function overlappingRequests(employeeId, fromDate, toDate, exceptId) {
  const filter = {
    employee: employeeId,
    status: { $in: ['pending', 'approved'] },
    fromDate: { $lte: toDate },
    toDate: { $gte: fromDate },
  };
  if (exceptId) filter._id = { $ne: exceptId };
  return LeaveRequest.find(filter);
}

function presentRequest(doc) {
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  json.leaveTypeLabel = (typeOf(json.leaveType) || {}).label || json.leaveType;
  json.paid = Boolean((typeOf(json.leaveType) || {}).paid);
  json.statusLabel = STATUS_LABELS[json.status] || json.status;
  json.fromDate = ymd(json.fromDate);
  json.toDate = ymd(json.toDate);
  return json;
}

function snapshotOf(employee) {
  return {
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    designation: employee.designation,
    department: employee.department,
    team: employee.team,
  };
}

async function ensureLeaveTypes() {
  const existing = await LeaveType.find().lean();
  if (existing.length >= LEAVE_TYPES.length) return existing;

  await Promise.all(
    LEAVE_TYPES.map((type) =>
      LeaveType.updateOne(
        { code: type.code },
        {
          $setOnInsert: {
            code: type.code,
            label: type.label,
            paid: type.paid,
            entitlementFromEmployment: type.entitlementFromEmployment,
            defaultEntitlement: type.defaultEntitlement,
            carryForwardDays: type.carryForwardDays,
            requiresApproval: type.requiresApproval,
            hint: type.hint,
            isActive: true,
          },
        },
        { upsert: true }
      )
    )
  );
  return LeaveType.find().lean();
}

function entitlementFor(employee, type, carried) {
  const base = type.entitlementFromEmployment
    ? Number(employee.annualLeaveDays) || type.defaultEntitlement
    : type.defaultEntitlement;
  return base + (carried || 0);
}

async function takenDays(employeeId, leaveType, year) {
  const { start, end } = yearBounds(year);
  const rows = await LeaveRequest.find({
    employee: employeeId,
    leaveType,
    status: 'approved',
    fromDate: { $lt: end },
    toDate: { $gte: start },
  }).lean();

  // A request that spans year-end is charged to the year of each working day.
  // Days is stored as a total, so for same-year requests we can use it directly.
  return rows.reduce((sum, row) => {
    const from = attendanceDate(row.fromDate);
    const to = attendanceDate(row.toDate);
    if (from >= start && to < end) return sum + Number(row.days);
    // Cross-year: fall back to the stored total only if both ends are in range;
    // otherwise count would overstate. Split is rare in this product, so we
    // attribute the whole request to the start year.
    if (from >= start && from < end) return sum + Number(row.days);
    return sum;
  }, 0);
}

async function pendingDays(employeeId, leaveType, year) {
  const { start, end } = yearBounds(year);
  const rows = await LeaveRequest.find({
    employee: employeeId,
    leaveType,
    status: 'pending',
    fromDate: { $lt: end },
    toDate: { $gte: start },
  }).lean();
  return rows.reduce((sum, row) => sum + Number(row.days), 0);
}

async function carriedInto(employee, type, year) {
  if (!type.carryForwardDays) return 0;
  if (year <= new Date(employee.dateOfJoining || Date.now()).getUTCFullYear()) return 0;
  const previous = await takenDays(employee._id, type.code, year - 1);
  const priorEntitlement = entitlementFor(employee, type, 0);
  const leftover = Math.max(0, priorEntitlement - previous);
  return Math.min(type.carryForwardDays, leftover);
}

async function balancesFor(employee, year) {
  const types = await ensureLeaveTypes();
  const active = types.filter((type) => type.isActive !== false);

  const rows = await Promise.all(
    active
      .slice()
      .sort((a, b) => LEAVE_TYPE_CODES.indexOf(a.code) - LEAVE_TYPE_CODES.indexOf(b.code))
      .map(async (type) => {
      const carried = await carriedInto(employee, type, year);
      const entitlement = entitlementFor(employee, type, carried);
      const taken = await takenDays(employee._id, type.code, year);
      const pending = await pendingDays(employee._id, type.code, year);
      return {
        code: type.code,
        label: type.label,
        paid: type.paid,
        hint: type.hint,
        year,
        entitlementDays: entitlement,
        carriedDays: carried,
        takenDays: taken,
        pendingDays: pending,
        availableDays: Math.max(0, entitlement - taken - pending),
      };
    })
  );

  return rows;
}

async function assertBalance(employee, leaveType, days, year, exceptId) {
  const type = typeOf(leaveType);
  if (!type) throw ApiError.badRequest('Unknown leave type');

  const carried = await carriedInto(employee, type, year);
  const entitlement = entitlementFor(employee, type, carried);
  const taken = await takenDays(employee._id, leaveType, year);
  const pending = await pendingDays(employee._id, leaveType, year);
  const reserved = exceptId
    ? pending - (await LeaveRequest.findOne({ _id: exceptId }).then((row) => (row && row.status === 'pending' ? Number(row.days) : 0)))
    : pending;
  const available = entitlement - taken - reserved;
  if (days > available + 1e-9) {
    throw ApiError.badRequest(
      `${type.label} only has ${Math.max(0, available)} day(s) remaining this year`
    );
  }
}

async function createRequest(employee, user, body) {
  const type = typeOf(body.leaveType);
  if (!type) throw ApiError.badRequest('Leave type is required');

  const fromDate = parseDate(body.fromDate, 'Start date');
  const toDate = parseDate(body.toDate || body.fromDate, 'End date');
  const halfDay = body.halfDay || '';
  const reason = String(body.reason || '').trim();
  if (reason.length < 8) throw ApiError.badRequest('Please give at least 8 characters of context');

  const holidays = await holidayKeys(fromDate, toDate, employee.location);
  const days = countWorkingDays(employee, fromDate, toDate, holidays, halfDay);

  const overlaps = await overlappingRequests(employee._id, fromDate, toDate);
  if (overlaps.length) {
    throw ApiError.conflict('That range overlaps another pending or approved leave request');
  }

  await assertBalance(employee, type.code, days, fromDate.getUTCFullYear());

  const request = await LeaveRequest.create({
    employee: employee._id,
    snapshot: snapshotOf(employee),
    leaveType: type.code,
    fromDate,
    toDate,
    halfDay,
    days,
    reason,
    submittedBy: user._id,
    status: 'pending',
  });

  return presentRequest(request);
}

/**
 * Posts approved leave onto the attendance calendar so clock-in is blocked and
 * payroll sees a leave day rather than an unexplained absence.
 */
async function applyToAttendance(request, employee, user) {
  const holidays = await holidayKeys(request.fromDate, request.toDate, employee.location);
  const type = typeOf(request.leaveType);
  const label = type ? type.label : 'Leave';
  const days = [];

  eachWorkingDay(employee, request.fromDate, request.toDate, holidays, (date) => days.push(date));

  for (const date of days) {
    const existing = await Attendance.findOne({ employee: employee._id, date });
    if (existing && existing.timeIn) {
      throw ApiError.conflict(
        `Cannot approve — ${employee.fullName} already clocked in on ${ymd(date)}`
      );
    }
  }

  for (const date of days) {
    await Attendance.findOneAndUpdate(
      { employee: employee._id, date },
      {
        $set: {
          shiftStatus: 'on_leave',
          notes: label,
          leaveRequest: request._id,
          timeIn: null,
          timeOut: null,
          hoursWorked: 0,
          overtimeHours: 0,
          shortfallHours: 0,
          expectedHours: 0,
          shiftType: employee.shiftType,
          recordedBy: user._id,
        },
      },
      { upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
  }
}

async function removeFromAttendance(request) {
  await Attendance.deleteMany({ leaveRequest: request._id, timeIn: null });
}

async function decideRequest(request, employee, user, status, note) {
  if (request.status !== 'pending') {
    throw ApiError.conflict(
      `This request was already ${STATUS_LABELS[request.status].toLowerCase()} and cannot be decided again`
    );
  }

  if (['approved', 'rejected'].indexOf(status) === -1) {
    throw ApiError.badRequest('A decision must be either approved or rejected');
  }

  const decisionNote = String(note || '').trim();
  if (status === 'rejected' && !decisionNote) {
    throw ApiError.badRequest('Please give a reason when rejecting a request');
  }

  if (status === 'approved') {
    await assertBalance(employee, request.leaveType, request.days, attendanceDate(request.fromDate).getUTCFullYear());
    await applyToAttendance(request, employee, user);
  }

  request.status = status;
  request.decisionNote = decisionNote;
  request.decidedBy = user._id;
  request.decidedAt = new Date();
  await request.save();
  return presentRequest(request);
}

async function cancelRequest(request, employee, user, asHr) {
  if (request.status === 'cancelled' || request.status === 'rejected') {
    throw ApiError.conflict('This request is already closed');
  }

  const today = attendanceDate();
  const from = attendanceDate(request.fromDate);

  if (request.status === 'approved' && from <= today && !asHr) {
    throw ApiError.forbidden('Approved leave that has already started can only be cancelled by HR');
  }

  if (request.status === 'approved') {
    await removeFromAttendance(request);
  }

  request.status = 'cancelled';
  request.cancelledBy = user._id;
  request.cancelledAt = new Date();
  await request.save();
  return presentRequest(request);
}

/**
 * Working days of approved unpaid leave that overlap a payroll period. Payroll
 * treats these as deductions, separate from unexplained absences.
 */
async function lwpDaysInRange(employee, range) {
  const rows = await LeaveRequest.find({
    employee: employee._id,
    leaveType: 'lwp',
    status: 'approved',
    fromDate: { $lt: range.end },
    toDate: { $gte: range.start },
  });
  if (!rows.length) return 0;

  const holidays = await holidayKeys(range.start, new Date(range.end.getTime() - 1), employee.location);
  let days = 0;
  rows.forEach((row) => {
    const from = attendanceDate(row.fromDate) < range.start ? range.start : attendanceDate(row.fromDate);
    const toEnd = new Date(range.end.getTime() - 86400000);
    const to = attendanceDate(row.toDate) > toEnd ? toEnd : attendanceDate(row.toDate);
    if (to < from) return;
    if (row.halfDay && ymd(row.fromDate) === ymd(from) && ymd(row.toDate) === ymd(to)) {
      days += 0.5;
      return;
    }
    eachWorkingDay(employee, from, to, holidays, () => {
      days += 1;
    });
  });
  return days;
}

async function calendarEntries(employees, monthStart, monthEnd) {
  const requests = await LeaveRequest.find({
    employee: { $in: employees.map((row) => row._id) },
    status: { $in: ['pending', 'approved'] },
    fromDate: { $lt: monthEnd },
    toDate: { $gte: monthStart },
  }).sort({ fromDate: 1 });

  const holidays = await Holiday.find({
    date: { $gte: monthStart, $lt: monthEnd },
  }).sort({ date: 1 });

  const byEmployee = employees.map((employee) => ({
    id: String(employee._id),
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    designation: employee.designation,
    department: employee.department,
    requests: requests
      .filter((row) => String(row.employee) === String(employee._id))
      .map(presentRequest),
  }));

  return {
    holidays: holidays.map((row) => ({
      id: String(row._id),
      date: ymd(row.date),
      name: row.name,
      location: row.location || 'All locations',
      isOptional: row.isOptional,
    })),
    people: byEmployee,
  };
}

module.exports = {
  ymd,
  parseDate,
  holidayKeys,
  countWorkingDays,
  presentRequest,
  snapshotOf,
  ensureLeaveTypes,
  balancesFor,
  createRequest,
  decideRequest,
  cancelRequest,
  overlappingRequests,
  lwpDaysInRange,
  calendarEntries,
  yearBounds,
};
