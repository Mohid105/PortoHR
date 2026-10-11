'use strict';

/**
 * The attendance engine: raw punches in, one day's verdict out.
 *
 * Pure — no database, no clock of its own — so the same punches always give
 * the same attendance, which is what makes a rebuild after a correction safe.
 * Everything is judged on the company clock (`timeZone`), never the server's.
 */

const zoned = require('../utils/zoned');

const round2 = (value) => Math.round(value * 100) / 100;

const DEFAULT_POLICY = {
  minPunchGapMinutes: 2,
  minSpanMinutes: 10,
  autoCloseHours: 16,
  overtime: { enabled: true, thresholdMinutes: 15, roundToMinutes: 15, restDayAllOvertime: true },
  late: { penaltyEveryNLates: 0, penaltyDays: 0.5 },
};

function policyOf(policy) {
  const p = policy || {};
  return {
    minPunchGapMinutes: p.minPunchGapMinutes !== undefined ? p.minPunchGapMinutes : DEFAULT_POLICY.minPunchGapMinutes,
    minSpanMinutes: p.minSpanMinutes !== undefined ? p.minSpanMinutes : DEFAULT_POLICY.minSpanMinutes,
    autoCloseHours: p.autoCloseHours !== undefined ? p.autoCloseHours : DEFAULT_POLICY.autoCloseHours,
    overtime: Object.assign({}, DEFAULT_POLICY.overtime, p.overtime || {}),
    late: Object.assign({}, DEFAULT_POLICY.late, p.late || {}),
  };
}

/**
 * Which shift day does a punch belong to? Usually the calendar day it falls
 * on — but a night shift's closing punch at 06:00 belongs to the day the shift
 * began, and an evening shift can end after midnight. `shiftOfDay(dateKey)`
 * supplies the shift in force on a given day.
 */
function shiftDayOf(at, timeZone, shiftOfDay) {
  const key = zoned.dateKey(at, timeZone);
  const previous = zoned.addDays(key, -1);
  const prev = shiftOfDay(previous);
  if (!prev || !prev.fixed) return key;

  const minutes = zoned.minutesOfDay(at, timeZone);
  // The previous day's shift reaches into this calendar day, up to its window end.
  const prevWindowEnd = (prev.overnight ? prev.endMin : prev.endMin - 1440) + prev.postWindowMinutes;
  if (minutes > prevWindowEnd) return key;

  // Both days could claim this punch (a night shift followed by a day shift):
  // it belongs to whichever shift boundary it is nearer to.
  const own = shiftOfDay(key);
  const prevEnd = prev.overnight ? prev.endMin : prev.endMin - 1440;
  if (!own || !own.fixed) return minutes <= prevEnd + 120 ? previous : key;
  return Math.abs(minutes - prevEnd) <= Math.abs(minutes - own.startMin) ? previous : key;
}

/** Time-clock taps can bounce; a person pressing a button on screen means every press. */
const TAPPED = (punch) => !punch.source || punch.source === 'import' || punch.source === 'device';

/** Sorts punches and drops double taps on a time clock. Each punch is { at: Date, source? }. */
function cleanPunches(punches, policy) {
  const gap = policyOf(policy).minPunchGapMinutes * 60000;
  const sorted = punches.slice().sort((a, b) => a.at - b.at);
  const kept = [];
  sorted.forEach((punch) => {
    const last = kept[kept.length - 1];
    if (last && punch.at - last.at < gap && TAPPED(punch) && TAPPED(last)) return;
    kept.push(punch);
  });
  return kept;
}

function roundDown(minutes, step) {
  return step > 1 ? Math.floor(minutes / step) * step : Math.floor(minutes);
}

/**
 * Builds one day's attendance.
 *
 * input: {
 *   dayKey,            // 'YYYY-MM-DD' of the shift day
 *   punches,           // [{ at: Date, source }] already belonging to this day
 *   shift,             // from the shift registry
 *   policy, timeZone, now,
 *   isRestDay, isHoliday
 * }
 */
