'use strict';

const { WEEKDAYS, WEEKDAY_LABELS } = require('../config/hr');
const shiftRegistry = require('../config/shiftRegistry');
const zoned = require('../utils/zoned');
const env = require('../config/env');
const {
  GRACE_HOURS,
  DEFAULT_EXPECTED_HOURS,
  STATUS_LABELS,
} = require('../config/attendance');

function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Attendance is keyed by calendar day, so a timestamp is reduced to the UTC
 * midnight of the *local* day it falls on. Everything that reads `date` back out
 * must use the UTC getters to avoid shifting the day across a timezone offset.
 */
function attendanceDate(when) {
  const key = zoned.dateKey(when ? new Date(when) : new Date(), env.timezone);
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function weekdayKey(date) {
  return WEEKDAYS[(date.getUTCDay() + 6) % 7];
}

/** The shift an employee is rostered on, with the hours a full day owes. */
function shiftFor(shiftType) {
  const shift = shiftRegistry.get(shiftType);
  return Object.assign({}, shift, {
    type: shiftType || shift.type,
    expectedHours: shift.expectedHours || DEFAULT_EXPECTED_HOURS,
  });
}

/**
 * Turns a clock-in/clock-out pair into hours worked, overtime and a status.
 * Overtime and short days are decided by the distance from the shift's expected
 * hours, ignoring anything inside the grace band.
 */
function computeTotals(timeIn, timeOut, shift) {
  const elapsedHours = (new Date(timeOut).getTime() - new Date(timeIn).getTime()) / 3600000;
  const hoursWorked = round2(Math.max(0, elapsedHours - shift.breakMinutes / 60));
  const difference = hoursWorked - shift.expectedHours;

  if (difference > GRACE_HOURS) {
    return {
      hoursWorked,
      overtimeHours: round2(difference),
      shortfallHours: 0,
      shiftStatus: 'present',
    };
  }

  if (difference < -GRACE_HOURS) {
    return {
      hoursWorked,
      overtimeHours: 0,
      shortfallHours: round2(-difference),
      shiftStatus: 'short_day',
    };
  }

  return { hoursWorked, overtimeHours: 0, shortfallHours: 0, shiftStatus: 'present' };
}

/** Parses "YYYY-MM" into the UTC half-open range [start, end). */
function monthRange(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!match) return null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;

  return {
    month: match[0],
    year,
    monthIndex,
    start: new Date(Date.UTC(year, monthIndex, 1)),
    end: new Date(Date.UTC(year, monthIndex + 1, 1)),
  };
}

function currentMonth() {
  return zoned.dateKey(new Date(), env.timezone).slice(0, 7);
}

/**
 * Expands a month into one entry per day, resolving a status for days that have
 * no record of their own. Doing this server-side keeps a single definition of
 * what "absent" means rather than re-deriving it in the browser.
 */
