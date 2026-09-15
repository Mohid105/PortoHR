'use strict';

const mongoose = require('mongoose');
const ErCase = require('../models/ErCase');
const Employee = require('../models/Employee');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/roles');
const { metaPayload } = require('../config/grievance');
const { resolveViewerEmployee } = require('../services/employeeAccess');
const audit = require('../services/audit.service');
const er = require('../services/grievance.service');

function requireId(id, label) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound(`${label} not found`);
}

function requireHr(user) {
  if (user.role !== ROLES.HR_ADMIN) throw ApiError.forbidden('Only HR can administer employee-relations cases');
}

async function loadCase(id, user, viewer) {
  requireId(id, 'Case');
  const doc = await ErCase.findById(id);
  if (!doc) throw ApiError.notFound('Case not found');
  const access = er.accessFor(user, viewer, doc);
  if (!access) throw ApiError.notFound('Case not found');
  return { doc, access };
}

const meta = asyncHandler(async (_req, res) => {
  res.json({ success: true, meta: metaPayload() });
});

const listCases = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  const filter = {};
  if (req.user.role !== ROLES.HR_ADMIN) {
    if (!viewer) return res.json({ success: true, cases: [] });
    filter.$or = [{ subject: viewer._id }, { complainant: viewer._id }, { 'parties.employee': viewer._id }];
  }
  if (req.query.status) filter.status = req.query.status;
  const rows = await ErCase.find(filter).sort({ createdAt: -1 }).limit(200);
  res.json({
    success: true,
    cases: rows.map((row) => er.presentCase(row, er.accessFor(req.user, viewer, row))),
  });
});

const getCase = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  const { doc, access } = await loadCase(req.params.id, req.user, viewer);
  res.json({ success: true, case: er.presentCase(doc, access) });
});

const createCase = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  const body = req.body || {};
  let subject = viewer;
  let complainant = viewer;
  if (body.subject) {
    requireId(body.subject, 'Employee');
    subject = await Employee.findById(body.subject);
    if (!subject) throw ApiError.notFound('Employee not found');
  }
  if (req.user.role === ROLES.HR_ADMIN && body.complainant) {
    requireId(body.complainant, 'Employee');
    complainant = await Employee.findById(body.complainant);
  }
  if (!subject) throw ApiError.badRequest('A subject employee is required');
  if (req.user.role !== ROLES.HR_ADMIN && body.subject && viewer && String(body.subject) !== String(viewer._id)) {
    // An employee may name someone else as the subject of a complaint; they remain the complainant.
    complainant = viewer;
  }
  const presented = await er.openCase(body, req.user, complainant, subject);
  await audit.record(req, {
    action: 'er_intake',
    objectType: 'ErCase',
    objectId: presented.id,
    employee: subject._id,
    summary: presented.code,
  });
  res.status(201).json({ success: true, message: 'Case opened', case: presented });
});

const triageCase = asyncHandler(async (req, res) => {
  requireHr(req.user);
  const viewer = await resolveViewerEmployee(req.user);
  const { doc } = await loadCase(req.params.id, req.user, viewer);
  const presented = await er.triage(doc, req.user, req.body || {});
  await audit.record(req, { action: 'er_triage', objectType: 'ErCase', objectId: presented.id, summary: presented.status });
  res.json({ success: true, message: presented.status === 'rejected' ? 'Case rejected' : 'Case moved to investigation', case: presented });
});

const addNote = asyncHandler(async (req, res) => {
  requireHr(req.user);
  const viewer = await resolveViewerEmployee(req.user);
  const { doc } = await loadCase(req.params.id, req.user, viewer);
  const presented = await er.addNote(doc, req.user, req.body || {});
  await audit.record(req, { action: 'er_note', objectType: 'ErCase', objectId: presented.id, summary: presented.code });
  res.status(201).json({ success: true, message: 'Note added', case: presented });
});

const scheduleHearing = asyncHandler(async (req, res) => {
  requireHr(req.user);
  const viewer = await resolveViewerEmployee(req.user);
  const { doc } = await loadCase(req.params.id, req.user, viewer);
  const presented = await er.scheduleHearing(doc, req.user, req.body || {});
  await audit.record(req, { action: 'er_hearing', objectType: 'ErCase', objectId: presented.id, summary: presented.code });
  res.json({ success: true, message: 'Hearing scheduled', case: presented });
});

const decideCase = asyncHandler(async (req, res) => {
  requireHr(req.user);
  const viewer = await resolveViewerEmployee(req.user);
  const { doc } = await loadCase(req.params.id, req.user, viewer);
  const presented = await er.recordDecision(doc, req.user, req.body || {});
  await audit.record(req, { action: 'er_decision', objectType: 'ErCase', objectId: presented.id, summary: presented.decision.actionType });
  res.json({ success: true, message: 'Decision recorded', case: presented });
});

const appealCase = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  const { doc, access } = await loadCase(req.params.id, req.user, viewer);
  if (access === 'party' && req.user.role !== ROLES.HR_ADMIN) {
    const presented = await er.appeal(doc, req.user, req.body || {});
    await audit.record(req, { action: 'er_appeal', objectType: 'ErCase', objectId: presented.id, summary: presented.code });
    return res.json({ success: true, message: 'Appeal submitted', case: er.presentCase(await ErCase.findById(doc._id), access) });
  }
  requireHr(req.user);
  const presented = await er.appeal(doc, req.user, req.body || {});
  await audit.record(req, { action: 'er_appeal', objectType: 'ErCase', objectId: presented.id, summary: presented.code });
  res.json({ success: true, message: 'Appeal submitted', case: presented });
});

const closeCase = asyncHandler(async (req, res) => {
  requireHr(req.user);
  const viewer = await resolveViewerEmployee(req.user);
  const { doc } = await loadCase(req.params.id, req.user, viewer);
  const presented = await er.closeCase(doc, req.user, req.body || {});
  await audit.record(req, { action: 'er_close', objectType: 'ErCase', objectId: presented.id, summary: presented.code });
  res.json({ success: true, message: 'Case closed', case: presented });
});

const addDocument = asyncHandler(async (req, res) => {
  requireHr(req.user);
  const viewer = await resolveViewerEmployee(req.user);
  const { doc } = await loadCase(req.params.id, req.user, viewer);
  const presented = await er.addDocument(doc, req.user, req.body || {});
  res.status(201).json({ success: true, message: 'Document added', case: presented });
});

const analytics = asyncHandler(async (req, res) => {
  requireHr(req.user);
  const payload = await er.analytics();
  res.json({ success: true, ...payload });
});

const people = asyncHandler(async (req, res) => {
  const rows = await Employee.find({ employmentStatus: { $in: ['confirmed', 'probation', 'notice_period'] } })
    .select('firstName lastName employeeCode designation department')
    .sort({ firstName: 1 })
    .limit(80);
  res.json({
    success: true,
    people: rows.map((row) => ({
      id: String(row._id),
      fullName: row.fullName,
      employeeCode: row.employeeCode,
      designation: row.designation,
      department: row.department,
    })),
  });
});

module.exports = {
  meta,
  listCases,
  getCase,
  createCase,
  triageCase,
  addNote,
  scheduleHearing,
  decideCase,
  appealCase,
  closeCase,
  addDocument,
  analytics,
  people,
};
