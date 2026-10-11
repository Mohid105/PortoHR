'use strict';

/**
 * Corrections, imports, rosters and month locks: the parts of attendance that
 * change records after the fact. Each one ends by rebuilding the affected days
 * from punches, so the stored attendance never drifts from what happened.
 */

const mongoose = require('mongoose');
const crypto = require('crypto');
const Attendance = require('../models/Attendance');
const AttendancePunch = require('../models/AttendancePunch');
const AttendanceRequest = require('../models/AttendanceRequest');
const AttendanceLock = require('../models/AttendanceLock');
const ShiftRoster = require('../models/ShiftRoster');
const Employee = require('../models/Employee');
const ApiError = require('../utils/ApiError');
const zoned = require('../utils/zoned');
const registry = require('../config/shiftRegistry');
const ops = require('./attendanceOps.service');

const { TZ, dayDate, keyOf } = ops;
const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const padTime = (t) => (t ? t.padStart(5, '0') : '');

function snapshotOf(employee) {
  return { employeeCode: employee.employeeCode, fullName: employee.fullName, designation: employee.designation, department: employee.department };
}

function employed(employee, key) {
  const joined = employee.dateOfJoining ? keyOf(employee.dateOfJoining) : null;
  const left = employee.lastWorkingDay ? keyOf(employee.lastWorkingDay) : null;
  return !(joined && key < joined) && !(left && key > left);
}

/* ============================ regularization ============================ */

const TYPE_LABELS = {
  missed_punch: 'Missed punch',
  correction: 'Time correction',
  on_duty: 'On official duty',
  work_from_home: 'Work from home',
};

function present(doc) {
  const json = doc.toJSON();
  json.id = String(json.id || json._id);
  json.date = keyOf(json.date);
  json.typeLabel = TYPE_LABELS[json.type] || json.type;
  return json;
}

async function createRequest(employee, user, body) {
  const policy = await ops.getPolicy();
  const key = String(body.date || '').slice(0, 10);
  if (!DATE.test(key)) throw ApiError.badRequest('Choose the date to correct');
  const today = ops.todayKey();
  if (key > today) throw ApiError.badRequest('You can only correct today or an earlier day');
  if (key < zoned.addDays(today, -policy.regularization.maxBackDays)) {
    throw ApiError.badRequest(`Corrections can only be requested for the last ${policy.regularization.maxBackDays} days`);
  }
  if (!employed(employee, key)) throw ApiError.badRequest('The employee was not employed on that date');
  await ops.assertUnlocked(key);

  const type = body.type;
  if (!AttendanceRequest.TYPES.includes(type)) throw ApiError.badRequest('Choose what kind of correction this is');
  const timeIn = padTime(String(body.timeIn || '').trim());
  const timeOut = padTime(String(body.timeOut || '').trim());
  if ((timeIn && !TIME.test(timeIn)) || (timeOut && !TIME.test(timeOut))) throw ApiError.badRequest('Times must look like 09:00');
  if (type === 'missed_punch' && !timeIn && !timeOut) throw ApiError.badRequest('Enter the time you forgot to punch');
  if (type === 'correction' && (!timeIn || !timeOut)) throw ApiError.badRequest('A correction needs both the in and the out time');
  const reason = String(body.reason || '').trim();
  if (reason.length < 8) throw ApiError.badRequest('Please give at least 8 characters of explanation');

  const existingDay = await Attendance.findOne({ employee: employee._id, date: dayDate(key) });
  if (existingDay && (existingDay.shiftStatus === 'on_leave' || existingDay.source === 'leave')) {
    throw ApiError.conflict('That day is on approved leave. Cancel the leave first if you worked.');
  }
  if (await AttendanceRequest.findOne({ employee: employee._id, date: dayDate(key), status: 'pending' })) {
    throw ApiError.conflict('There is already a pending request for that day');
  }
  if (policy.regularization.maxPerMonth) {
    const monthStart = dayDate(`${key.slice(0, 7)}-01`);
    const monthEnd = dayDate(zoned.addDays(`${key.slice(0, 7)}-28`, 5).slice(0, 7) + '-01');
    const used = await AttendanceRequest.countDocuments({ employee: employee._id, date: { $gte: monthStart, $lt: monthEnd }, status: { $in: ['pending', 'approved'] } });
    if (used >= policy.regularization.maxPerMonth) throw ApiError.badRequest(`You have used all ${policy.regularization.maxPerMonth} corrections allowed for that month`);
  }

  const row = await AttendanceRequest.create({
    employee: employee._id,
    snapshot: snapshotOf(employee),
    date: dayDate(key),
    type,
    timeIn,
    timeOut,
    outNextDay: Boolean(body.outNextDay),
    replace: type === 'correction' ? body.replace !== false : Boolean(body.replace),
    reason,
    submittedBy: user._id,
  });
  return present(row);
}

