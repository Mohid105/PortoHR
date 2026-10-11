'use strict';

const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const SavedReport = require('../models/SavedReport');
const ExportLog = require('../models/ExportLog');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const env = require('../config/env');
const { ROLES } = require('../config/roles');
const { visibleEmployeeIds, resolveViewerEmployee } = require('../services/employeeAccess');
const datasets = require('../services/reports/datasets');
const engine = require('../services/reports/engine');
const library = require('../services/reports/library');
const employeeReport = require('../services/reports/employeeReport.service');

const isHr = (user) => user.role === ROLES.HR_ADMIN;
const actorName = (user) => [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;

function datasetFor(key, user) {
  const def = datasets.get(String(key || ''));
  if (!def) throw ApiError.notFound('Unknown dataset');
  if (def.access === 'hr' && !isHr(user)) throw ApiError.forbidden('This dataset is for HR only');
  return def;
}

/** The definition parts of a request, nothing else, so a saved report never carries stray fields. */
const definitionOf = (body) => ({
  columns: body.columns, filters: body.filters, groupBy: body.groupBy, aggregates: body.aggregates, sort: body.sort, limit: body.limit,
});

const presentSaved = (doc, user) => ({
  id: String(doc._id),
  name: doc.name,
  description: doc.description,
  dataset: doc.dataset,
  definition: doc.definition,
  shared: doc.shared,
  ownerName: doc.ownerName,
  mine: String(doc.owner) === String(user._id),
  updatedAt: doc.updatedAt,
});

async function logExport(user, code, name, format, rowCount, filters) {
  try {
    await ExportLog.create({ reportCode: code, reportName: name, format, rowCount, filters: filters || {}, actor: user._id, actorName: actorName(user), role: user.role });
  } catch (err) {
    /* an audit-trail failure must not lose the user's report */
  }
}

/** GET /api/reports/meta — everything the page needs to start. */
const meta = asyncHandler(async (req, res) => {
  const visible = datasets.listFor(req.user);
  const allowedKeys = new Set(visible.map((d) => d.key));
  const saved = await SavedReport.find({ $or: [{ owner: req.user._id }, { shared: true }], dataset: { $in: [...allowedKeys] } }).sort({ name: 1 });
  res.json({
    success: true,
    timezone: env.timezone,
    datasets: visible.map((d) => ({ key: d.key, label: d.label, group: d.group, description: d.description, columnCount: engine.visibleColumns(d, req.user).length })),
    library: library.REPORTS.filter((r) => allowedKeys.has(r.dataset)).map((r) => ({ code: r.code, category: r.category, name: r.name, description: r.description, dataset: r.dataset, definition: r.definition })),
    saved: saved.map((s) => presentSaved(s, req.user)),
    ops: { byFamily: engine.OPS, labels: engine.OP_LABELS, aggregates: engine.AGGREGATES.map((fn) => ({ value: fn, label: engine.AGG_LABELS[fn] })), buckets: engine.BUCKETS },
    employeeSections: employeeReport.SECTIONS,
  });
});

/** GET /api/reports/datasets/:key */
const describeDataset = asyncHandler(async (req, res) => {
  res.json({ success: true, dataset: engine.describe(datasetFor(req.params.key, req.user), req.user) });
});

/** GET /api/reports/datasets/:key/values?column= — distinct values for a filter picker. */
const columnValues = asyncHandler(async (req, res) => {
  const def = datasetFor(req.params.key, req.user);
  const scope = await visibleEmployeeIds(req.user);
  res.json({ success: true, values: await engine.distinct(def, String(req.query.column || ''), req.user, scope) });
});

/** POST /api/reports/run */
const run = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const def = datasetFor(body.dataset, req.user);
  const scope = await visibleEmployeeIds(req.user);
  const result = await engine.run(def, definitionOf(body), req.user, scope);
  if (body.export === true) await logExport(req.user, `builder:${def.key}`, body.name || def.label, 'csv', result.total, result.plan);
  res.json({ success: true, result });
});

