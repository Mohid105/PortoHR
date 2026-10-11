'use strict';

/**
 * Bulk punch import: the file a biometric time clock exports. Rows are checked
 * first (the preview); only good ones are stored, tagged with a batch id so a
 * bad import can be undone as a whole.
 */

const crypto = require('crypto');
const AttendancePunch = require('../models/AttendancePunch');
const Employee = require('../models/Employee');
const ApiError = require('../utils/ApiError');
const zoned = require('../utils/zoned');
const ops = require('./attendanceOps.service');

const { TZ } = ops;
const MAX_ROWS = 5000;
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

const HEADERS = {
  employeecode: 'code', code: 'code', empcode: 'code', employeeno: 'code', empno: 'code', userid: 'code', badge: 'code', badgeno: 'code', cardno: 'code', enrollno: 'code', id: 'code',
  datetime: 'datetime', timestamp: 'datetime', punchtime: 'datetime', punchdatetime: 'datetime', logtime: 'datetime', datetimestamp: 'datetime',
  date: 'date', punchdate: 'date', time: 'time', punchtimeonly: 'time',
  direction: 'direction', dir: 'direction', inout: 'direction', status: 'direction', type: 'direction', punchtype: 'direction',
  device: 'device', deviceid: 'device', terminal: 'device', machine: 'device',
};

function field(row, name) {
  for (const key of Object.keys(row)) {
    if (HEADERS[String(key).toLowerCase().replace(/[^a-z]/g, '')] === name && String(row[key] === undefined || row[key] === null ? '' : row[key]).trim() !== '') return String(row[key]).trim();
  }
  return '';
}

