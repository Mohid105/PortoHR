'use strict';

/**
 * Attendance operations: taking punches, rebuilding a day from them,
 * correcting a day, rostering shifts and locking a month. The engine decides
 * what a day's punches mean; this file decides which punches belong to a day
 * and keeps the stored attendance record in step with them.
 */

const mongoose = require('mongoose');
const Attendance = require('../models/Attendance');
const AttendancePunch = require('../models/AttendancePunch');
const AttendanceRequest = require('../models/AttendanceRequest');
const AttendancePolicy = require('../models/AttendancePolicy');
const AttendanceLock = require('../models/AttendanceLock');
const ShiftRoster = require('../models/ShiftRoster');
const Holiday = require('../models/Holiday');
const Employee = require('../models/Employee');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');
const zoned = require('../utils/zoned');
const registry = require('../config/shiftRegistry');
const engine = require('./attendanceEngine');

const TZ = env.timezone;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const dayDate = (key) => new Date(`${key}T00:00:00Z`);
const keyOf = (date) => new Date(date).toISOString().slice(0, 10);
const todayKey = (now) => zoned.dateKey(now || new Date(), TZ);

/* ---------------- policy ---------------- */

let policyCache = { at: 0, doc: null };

async function getPolicy() {
  if (policyCache.doc && Date.now() - policyCache.at < 20000) return policyCache.doc;
  let doc = await AttendancePolicy.findOne({ key: 'default' });
  if (!doc) doc = await AttendancePolicy.create({ key: 'default' });
  policyCache = { at: Date.now(), doc };
  return doc;
}

const POLICY_FIELDS = {
  minPunchGapMinutes: [0, 60],
  minSpanMinutes: [0, 120],
  autoCloseHours: [4, 48],
};

async function savePolicy(body) {
  const doc = await getPolicy();
  const num = (value, label, min, max) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max) throw ApiError.badRequest(`${label} must be between ${min} and ${max}`);
    return n;
  };
  Object.keys(POLICY_FIELDS).forEach((key) => {
    if (body[key] !== undefined) doc[key] = num(body[key], key, POLICY_FIELDS[key][0], POLICY_FIELDS[key][1]);
  });
  const o = body.overtime || {};
  if (o.enabled !== undefined) doc.overtime.enabled = Boolean(o.enabled);
  if (o.thresholdMinutes !== undefined) doc.overtime.thresholdMinutes = num(o.thresholdMinutes, 'Overtime threshold', 0, 240);
  if (o.roundToMinutes !== undefined) doc.overtime.roundToMinutes = num(o.roundToMinutes, 'Overtime rounding', 1, 60);
  if (o.restDayAllOvertime !== undefined) doc.overtime.restDayAllOvertime = Boolean(o.restDayAllOvertime);
  const l = body.late || {};
  if (l.penaltyEveryNLates !== undefined) doc.late.penaltyEveryNLates = num(l.penaltyEveryNLates, 'Late marks per penalty', 0, 31);
  if (l.penaltyDays !== undefined) doc.late.penaltyDays = num(l.penaltyDays, 'Penalty days', 0, 5);
  const w = body.webPunch || {};
  if (w.allowed !== undefined) doc.webPunch.allowed = Boolean(w.allowed);
  if (w.undoMinutes !== undefined) doc.webPunch.undoMinutes = num(w.undoMinutes, 'Undo window', 0, 60);
  if (w.backfillHours !== undefined) doc.webPunch.backfillHours = num(w.backfillHours, 'Offline punch window', 0, 72);
  const r = body.regularization || {};
  if (r.maxBackDays !== undefined) doc.regularization.maxBackDays = num(r.maxBackDays, 'Correction window', 1, 120);
  if (r.maxPerMonth !== undefined) doc.regularization.maxPerMonth = num(r.maxPerMonth, 'Corrections per month', 0, 31);
  await doc.save();
  policyCache = { at: Date.now(), doc };
  return doc.toJSON();
}