/** GET/POST/PUT/DELETE /api/reports/saved */
const saveReport = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const def = datasetFor(body.dataset, req.user);
  const name = String(body.name || '').trim();
  if (name.length < 2) throw ApiError.badRequest('Give the report a name', [{ field: 'name', message: 'Give the report a name' }]);
  const checked = engine.plan(def, definitionOf(body), req.user);
  const definition = { columns: checked.columns, filters: checked.filters, groupBy: checked.groupBy, aggregates: checked.aggregates, sort: checked.sort, limit: checked.limit };
  const fields = { name: name.slice(0, 80), description: String(body.description || '').trim().slice(0, 300), dataset: def.key, definition, shared: body.shared === true };

  let doc;
  if (req.params.id) {
    if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Report not found');
    doc = await SavedReport.findById(req.params.id);
    if (!doc) throw ApiError.notFound('Report not found');
    if (String(doc.owner) !== String(req.user._id) && !isHr(req.user)) throw ApiError.forbidden('Only the person who saved this report can change it');
    doc.set(fields);
    await doc.save();
  } else {
    doc = await SavedReport.create(Object.assign(fields, { owner: req.user._id, ownerName: actorName(req.user) }));
  }
  res.status(req.params.id ? 200 : 201).json({ success: true, report: presentSaved(doc, req.user) });
});

const deleteSaved = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Report not found');
  const doc = await SavedReport.findById(req.params.id);
  if (!doc) throw ApiError.notFound('Report not found');
  if (String(doc.owner) !== String(req.user._id) && !isHr(req.user)) throw ApiError.forbidden('Only the person who saved this report can delete it');
  await doc.deleteOne();
  res.json({ success: true });
});

/** GET /api/reports/people?q= — employees the caller may build a report for. */
const people = asyncHandler(async (req, res) => {
  const scope = await visibleEmployeeIds(req.user);
  const filter = scope === null ? {} : { _id: { $in: scope } };
  const q = String(req.query.q || '').trim();
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ firstName: rx }, { lastName: rx }, { employeeCode: rx }, { email: rx }, { designation: rx }, { department: rx }];
  }
  const department = String(req.query.department || '').trim();
  if (department) filter.department = new RegExp(`^${department.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  if (req.query.active === '1') filter.employmentStatus = { $nin: ['resigned', 'terminated'] };
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12));
  const rows = await Employee.find(filter).select('employeeCode firstName lastName designation department employmentStatus').sort({ firstName: 1, lastName: 1 }).limit(limit).lean();
  res.json({
    success: true,
    people: rows.map((e) => ({ id: String(e._id), code: e.employeeCode, name: [e.firstName, e.lastName].join(' '), designation: e.designation, department: e.department, status: e.employmentStatus })),
  });
});

/** GET /api/reports/employee/:id */
const employee = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Employee not found');
  const [scope, viewer] = await Promise.all([visibleEmployeeIds(req.user), resolveViewerEmployee(req.user)]);
  const inReportingLine = scope !== null && scope.some((id) => String(id) === String(req.params.id));
  const report = await employeeReport.build(req.params.id, req.query, req.user, viewer, inReportingLine);
  res.json({ success: true, report });
});

/** POST /api/reports/log — records that a report left the system as a file or printout. */
const logUse = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const format = ['csv', 'print'].includes(body.format) ? body.format : 'csv';
  if (body.kind === 'employee') {
    if (!mongoose.isValidObjectId(body.employeeId)) throw ApiError.badRequest('Unknown employee');
    const [scope, viewer] = await Promise.all([visibleEmployeeIds(req.user), resolveViewerEmployee(req.user)]);
    const person = await Employee.findById(body.employeeId).select('employeeCode firstName lastName email');
    if (!person) throw ApiError.notFound('Employee not found');
    const allowed = scope === null || scope.some((id) => String(id) === String(person._id)) || (viewer && String(viewer._id) === String(person._id));
    if (!allowed) throw ApiError.forbidden();
    await logExport(req.user, `employee:${person.employeeCode}`, `Employee report: ${person.firstName} ${person.lastName}`, format, Number(body.rowCount) || 0, { sections: body.sections, period: body.period });
  } else {
    await logExport(req.user, `builder:${String(body.dataset || '').slice(0, 30)}`, String(body.name || 'Report').slice(0, 80), format, Number(body.rowCount) || 0, {});
  }
  res.json({ success: true });
});

module.exports = { meta, describeDataset, columnValues, run, saveReport, deleteSaved, people, employee, logUse };