/** Turns an approved request into punches and rebuilds the day. */
async function applyRequest(request, employee, user) {
  const key = keyOf(request.date);
  await ops.assertUnlocked(key);
  const rosters = await ops.rosterFor(employee._id, zoned.addDays(key, -1), key);
  const shift = ops.shiftOfDayFor(employee, rosters)(key);

  let inAt = request.timeIn ? zoned.zonedTime(key, request.timeIn, TZ) : null;
  let outAt = request.timeOut ? zoned.zonedTime(zoned.addDays(key, request.outNextDay ? 1 : 0), request.timeOut, TZ) : null;
  if (inAt && outAt && outAt <= inAt && !request.outNextDay) outAt = new Date(outAt.getTime() + 86400000); // a night shift ending after midnight

  if (request.type === 'on_duty' || request.type === 'work_from_home') {
    if (!inAt && !outAt) {
      if (shift.fixed) {
        inAt = zoned.zonedTime(key, shift.startTime, TZ);
        outAt = zoned.zonedTime(zoned.addDays(key, shift.overnight ? 1 : 0), shift.endTime, TZ);
      } else {
        inAt = zoned.zonedTime(key, '09:00', TZ);
        outAt = new Date(inAt.getTime() + (shift.expectedHours + shift.breakMinutes / 60) * 3600000);
      }
    }
  }
  if (inAt && outAt && outAt <= inAt) throw ApiError.badRequest('The out time must be after the in time');
  if (!inAt && !outAt) throw ApiError.badRequest('The request has no times to apply');

  if (request.replace) {
    const around = await ops.listPunches(employee, key);
    const live = around.filter((p) => !p.voided).map((p) => p._id || p.id);
    if (live.length) {
      await AttendancePunch.updateMany(
        { _id: { $in: live } },
        { $set: { voided: true, voidedReason: `Replaced by approved correction ${request.id}`, voidedBy: user._id, voidedAt: new Date() } }
      );
    }
  }
  await Attendance.deleteOne({ employee: employee._id, date: dayDate(key), source: 'manual' });

  const make = (at, direction) => ({
    employee: employee._id,
    at,
    direction,
    source: 'regularization',
    note: `${TYPE_LABELS[request.type]} · request ${request.id}`,
    createdBy: user._id,
  });
  const docs = [];
  if (inAt) docs.push(make(inAt, 'in'));
  if (outAt) docs.push(make(outAt, 'out'));
  // A punch already at that exact moment (the request restates a real one) is not added twice.
  const existingTimes = new Set((await AttendancePunch.find({ employee: employee._id, voided: false, at: { $in: docs.map((d) => d.at) } }).select('at').lean()).map((p) => new Date(p.at).getTime()));
  const fresh = docs.filter((d) => !existingTimes.has(d.at.getTime()));
  if (fresh.length) await AttendancePunch.insertMany(fresh);
  return ops.rebuildDay(employee, key);
}