function buildMonth(employee, range, records, now, holidays) {
  const holidaySet = holidays || new Set();
  const today = attendanceDate(now);
  const joined = employee.dateOfJoining ? attendanceDate(employee.dateOfJoining) : null;
  const left = employee.lastWorkingDay ? attendanceDate(employee.lastWorkingDay) : null;
  const restDays = employee.restDays || [];

  const byDate = records.reduce((map, record) => {
    map[record.date.toISOString().slice(0, 10)] = record;
    return map;
  }, {});

  const days = [];
  const summary = {
    presentDays: 0,
    shortDays: 0,
    absentDays: 0,
    leaveDays: 0,
    restDays: 0,
    holidayDays: 0,
    holidayWorkedHours: 0,
    inProgressDays: 0,
    missedPunchDays: 0,
    lateCount: 0,
    lateMinutes: 0,
    earlyExitCount: 0,
    overtimeHours: 0,
    shortfallHours: 0,
    hoursWorked: 0,
  };

  for (let cursor = new Date(range.start); cursor < range.end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = new Date(cursor);
    const iso = date.toISOString().slice(0, 10);
    const weekday = weekdayKey(date);
    const record = byDate[iso];
    const isRestDay = restDays.indexOf(weekday) !== -1;
    const isHoliday = !isRestDay && holidaySet.has(iso);

    // A rest day is known in advance, so it stays a rest day rather than
    // becoming "upcoming" just because it has not happened yet.
    let status;
    if (record) {
      const open = record.timeIn && !record.timeOut;
      // An open day older than yesterday can no longer be a shift in progress (night shifts end by the next morning).
      const stale = record.date < new Date(today.getTime() - 86400000);
      status = open ? ((record.flags || []).indexOf('missed_punch') !== -1 || stale ? 'missing_punch' : 'in_progress') : record.shiftStatus;
    }
    else if ((joined && date < joined) || (left && date > left)) status = 'not_employed';
    else if (isRestDay) status = 'rest_day';
    else if (isHoliday) status = 'holiday';
    else if (date > today) status = 'upcoming';
    else if (employee.attendanceMode === 'exempt') status = 'present';
    else status = 'absent';

    if (status === 'present') summary.presentDays += 1;
    else if (status === 'short_day') summary.shortDays += 1;
    else if (status === 'absent') summary.absentDays += 1;
    else if (status === 'on_leave') summary.leaveDays += 1;
    else if (status === 'rest_day') summary.restDays += 1;
    else if (status === 'holiday') summary.holidayDays += 1;
    else if (status === 'in_progress') summary.inProgressDays += 1;
    else if (status === 'missing_punch') summary.missedPunchDays += 1;

    if (record) {
      if (record.lateMinutes) {
        summary.lateCount += 1;
        summary.lateMinutes += record.lateMinutes;
      }
      if (record.earlyExitMinutes) summary.earlyExitCount += 1;
      summary.hoursWorked += record.hoursWorked || 0;
      if (isHoliday) {
        // Everything worked on a gazetted holiday is paid at the holiday rate,
        // so it is counted there rather than as ordinary overtime or shortfall.
        summary.holidayWorkedHours += record.hoursWorked || 0;
        summary.holidayDays += 1;
      } else {
        summary.overtimeHours += record.overtimeHours || 0;
        summary.shortfallHours += record.shortfallHours || 0;
      }
    }

    days.push({
      date: iso,
      weekday,
      weekdayLabel: WEEKDAY_LABELS[weekday],
      status,
      statusLabel: STATUS_LABELS[status],
      isRestDay,
      isHoliday,
      isToday: date.getTime() === today.getTime(),
      isFuture: date > today,
      timeIn: record && record.timeIn ? record.timeIn.toISOString() : null,
      timeOut: record && record.timeOut ? record.timeOut.toISOString() : null,
      hoursWorked: record ? record.hoursWorked : 0,
      expectedHours: record ? record.expectedHours : null,
      overtimeHours: record ? record.overtimeHours : 0,
      shortfallHours: record ? record.shortfallHours : 0,
      shiftLabel: record ? shiftFor(record.shiftType).label : null,
      lateMinutes: record ? record.lateMinutes || 0 : 0,
      earlyExitMinutes: record ? record.earlyExitMinutes || 0 : 0,
      punchCount: record ? record.punchCount || 0 : 0,
      flags: record ? record.flags || [] : [],
      source: record ? record.source : null,
      notes: (record && record.notes) || '',
    });
  }

  summary.overtimeHours = round2(summary.overtimeHours);
  summary.shortfallHours = round2(summary.shortfallHours);
  summary.hoursWorked = round2(summary.hoursWorked);
  summary.holidayWorkedHours = round2(summary.holidayWorkedHours);

  return { days, summary };
}

module.exports = {
  round2,
  attendanceDate,
  weekdayKey,
  shiftFor,
  computeTotals,
  monthRange,
  currentMonth,
  buildMonth,
};