/* ---------------- days, shifts, rosters ---------------- */

/** The shift an employee works on `key`: a roster entry wins over their standing shift. */
function shiftCodeOn(employee, rosterRanges, key) {
  const date = dayDate(key).getTime();
  const hit = (rosterRanges || []).find((r) => new Date(r.from).getTime() <= date && new Date(r.to).getTime() >= date);
  return hit ? hit.shift : employee.shiftType;
}

function shiftOfDayFor(employee, rosterRanges) {
  return (key) => registry.get(shiftCodeOn(employee, rosterRanges, key));
}

function isRestDayFor(employee, key) {
  return (employee.restDays || []).includes(WEEKDAYS[zoned.weekdayOf(key)]);
}

async function rosterFor(employeeId, fromKey, toKey) {
  return ShiftRoster.find({ employee: employeeId, from: { $lte: dayDate(toKey) }, to: { $gte: dayDate(fromKey) } }).lean();
}

async function holidayOn(key, location) {
  const row = await Holiday.findOne({
    date: dayDate(key),
    isOptional: { $ne: true },
    $or: [{ location: '' }, { location: location || '' }],
  }).lean();
  return row || null;
}

/* ---------------- locks ---------------- */

async function lockedMonths(keys) {
  const months = Array.from(new Set(keys.map((k) => k.slice(0, 7))));
  if (!months.length) return new Set();
  const rows = await AttendanceLock.find({ month: { $in: months } }).select('month').lean();
  return new Set(rows.map((r) => r.month));
}

async function assertUnlocked(key) {
  const locked = await lockedMonths([key]);
  if (locked.size) throw ApiError.conflict(`Attendance for ${key.slice(0, 7)} is locked. Ask HR to reopen the month first.`);
}

/* ---------------- rebuilding a day from punches ---------------- */

async function livePunchesAround(employeeId, key) {
  return AttendancePunch.find({
    employee: employeeId,
    voided: false,
    at: { $gte: zoned.zonedTime(zoned.addDays(key, -1), '12:00', TZ), $lte: zoned.zonedTime(zoned.addDays(key, 1), '12:00', TZ) },
  })
    .sort({ at: 1 })
    .lean();
}

/**
 * Rebuilds one shift day. Days HR set by hand, and days posted by approved
 * leave, are left alone — punches never overwrite a decision.
 */
async function rebuildDay(employee, key, options) {
  const opts = options || {};
  const now = opts.now || new Date();
  const existing = await Attendance.findOne({ employee: employee._id, date: dayDate(key) });
  if (existing && (existing.source === 'manual' || existing.source === 'leave' || existing.locked || existing.shiftStatus === 'on_leave')) {
    return existing;
  }

  const rosters = await rosterFor(employee._id, zoned.addDays(key, -1), key);
  const shiftOfDay = shiftOfDayFor(employee, rosters);
  const shift = shiftOfDay(key);
  const policy = await getPolicy();
  const around = await livePunchesAround(employee._id, key);
  const mine = around.filter((p) => engine.shiftDayOf(p.at, TZ, shiftOfDay) === key).map((p) => ({ at: new Date(p.at), source: p.source }));

  const restDay = isRestDayFor(employee, key);
  const holiday = await holidayOn(key, employee.location);
  const day = engine.computeDay({ dayKey: key, punches: mine, shift, policy, timeZone: TZ, now, isRestDay: restDay, isHoliday: Boolean(holiday) });

  if (!day) {
    // Only a day we built from punches goes away when its punches do; older
    // records (made before punches existed) are kept as they are.
    if (existing && existing.source === 'punch') await Attendance.deleteOne({ _id: existing._id });
    return existing && existing.source !== 'punch' ? existing : null;
  }

  const fields = {
    employee: employee._id,
    date: dayDate(key),
    timeIn: day.timeIn,
    timeOut: day.timeOut,
    shiftType: shift.code,
    expectedHours: day.expectedHours,
    hoursWorked: day.hoursWorked,
    overtimeHours: day.overtimeHours,
    shortfallHours: day.shortfallHours,
    shiftStatus: day.shiftStatus,
    lateMinutes: day.lateMinutes,
    earlyExitMinutes: day.earlyExitMinutes,
    punchCount: day.punchCount,
    flags: day.flags,
    source: 'punch',
  };
  const saved = await Attendance.findOneAndUpdate({ employee: employee._id, date: dayDate(key) }, { $set: fields }, { upsert: true, new: true, setDefaultsOnInsert: true });
  return saved;
}