async function decideRequest(request, employee, user, status, note) {
  if (request.status !== 'pending') throw ApiError.conflict(`This request was already ${request.status}`);
  if (!['approved', 'rejected'].includes(status)) throw ApiError.badRequest('A decision must be approved or rejected');
  const text = String(note || '').trim();
  if (status === 'rejected' && !text) throw ApiError.badRequest('Please give a reason when rejecting a request');
  if (status === 'approved') await applyRequest(request, employee, user);
  request.status = status;
  request.decisionNote = text;
  request.decidedBy = user._id;
  request.decidedAt = new Date();
  await request.save();
  return present(request);
}

async function cancelRequest(request, user) {
  if (request.status !== 'pending') throw ApiError.conflict('Only a pending request can be withdrawn');
  request.status = 'cancelled';
  request.decidedBy = user._id;
  request.decidedAt = new Date();
  await request.save();
  return present(request);
}

/* ================================ roster ================================= */

async function carve(employeeId, fromKey, toKey) {
  const overlapping = await ShiftRoster.find({ employee: employeeId, from: { $lte: dayDate(toKey) }, to: { $gte: dayDate(fromKey) } });
  for (const row of overlapping) {
    const rFrom = keyOf(row.from);
    const rTo = keyOf(row.to);
    if (rFrom >= fromKey && rTo <= toKey) {
      // eslint-disable-next-line no-await-in-loop
      await row.deleteOne();
      continue;
    }
    if (rFrom < fromKey && rTo > toKey) {
      // The new range sits inside this one: split it in two.
      await ShiftRoster.create({ employee: employeeId, from: row.from, to: dayDate(zoned.addDays(fromKey, -1)), shift: row.shift, note: row.note, createdBy: row.createdBy });
      row.from = dayDate(zoned.addDays(toKey, 1));
      // eslint-disable-next-line no-await-in-loop
      await row.save();
    } else if (rFrom < fromKey) {
      row.to = dayDate(zoned.addDays(fromKey, -1));
      // eslint-disable-next-line no-await-in-loop
      await row.save();
    } else {
      row.from = dayDate(zoned.addDays(toKey, 1));
      // eslint-disable-next-line no-await-in-loop
      await row.save();
    }
  }
}

async function setRoster(body, user, scopeIds) {
  const from = String(body.from || '').slice(0, 10);
  const to = String(body.to || body.from || '').slice(0, 10);
  if (!DATE.test(from) || !DATE.test(to) || to < from) throw ApiError.badRequest('Choose a valid date range');
  const days = (dayDate(to) - dayDate(from)) / 86400000 + 1;
  if (days > 93) throw ApiError.badRequest('Roster at most 93 days at a time');
  const code = String(body.shift || '').toLowerCase();
  if (!registry.has(code)) throw ApiError.badRequest('Choose one of the defined shifts');
  await ops.assertUnlocked(from);
  await ops.assertUnlocked(to);

  const filter = { employmentStatus: { $in: ['probation', 'confirmed', 'notice_period'] } };
  if (Array.isArray(body.employees) && body.employees.length) {
    filter._id = { $in: body.employees.filter((id) => mongoose.isValidObjectId(id)) };
  } else if (body.department) {
    filter.department = String(body.department);
  } else {
    throw ApiError.badRequest('Choose employees or a department');
  }
  if (scopeIds) filter._id = filter._id ? { $in: filter._id.$in.filter((id) => scopeIds.some((s) => String(s) === String(id))) } : { $in: scopeIds };
  const employees = await Employee.find(filter).limit(500);
  if (!employees.length) throw ApiError.badRequest('No matching employees');

  for (const employee of employees) {
    // eslint-disable-next-line no-await-in-loop
    await carve(employee._id, from, to);
    // eslint-disable-next-line no-await-in-loop
    await ShiftRoster.create({ employee: employee._id, from: dayDate(from), to: dayDate(to), shift: code, note: String(body.note || '').slice(0, 200), createdBy: user._id });
    // eslint-disable-next-line no-await-in-loop
    await ops.rebuildRange(employee, from, to <= ops.todayKey() ? to : ops.todayKey());
  }
  return { employees: employees.length, from, to, shift: code };
}

