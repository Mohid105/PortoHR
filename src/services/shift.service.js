'use strict';

const Shift = require('../models/Shift');
const Employee = require('../models/Employee');
const ApiError = require('../utils/ApiError');
const registry = require('../config/shiftRegistry');
const { SHIFT_DEFINITIONS } = require('../config/hr');

async function refresh() {
  const rows = await Shift.find({ active: true }).lean();
  registry.set(rows);
  return registry.all();
}

/** Inserts the built-in shifts the first time, then loads the registry. */
async function ensureDefaults() {
  for (const code of Object.keys(SHIFT_DEFINITIONS)) {
    const def = SHIFT_DEFINITIONS[code];
    await Shift.updateOne(
      { code },
      {
        $setOnInsert: {
          code,
          name: def.label,
          startTime: def.startTime,
          endTime: def.endTime,
          breakMinutes: def.breakMinutes,
          expectedHours: def.expectedHours,
        },
      },
      { upsert: true }
    );
  }
  return refresh();
}

function present(doc) {
  const json = doc.toJSON();
  json.id = String(json.id || json._id);
  const norm = registry.normalise(json.code, json);
  json.derivedHours = norm.expectedHours;
  json.overnight = norm.overnight;
  json.fixed = norm.fixed;
  return json;
}

async function list() {
  const [rows, usage] = await Promise.all([
    Shift.find({}).sort({ code: 1 }),
    Employee.aggregate([{ $match: { employmentStatus: { $in: ['probation', 'confirmed', 'notice_period'] } } }, { $group: { _id: '$shiftType', count: { $sum: 1 } } }]),
  ]);
  const used = new Map(usage.map((row) => [row._id, row.count]));
  return rows.map((row) => ({ ...present(row), employees: used.get(row.code) || 0 }));
}

function readBody(body) {
  const fields = {};
  ['name', 'startTime', 'endTime', 'color'].forEach((key) => {
    if (body[key] !== undefined) fields[key] = body[key] === '' ? (key === 'name' ? '' : null) : String(body[key]).trim();
  });
  ['breakMinutes', 'expectedHours', 'graceInMinutes', 'graceOutMinutes', 'preWindowMinutes', 'postWindowMinutes'].forEach((key) => {
    if (body[key] !== undefined && body[key] !== '') fields[key] = Number(body[key]);
  });
  if (body.active !== undefined) fields.active = Boolean(body.active);
  if ((fields.startTime && !fields.endTime) || (!fields.startTime && fields.endTime)) {
    if (fields.startTime !== undefined && fields.endTime !== undefined) throw ApiError.badRequest('Give both a start and an end time, or neither for a flexible shift');
  }
  return fields;
}

async function create(body) {
  const code = String(body.code || '').trim().toLowerCase();
  if (await Shift.findOne({ code })) throw ApiError.conflict('A shift with this code already exists');
  const row = await Shift.create({ code, ...readBody(body) });
  await refresh();
  return present(row);
}

async function update(id, body) {
  const row = await Shift.findById(id);
  if (!row) throw ApiError.notFound('Shift not found');
  const fields = readBody(body);
  if (fields.active === false) {
    const inUse = await Employee.countDocuments({ shiftType: row.code, employmentStatus: { $in: ['probation', 'confirmed', 'notice_period'] } });
    if (inUse) throw ApiError.badRequest(`${inUse} active employee(s) are on this shift. Move them first.`);
  }
  row.set(fields);
  await row.save();
  await refresh();
  return present(row);
}

module.exports = { refresh, ensureDefaults, list, create, update };