async function rebuildRange(employee, fromKey, toKey, options) {
  let key = fromKey;
  while (key <= toKey) {
    // eslint-disable-next-line no-await-in-loop
    await rebuildDay(employee, key, options);
    key = zoned.addDays(key, 1);
  }
}

/** Which shift day a punch at `at` belongs to for this employee. */
async function dayOfPunch(employee, at) {
  const key = zoned.dateKey(at, TZ);
  const rosters = await rosterFor(employee._id, zoned.addDays(key, -1), key);
  return engine.shiftDayOf(at, TZ, shiftOfDayFor(employee, rosters));
}

/* ---------------- clocking in and out on the web ---------------- */

async function stateOf(employee, now) {
  const instant = now || new Date();
  const policy = await getPolicy();
  const since = new Date(instant.getTime() - policy.autoCloseHours * 3600000);
  const recent = await AttendancePunch.find({ employee: employee._id, voided: false, at: { $gte: since, $lte: instant } }).sort({ at: 1 }).lean();

  // The open shift (if any) is the one whose punches are an odd number.
  const lastKey = recent.length ? await dayOfPunch(employee, new Date(recent[recent.length - 1].at)) : null;
  const dayKey = lastKey || (await dayOfPunch(employee, instant));
  const sameDay = [];
  for (const p of recent) {
    // eslint-disable-next-line no-await-in-loop
    if ((await dayOfPunch(employee, new Date(p.at))) === dayKey) sameDay.push(p);
  }
  const open = sameDay.length % 2 === 1;
  return { dayKey: open ? dayKey : await dayOfPunch(employee, instant), open, punches: sameDay, policy };
}

async function todayState(employee, now) {
  const instant = now || new Date();
  const state = await stateOf(employee, instant);
  const key = state.dayKey;
  const [record, rosters, holiday] = await Promise.all([
    Attendance.findOne({ employee: employee._id, date: dayDate(key) }),
    rosterFor(employee._id, zoned.addDays(key, -1), key),
    holidayOn(key, employee.location),
  ]);
  const shift = shiftOfDayFor(employee, rosters)(key);
  const onLeave = Boolean(record && (record.shiftStatus === 'on_leave' || record.source === 'leave'));
  const punches = await AttendancePunch.find({
    employee: employee._id,
    at: { $gte: zoned.zonedTime(zoned.addDays(key, -1), '12:00', TZ), $lte: zoned.zonedTime(zoned.addDays(key, 1), '12:00', TZ) },
  }).sort({ at: 1 }).lean();
  const mine = [];
  for (const p of punches) {
    // eslint-disable-next-line no-await-in-loop
    if ((await dayOfPunch(employee, new Date(p.at))) === key) mine.push(p);
  }
  return {
    dayKey: key,
    shift,
    restDay: isRestDayFor(employee, key),
    holiday: holiday ? holiday.name : null,
    onLeave,
    open: state.open,
    canClockIn: state.policy.webPunch.allowed && !state.open && !onLeave,
    canClockOut: state.policy.webPunch.allowed && state.open,
    webPunchAllowed: state.policy.webPunch.allowed,
    elapsedHours: state.open ? engine.round2((instant - new Date(state.punches[state.punches.length - 1].at)) / 3600000) : 0,
    punches: mine.map((p) => ({ id: String(p._id), at: p.at, direction: p.direction, source: p.source, voided: p.voided, note: p.note })),
    record,
  };
}