async function listRoster(query, scopeIds) {
  const from = String(query.from || ops.todayKey()).slice(0, 10);
  const to = String(query.to || zoned.addDays(from, 30)).slice(0, 10);
  const filter = { from: { $lte: dayDate(to) }, to: { $gte: dayDate(from) } };
  let ids = scopeIds;
  if (query.department) {
    const people = await Employee.find({ department: String(query.department) }).select('_id');
    const wanted = people.map((p) => String(p._id));
    ids = ids ? ids.filter((id) => wanted.includes(String(id))) : wanted;
  }
  if (ids) filter.employee = { $in: ids };
  const rows = await ShiftRoster.find(filter).sort({ from: 1 }).limit(500).populate('employee', 'employeeCode firstName lastName department designation');
  return rows.map((row) => ({
    id: String(row._id),
    employee: row.employee ? { id: String(row.employee._id), code: row.employee.employeeCode, fullName: row.employee.fullName, department: row.employee.department } : null,
    from: keyOf(row.from),
    to: keyOf(row.to),
    shift: row.shift,
    shiftLabel: registry.get(row.shift).label,
    note: row.note,
  }));
}

async function removeRoster(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Roster entry not found');
  const row = await ShiftRoster.findById(id);
  if (!row) throw ApiError.notFound('Roster entry not found');
  await ops.assertUnlocked(keyOf(row.from));
  const employee = await Employee.findById(row.employee);
  await row.deleteOne();
  if (employee) await ops.rebuildRange(employee, keyOf(row.from), keyOf(row.to) <= ops.todayKey() ? keyOf(row.to) : ops.todayKey());
  return true;
}

/* ================================ locks ================================== */

function monthEndKey(month) {
  const next = zoned.addDays(`${month}-28`, 5).slice(0, 7);
  return zoned.addDays(`${next}-01`, -1);
}

async function listLocks() {
  const rows = await AttendanceLock.find({}).sort({ month: -1 }).limit(36);
  return rows.map((row) => row.toJSON());
}

/** What would stop a clean close: unfinished days and undecided corrections in the month. */
async function lockReadiness(month) {
  const start = dayDate(`${month}-01`);
  const end = dayDate(zoned.addDays(monthEndKey(month), 1));
  const [pendingRequests, missedPunches] = await Promise.all([
    AttendanceRequest.countDocuments({ date: { $gte: start, $lt: end }, status: 'pending' }),
    Attendance.countDocuments({ date: { $gte: start, $lt: end }, flags: 'missed_punch' }),
  ]);
  return { pendingRequests, missedPunches };
}

async function lockMonth(month, user, body) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month))) throw ApiError.badRequest('Month must be in YYYY-MM format');
  if (monthEndKey(month) >= ops.todayKey()) throw ApiError.badRequest('A month can only be locked after it has ended');
  if (await AttendanceLock.findOne({ month })) throw ApiError.conflict(`${month} is already locked`);
  const readiness = await lockReadiness(month);
  if (!(body && body.force) && (readiness.pendingRequests || readiness.missedPunches)) {
    throw ApiError.conflict(
      `${readiness.pendingRequests} correction request(s) are undecided and ${readiness.missedPunches} day(s) still have a missed punch. Resolve them, or lock anyway.`,
      readiness
    );
  }
  const row = await AttendanceLock.create({ month, lockedBy: user._id, lockedByName: `${user.firstName} ${user.lastName}`.trim(), note: String((body && body.note) || '').slice(0, 200) });
  return { ...row.toJSON(), readiness };
}

async function unlockMonth(month) {
  const row = await AttendanceLock.findOneAndDelete({ month });
  if (!row) throw ApiError.notFound(`${month} is not locked`);
  return true;
}

module.exports = {
  TYPE_LABELS,
  present,
  createRequest,
  applyRequest,
  decideRequest,
  cancelRequest,
  setRoster,
  listRoster,
  removeRoster,
  listLocks,
  lockReadiness,
  lockMonth,
  unlockMonth,
  monthEndKey,
  snapshotOf,
  crypto,
};
