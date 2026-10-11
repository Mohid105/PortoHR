'use strict';

/**
 * The two management views of attendance: the live board for one day, and the
 * monthly register (muster roll) for everyone.
 */

const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const Holiday = require('../models/Holiday');
const ShiftRoster = require('../models/ShiftRoster');
const AttendanceLock = require('../models/AttendanceLock');
const ApiError = require('../utils/ApiError');
const zoned = require('../utils/zoned');
const registry = require('../config/shiftRegistry');
const { buildMonth, monthRange } = require('./attendance.service');
const ops = require('./attendanceOps.service');
const engine = require('./attendanceEngine');

const { TZ, dayDate, keyOf } = ops;
const ACTIVE = ['probation', 'confirmed', 'notice_period'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function scopeFilter(scopeIds, query, extra) {
  const filter = Object.assign({}, extra || {});
  if (scopeIds) filter._id = { $in: scopeIds };
  if (query.department) filter.department = String(query.department);
  if (query.q) {
    const term = new RegExp(String(query.q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ firstName: term }, { lastName: term }, { employeeCode: term }];
  }
  return filter;
}

/* ============================== live board ============================== */

const LABELS = {
  in: 'Clocked in',
  present: 'Present',
  short: 'Short day',
  not_in: 'Not in yet',
  not_yet: 'Shift not started',
  absent: 'Absent',
  leave: 'On leave',
  off: 'Day off',
  missed: 'Missed punch',
};

async function board(scopeIds, query) {
  const now = new Date();
  const today = ops.todayKey(now);
  const key = /^\d{4}-\d{2}-\d{2}$/.test(String(query.date || '')) ? String(query.date) : today;
  if (key > today) throw ApiError.badRequest('Choose today or an earlier date');
  const isToday = key === today;

  const employees = await Employee.find(
    scopeFilter(scopeIds, query, {
      employmentStatus: { $in: ACTIVE.concat(key < today ? ['resigned', 'terminated'] : []) },
      dateOfJoining: { $lte: dayDate(key) },
      $and: [{ $or: [{ lastWorkingDay: null }, { lastWorkingDay: { $gte: dayDate(key) } }] }],
    })
  )
    .select('employeeCode firstName lastName department designation shiftType restDays location attendanceMode')
    .sort({ firstName: 1, lastName: 1 })
    .limit(1000);
  const ids = employees.map((e) => e._id);

  const [records, yesterdayOpen, rosters, holidays] = await Promise.all([
    Attendance.find({ employee: { $in: ids }, date: dayDate(key) }).lean(),
    isToday
      ? Attendance.find({ employee: { $in: ids }, date: dayDate(zoned.addDays(key, -1)), timeIn: { $ne: null }, timeOut: null, source: 'punch', flags: { $ne: 'missed_punch' } }).lean()
      : [],
    ShiftRoster.find({ employee: { $in: ids }, from: { $lte: dayDate(key) }, to: { $gte: dayDate(key) } }).lean(),
    Holiday.find({ date: dayDate(key), isOptional: { $ne: true } }).lean(),
  ]);
  const byEmployee = new Map(records.map((r) => [String(r.employee), r]));
  const stillIn = new Map(yesterdayOpen.map((r) => [String(r.employee), r]));
  const rosterOf = new Map(rosters.map((r) => [String(r.employee), r.shift]));
  const weekday = WEEKDAYS[zoned.weekdayOf(key)];

  const rows = employees.map((employee) => {
    const rec = byEmployee.get(String(employee._id));
    const carried = stillIn.get(String(employee._id));
    const shift = registry.get(rosterOf.get(String(employee._id)) || employee.shiftType);
    const restDay = (employee.restDays || []).includes(weekday);
    const holiday = holidays.find((h) => !h.location || h.location === employee.location);
    let status;
    let record = rec || null;

    if (rec && (rec.shiftStatus === 'on_leave' || rec.source === 'leave')) status = 'leave';
    else if (rec && rec.timeIn && !rec.timeOut) status = (rec.flags || []).includes('missed_punch') ? 'missed' : 'in';
    else if (rec && rec.shiftStatus === 'absent') status = 'absent';
    else if (rec && rec.shiftStatus === 'short_day') status = 'short';
    else if (rec) status = 'present';
    else if (carried) { status = 'in'; record = carried; }
    else if (restDay || holiday) status = 'off';
    else if (employee.attendanceMode === 'exempt') status = 'present';
    else if (!isToday) status = 'absent';
    else {
      const start = shift.fixed ? zoned.zonedTime(key, shift.startTime, TZ) : null;
      status = start && now < start ? 'not_yet' : 'not_in';
    }

    return {
      id: String(employee._id),
      code: employee.employeeCode,
      name: employee.fullName,
      department: employee.department,
      designation: employee.designation,
      shift: shift.code,
      shiftLabel: shift.label,
      status,
      label: LABELS[status],
      dayOff: restDay ? 'Rest day' : holiday ? holiday.name : '',
      timeIn: record && record.timeIn ? record.timeIn : null,
      timeOut: record && record.timeOut ? record.timeOut : null,
      lateMinutes: record ? record.lateMinutes || 0 : 0,
      hoursWorked: record ? record.hoursWorked || 0 : 0,
      flags: record ? record.flags || [] : [],
    };
  });

  const count = (statuses) => rows.filter((r) => statuses.includes(r.status)).length;
  return {
    date: key,
    isToday,
    counts: {
      total: rows.length,
      in: count(['in']),
      present: count(['present', 'short']),
      late: rows.filter((r) => r.lateMinutes > 0).length,
      notIn: count(['not_in', 'absent']),
      notYet: count(['not_yet']),
      leave: count(['leave']),
      off: count(['off']),
      missed: count(['missed']),
    },
    rows,
  };
}

/* ============================ monthly register ============================ */

const CODES = {
  present: 'P',
  short_day: 'S',
  absent: 'A',
  on_leave: 'L',
  in_progress: 'P',
  missing_punch: 'M',
  rest_day: 'W',
  holiday: 'H',
  upcoming: '',
  not_employed: '',
};

async function register(scopeIds, query) {
  const range = monthRange(query.month || ops.todayKey().slice(0, 7));
  if (!range) throw ApiError.badRequest('Month must be in YYYY-MM format');
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(200, Math.max(10, Number(query.limit) || 100));

  const filter = scopeFilter(scopeIds, query, {
    dateOfJoining: { $lt: range.end },
    $and: [{ $or: [{ lastWorkingDay: null }, { lastWorkingDay: { $gte: range.start } }] }],
    employmentStatus: { $in: ACTIVE.concat(['resigned', 'terminated']) },
  });
  const [employees, total] = await Promise.all([
    Employee.find(filter).select('employeeCode firstName lastName department designation restDays location shiftType dateOfJoining lastWorkingDay attendanceMode').sort({ employeeCode: 1 }).skip((page - 1) * limit).limit(limit),
    Employee.countDocuments(filter),
  ]);
  const ids = employees.map((e) => e._id);
  const [records, holidays, lock] = await Promise.all([
    Attendance.find({ employee: { $in: ids }, date: { $gte: range.start, $lt: range.end } }).lean(),
    Holiday.find({ date: { $gte: range.start, $lt: range.end }, isOptional: { $ne: true } }).lean(),
    AttendanceLock.findOne({ month: range.month }).lean(),
  ]);
  const byEmployee = new Map();
  records.forEach((r) => {
    const k = String(r.employee);
    if (!byEmployee.has(k)) byEmployee.set(k, []);
    byEmployee.get(k).push(r);
  });

  const policy = await ops.getPolicy();
  const daysInMonth = (range.end - range.start) / 86400000;
  const now = new Date();
  const rows = employees.map((employee) => {
    const holidaySet = new Set(holidays.filter((h) => !h.location || h.location === employee.location).map((h) => keyOf(h.date)));
    const { days, summary } = buildMonth(employee, range, byEmployee.get(String(employee._id)) || [], now, holidaySet);
    return {
      id: String(employee._id),
      code: employee.employeeCode,
      name: employee.fullName,
      department: employee.department,
      cells: days.map((d) => {
        const rec = (byEmployee.get(String(employee._id)) || []).find((r) => keyOf(r.date) === d.date);
        return { code: CODES[d.status] !== undefined ? CODES[d.status] : '', late: Boolean(d.lateMinutes), ot: d.overtimeHours > 0, status: d.status, manual: Boolean(rec && rec.source === 'manual') };
      }),
      totals: {
        present: summary.presentDays + summary.shortDays + summary.inProgressDays,
        absent: summary.absentDays,
        leave: summary.leaveDays,
        rest: summary.restDays,
        holiday: summary.holidayDays,
        missed: summary.missedPunchDays,
        late: summary.lateCount,
        overtime: summary.overtimeHours,
        hours: summary.hoursWorked,
        latePenaltyDays: engine.latePenaltyDays(summary.lateCount, policy),
      },
    };
  });

  return {
    month: range.month,
    days: daysInMonth,
    weekdays: Array.from({ length: daysInMonth }, (_, i) => WEEKDAYS[zoned.weekdayOf(zoned.addDays(`${range.month}-01`, i))].slice(0, 1).toUpperCase()),
    locked: Boolean(lock),
    lockedBy: lock ? lock.lockedByName : '',
    page,
    pages: Math.ceil(total / limit) || 1,
    total,
    rows,
  };
}

module.exports = { board, register, CODES, LABELS };