async function webPunch(employee, user, body) {
  const policy = await getPolicy();
  if (!policy.webPunch.allowed) throw ApiError.forbidden('Web clock-in is switched off. Please use the time clock.');
  const now = new Date();
  let at = now;
  let source = 'web';
  if (body.at) {
    const claimed = new Date(body.at);
    if (Number.isNaN(claimed.getTime()) || claimed > new Date(now.getTime() + 120000)) throw ApiError.badRequest('That punch time is not valid');
    if (now - claimed > policy.webPunch.backfillHours * 3600000) throw ApiError.badRequest(`A punch can only be added up to ${policy.webPunch.backfillHours} hours late. Use a correction request instead.`);
    at = claimed;
    source = now - claimed > 120000 ? 'web_offline' : 'web';
  }

  const wanted = body.direction === 'out' ? 'out' : 'in';
  const state = await stateOf(employee, at);
  if (wanted === 'in' && state.open) throw ApiError.conflict('You are already clocked in');
  if (wanted === 'out' && !state.open) throw ApiError.badRequest('You are not clocked in');

  const key = await dayOfPunch(employee, at);
  await assertUnlocked(key);
  const dayRecord = await Attendance.findOne({ employee: employee._id, date: dayDate(key) });
  if (wanted === 'in' && dayRecord && (dayRecord.shiftStatus === 'on_leave' || dayRecord.source === 'leave')) {
    throw ApiError.conflict('Today is marked as leave. Ask HR to change it before clocking in.');
  }

  const punch = await AttendancePunch.create({ employee: employee._id, at, direction: wanted, source, createdBy: user._id });
  const record = await rebuildDay(employee, key);
  return { punch, record, dayKey: key };
}

/** Takes back the caller's own most recent web punch, if it is still within the undo window. */
async function undoLastPunch(employee, user) {
  const policy = await getPolicy();
  if (!policy.webPunch.undoMinutes) throw ApiError.badRequest('Undo is switched off. Ask for a correction instead.');
  const last = await AttendancePunch.findOne({ employee: employee._id, voided: false }).sort({ at: -1 });
  if (!last || !['web', 'web_offline'].includes(last.source)) throw ApiError.badRequest('There is no recent clock punch to undo');
  if (Date.now() - new Date(last.createdAt).getTime() > policy.webPunch.undoMinutes * 60000) {
    throw ApiError.badRequest(`A punch can only be undone within ${policy.webPunch.undoMinutes} minutes. Ask for a correction instead.`);
  }
  const key = await dayOfPunch(employee, last.at);
  await assertUnlocked(key);
  last.voided = true;
  last.voidedReason = 'Taken back by the employee';
  last.voidedBy = user._id;
  last.voidedAt = new Date();
  await last.save();
  await rebuildDay(employee, key);
  return { dayKey: key, punch: last.toJSON() };
}

/* ---------------- punches: listing, adding by hand, voiding ---------------- */

async function listPunches(employee, key) {
  const around = await AttendancePunch.find({
    employee: employee._id,
    at: { $gte: zoned.zonedTime(zoned.addDays(key, -1), '12:00', TZ), $lte: zoned.zonedTime(zoned.addDays(key, 1), '12:00', TZ) },
  }).sort({ at: 1 });
  const rosters = await rosterFor(employee._id, zoned.addDays(key, -1), key);
  const shiftOfDay = shiftOfDayFor(employee, rosters);
  return around
    .filter((p) => engine.shiftDayOf(p.at, TZ, shiftOfDay) === key)
    .map((p) => p.toJSON());
}