function computeDay(input) {
  const policy = policyOf(input.policy);
  const shift = input.shift;
  const tz = input.timeZone;
  const now = input.now || new Date();
  const punches = cleanPunches(input.punches || [], policy);
  const flags = [];

  if (!punches.length) return null;

  // Pair punches in order: in, out, in, out. An odd one out is an open shift.
  const pairs = [];
  for (let i = 0; i + 1 < punches.length; i += 2) pairs.push([punches[i].at, punches[i + 1].at]);
  const open = punches.length % 2 === 1;
  const minSpan = policy.minSpanMinutes * 60000;

  // A lone pair shorter than the minimum is a bounce, not a worked period.
  const usable = pairs.filter(([a, b]) => b - a >= minSpan);
  const timeIn = punches[0].at;
  const lastClosed = pairs.length ? pairs[pairs.length - 1][1] : null;
  const timeOut = lastClosed;

  if (punches.some((p) => p.source === 'import' || p.source === 'device')) flags.push('device');
  if (punches.some((p) => p.source === 'manual')) flags.push('manual');
  if (punches.some((p) => p.source === 'regularization')) flags.push('regularized');

  if (open) {
    const lastIn = punches[punches.length - 1].at;
    const stale = now - lastIn > policy.autoCloseHours * 3600000;
    if (stale) flags.push('missed_punch');
  }

  // Hours: a single in/out span carries the shift's unpaid break; several
  // pairs mean the person punched out for their breaks, so none is removed.
  let hoursWorked = 0;
  if (usable.length === 1 && pairs.length === 1) {
    const span = (usable[0][1] - usable[0][0]) / 3600000;
    hoursWorked = Math.max(0, span - (span > shift.breakMinutes / 60 + 0.5 ? shift.breakMinutes / 60 : 0));
  } else {
    hoursWorked = usable.reduce((sum, [a, b]) => sum + (b - a) / 3600000, 0);
  }
  hoursWorked = round2(hoursWorked);

  const expected = shift.expectedHours;
  const graceHours = policy.overtime.thresholdMinutes / 60;
  let overtimeHours = 0;
  let shortfallHours = 0;
  let shiftStatus = 'present';

  if (!open || pairs.length) {
    const diff = hoursWorked - expected;
    if (input.isRestDay && policy.overtime.restDayAllOvertime) {
      // Work on a weekly rest day is overtime from the first hour.
      overtimeHours = policy.overtime.enabled ? round2(roundDown(hoursWorked * 60, policy.overtime.roundToMinutes) / 60) : 0;
      flags.push('rest_day_work');
    } else if (diff > graceHours) {
      overtimeHours = policy.overtime.enabled ? round2(roundDown(diff * 60, policy.overtime.roundToMinutes) / 60) : 0;
    } else if (diff < -0.25 && !open) {
      shortfallHours = round2(-diff);
      shiftStatus = 'short_day';
    }
  }
  if (input.isHoliday) flags.push('holiday_work');

  // Lateness and early leaving are measured against the shift's own window.
  let lateMinutes = 0;
  let earlyExitMinutes = 0;
  if (shift.fixed && !input.isRestDay) {
    const start = zoned.zonedTime(input.dayKey, shift.startTime, tz);
    let end = zoned.zonedTime(input.dayKey, shift.endTime, tz);
    if (shift.overnight) end = new Date(end.getTime() + 86400000);
    const lateBy = Math.round((timeIn - start) / 60000);
    if (lateBy > shift.graceInMinutes) {
      lateMinutes = lateBy;
      flags.push('late');
    }
    if (timeOut && !open) {
      const earlyBy = Math.round((end - timeOut) / 60000);
      if (earlyBy > shift.graceOutMinutes) {
        earlyExitMinutes = earlyBy;
        flags.push('early_exit');
      }
    }
  }

  return {
    timeIn,
    timeOut: open ? null : timeOut,
    open,
    punchCount: punches.length,
    hoursWorked,
    overtimeHours,
    shortfallHours,
    lateMinutes,
    earlyExitMinutes,
    shiftStatus,
    expectedHours: expected,
    flags: Array.from(new Set(flags)),
  };
}

/** Late arrivals → days of pay lost, under the policy's "every N lates" rule. */
function latePenaltyDays(lateMarks, policy) {
  const p = policyOf(policy).late;
  if (!p.penaltyEveryNLates || p.penaltyEveryNLates < 1) return 0;
  return Math.floor(lateMarks / p.penaltyEveryNLates) * p.penaltyDays;
}

module.exports = { DEFAULT_POLICY, policyOf, shiftDayOf, cleanPunches, computeDay, latePenaltyDays, round2 };