/** A calendar date in any of the common layouts → 'YYYY-MM-DD', or null. */
function parseDateKey(text) {
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(text);
  let y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(text))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else if ((m = /^(\d{1,2})[-\s]([A-Za-z]{3,4})[-\s](\d{2,4})/.exec(text))) { d = +m[1]; mo = MONTHS[m[2].toLowerCase()]; y = +m[3]; if (y < 100) y += 2000; }
  else return null;
  if (!mo || mo > 12 || d < 1 || d > 31) return null;
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 'HH:MM', 'HH:MM:SS', '9:05 PM' → 'HH:MM', or null. */
function parseClock(text) {
  const m = /(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/.exec(text);
  if (!m) return null;
  let h = +m[1];
  const min = +m[2];
  if (m[3]) {
    const pm = m[3].toLowerCase() === 'pm';
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (pm ? 12 : 0);
  }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * One row's moment in time. A time carrying its own offset ("…Z", "+05:00") is
 * taken as given; a bare local time is read on the company clock.
 */
function parseMoment(row) {
  const combined = field(row, 'datetime');
  const dateText = field(row, 'date');
  const timeText = field(row, 'time');
  const raw = combined || `${dateText} ${timeText}`.trim();
  if (!raw) return null;
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(raw) && /^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const key = parseDateKey(combined || dateText || raw);
  const clock = parseClock(combined ? raw.slice(raw.search(/\d{1,2}:\d{2}/)) : timeText);
  if (!key || !clock) return null;
  return zoned.zonedTime(key, clock, TZ);
}

function parseDirection(text) {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return 'auto';
  if (['in', 'i', 'c/in', 'check-in', 'checkin', 'entry', '0'].includes(t)) return 'in';
  if (['out', 'o', 'c/out', 'check-out', 'checkout', 'exit', '1'].includes(t)) return 'out';
  return 'auto';
}

async function run(rows, options, user) {
  if (!Array.isArray(rows) || !rows.length) throw ApiError.badRequest('There are no rows to import');
  if (rows.length > MAX_ROWS) throw ApiError.badRequest(`Import at most ${MAX_ROWS} punches at a time`);
  const now = new Date();

  const codes = Array.from(new Set(rows.map((r) => field(r, 'code').toUpperCase()).filter(Boolean)));
  const employees = await Employee.find({ employeeCode: { $in: codes } });
  const byCode = new Map(employees.map((e) => [e.employeeCode, e]));

  const parsed = rows.map((row, index) => {
    const code = field(row, 'code').toUpperCase();
    const at = parseMoment(row);
    const errors = [];
    const employee = byCode.get(code);
    if (!code) errors.push('no employee code');
    else if (!employee) errors.push(`unknown employee ${code}`);
    if (!at) errors.push('the date and time could not be read');
    else if (at > new Date(now.getTime() + 86400000)) errors.push('the time is in the future');
    return { line: index + 2, code, employee, at, direction: parseDirection(field(row, 'direction')), device: field(row, 'device'), errors };
  });

  // Skip what is already stored, and repeats inside the file.
  const valid = parsed.filter((p) => !p.errors.length);
  if (valid.length) {
    const min = new Date(Math.min(...valid.map((p) => p.at.getTime())));
    const max = new Date(Math.max(...valid.map((p) => p.at.getTime())));
    const stored = await AttendancePunch.find({ employee: { $in: employees.map((e) => e._id) }, at: { $gte: min, $lte: max }, voided: false }).select('employee at').lean();
    const seen = new Set(stored.map((p) => `${p.employee}|${new Date(p.at).getTime()}`));
    valid.forEach((p) => {
      const key = `${p.employee._id}|${p.at.getTime()}`;
      if (seen.has(key)) p.errors.push('already imported');
      else seen.add(key);
    });
  }

  // Closed months cannot take punches.
  const live = parsed.filter((p) => !p.errors.length);
  if (live.length) {
    const keys = live.map((p) => zoned.dateKey(p.at, TZ));
    const locked = await ops.lockedMonths(keys);
    live.forEach((p, i) => {
      if (locked.has(keys[i].slice(0, 7))) p.errors.push(`${keys[i].slice(0, 7)} is locked`);
    });
  }

  const good = parsed.filter((p) => !p.errors.length);
  const summary = {
    committed: false,
    total: parsed.length,
    valid: good.length,
    employees: new Set(good.map((p) => String(p.employee._id))).size,
    from: good.length ? zoned.dateKey(new Date(Math.min(...good.map((p) => p.at.getTime()))), TZ) : null,
    to: good.length ? zoned.dateKey(new Date(Math.max(...good.map((p) => p.at.getTime()))), TZ) : null,
    problems: parsed.filter((p) => p.errors.length).slice(0, 200).map((p) => ({ line: p.line, code: p.code, errors: p.errors })),
    problemCount: parsed.filter((p) => p.errors.length).length,
  };
  if (!options || !options.commit) return summary;
  if (!good.length) throw ApiError.badRequest('None of the rows can be imported');

  const batch = crypto.randomBytes(6).toString('hex');
  await AttendancePunch.insertMany(
    good.map((p) => ({ employee: p.employee._id, at: p.at, direction: p.direction, source: 'import', deviceId: p.device, batch, createdBy: user._id })),
    { ordered: false }
  );

  // Rebuild every affected day once.
  const days = new Map();
  for (const p of good) {
    // eslint-disable-next-line no-await-in-loop
    const key = await ops.dayOfPunch(p.employee, p.at);
    days.set(`${p.employee._id}|${key}`, { employee: p.employee, key });
  }
  for (const { employee, key } of days.values()) {
    // eslint-disable-next-line no-await-in-loop
    await ops.rebuildDay(employee, key);
  }
  return { ...summary, committed: true, batch, daysRebuilt: days.size };
}

async function listBatches() {
  const rows = await AttendancePunch.aggregate([
    { $match: { batch: { $ne: '' } } },
    { $group: { _id: '$batch', punches: { $sum: 1 }, live: { $sum: { $cond: ['$voided', 0, 1] } }, employees: { $addToSet: '$employee' }, from: { $min: '$at' }, to: { $max: '$at' }, at: { $max: '$createdAt' } } },
    { $sort: { at: -1 } },
    { $limit: 20 },
  ]);
  return rows.map((r) => ({ batch: r._id, punches: r.punches, live: r.live, employees: r.employees.length, from: r.from, to: r.to, importedAt: r.at }));
}

/** Undo an import: void its punches and rebuild the days they touched. */
async function undoBatch(batch, user) {
  const punches = await AttendancePunch.find({ batch, voided: false });
  if (!punches.length) throw ApiError.notFound('Nothing left to undo for that import');
  const employees = new Map((await Employee.find({ _id: { $in: Array.from(new Set(punches.map((p) => String(p.employee)))) } })).map((e) => [String(e._id), e]));
  const days = new Map();
  for (const p of punches) {
    const employee = employees.get(String(p.employee));
    // eslint-disable-next-line no-await-in-loop
    const key = await ops.dayOfPunch(employee, p.at);
    // eslint-disable-next-line no-await-in-loop
    await ops.assertUnlocked(key);
    days.set(`${p.employee}|${key}`, { employee, key });
  }
  await AttendancePunch.updateMany({ batch, voided: false }, { $set: { voided: true, voidedReason: `Import ${batch} undone`, voidedBy: user._id, voidedAt: new Date() } });
  for (const { employee, key } of days.values()) {
    // eslint-disable-next-line no-await-in-loop
    await ops.rebuildDay(employee, key);
  }
  return { voided: punches.length, daysRebuilt: days.size };
}

module.exports = { MAX_ROWS, parseDateKey, parseClock, parseMoment, parseDirection, run, listBatches, undoBatch };