async function addManualPunch(employee, user, body) {
  const at = new Date(body.at);
  if (Number.isNaN(at.getTime())) throw ApiError.badRequest('Enter a valid date and time');
  if (at > new Date(Date.now() + 120000)) throw ApiError.badRequest('A punch cannot be in the future');
  const key = await dayOfPunch(employee, at);
  await assertUnlocked(key);
  const note = String(body.note || '').trim();
  if (note.length < 4) throw ApiError.badRequest('Give a reason for adding this punch');
  const punch = await AttendancePunch.create({
    employee: employee._id,
    at,
    direction: body.direction === 'out' ? 'out' : body.direction === 'in' ? 'in' : 'auto',
    source: 'manual',
    note,
    createdBy: user._id,
  });
  // A hand-set day would block rebuilding; adding a punch means HR wants the punches to count.
  await Attendance.deleteOne({ employee: employee._id, date: dayDate(key), source: 'manual' });
  const record = await rebuildDay(employee, key);
  return { punch: punch.toJSON(), record, dayKey: key };
}

async function voidPunch(punchId, user, reason) {
  if (!mongoose.isValidObjectId(punchId)) throw ApiError.notFound('Punch not found');
  const punch = await AttendancePunch.findById(punchId);
  if (!punch) throw ApiError.notFound('Punch not found');
  if (punch.voided) throw ApiError.conflict('This punch is already voided');
  const text = String(reason || '').trim();
  if (text.length < 4) throw ApiError.badRequest('Give a reason for voiding this punch');
  const employee = await Employee.findById(punch.employee);
  const key = await dayOfPunch(employee, punch.at);
  await assertUnlocked(key);
  punch.voided = true;
  punch.voidedReason = text;
  punch.voidedBy = user._id;
  punch.voidedAt = new Date();
  await punch.save();
  const record = await rebuildDay(employee, key);
  return { punch: punch.toJSON(), record, employee, dayKey: key };
}

/* ---------------- HR sets a day by hand ---------------- */

async function markDay(employee, user, body) {
  const key = String(body.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw ApiError.badRequest('A valid date is required');
  await assertUnlocked(key);
  const status = body.shiftStatus;
  if (!['absent', 'on_leave', 'present', 'clear'].includes(status)) throw ApiError.badRequest('Status must be absent, on_leave, present or clear');
  const date = dayDate(key);

  if (status === 'clear') {
    await Attendance.deleteOne({ employee: employee._id, date, source: 'manual' });
    return rebuildDay(employee, key);
  }
  const existing = await Attendance.findOne({ employee: employee._id, date });
  if (existing && existing.timeIn && existing.source === 'punch') {
    throw ApiError.conflict('This day has clock times. Void or correct the punches instead.');
  }
  const shift = registry.get(employee.shiftType);
  const fields = {
    shiftStatus: status,
    source: 'manual',
    locked: true,
    notes: String(body.notes || '').slice(0, 200),
    recordedBy: user._id,
    shiftType: employee.shiftType,
    timeIn: null,
    timeOut: null,
    hoursWorked: status === 'present' ? shift.expectedHours : 0,
    expectedHours: status === 'present' ? shift.expectedHours : 0,
    overtimeHours: 0,
    shortfallHours: 0,
    lateMinutes: 0,
    earlyExitMinutes: 0,
    punchCount: 0,
    flags: ['manual'],
  };
  return Attendance.findOneAndUpdate({ employee: employee._id, date }, { $set: fields }, { upsert: true, new: true, setDefaultsOnInsert: true });
}

module.exports = {
  TZ,
  dayDate,
  keyOf,
  todayKey,
  getPolicy,
  savePolicy,
  shiftCodeOn,
  shiftOfDayFor,
  isRestDayFor,
  rosterFor,
  holidayOn,
  lockedMonths,
  assertUnlocked,
  rebuildDay,
  rebuildRange,
  dayOfPunch,
  stateOf,
  todayState,
  webPunch,
  undoLastPunch,
  listPunches,
  addManualPunch,
  voidPunch,
  markDay,
};
