'use strict';

const mongoose = require('mongoose');
const ComplianceRule = require('../models/ComplianceRule');
const Filing = require('../models/Filing');
const License = require('../models/License');
const PolicyDocument = require('../models/PolicyDocument');
const AcknowledgementLog = require('../models/AcknowledgementLog');
const RetentionRule = require('../models/RetentionRule');
const StatutoryEnrollment = require('../models/StatutoryEnrollment');
const Employee = require('../models/Employee');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/roles');
const { metaPayload } = require('../config/compliance');
const { STATUTORY_SCHEME_LABELS } = require('../config/org');
const { resolveViewerEmployee, visibleEmployeeIds } = require('../services/employeeAccess');
const audit = require('../services/audit.service');
const compliance = require('../services/compliance.service');

function requireId(id, label) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound(`${label} not found`);
}

function requireHr(user) {
  if (user.role !== ROLES.HR_ADMIN) throw ApiError.forbidden('Only HR can maintain compliance records');
}

async function scopedEmployeeFilter(user) {
  const ids = await visibleEmployeeIds(user);
  if (ids === null) return {};
  if (!ids.length) return { _id: null };
  return { employee: { $in: ids } };
}

const meta = asyncHandler(async (_req, res) => {
  res.json({ success: true, meta: metaPayload() });
});

const calendar = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  const staff = req.user.role !== ROLES.EMPLOYEE;
  const filter = await scopedEmployeeFilter(req.user);
  const payload = await compliance.buildCalendar({
    from: req.query.from,
    to: req.query.to,
    employeeFilter: staff ? filter : { employee: viewer && viewer._id },
    includeCompany: staff,
    viewerId: viewer && viewer._id,
  });
  res.json({ success: true, ...payload });
});

const listRules = asyncHandler(async (req, res) => {
  if (req.user.role === ROLES.EMPLOYEE) throw ApiError.forbidden('Filing rules are a manager and HR view');
  const rules = await ComplianceRule.find({ status: 'published' }).sort({ category: 1, name: 1 });
  res.json({ success: true, rules: rules.map(compliance.presentRule) });
});

const createRule = asyncHandler(async (req, res) => {
  requireHr(req.user);
  const rule = await compliance.createRule(req.body || {});
  await audit.record(req, { action: 'compliance_rule', objectType: 'ComplianceRule', objectId: rule.id, summary: rule.name });
  res.status(201).json({ success: true, message: 'Filing rule saved', rule });
});

const listFilings = asyncHandler(async (req, res) => {
  if (req.user.role === ROLES.EMPLOYEE) throw ApiError.forbidden('Filings are a manager and HR view');
  await compliance.ensureFilings();
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const rows = await Filing.find(filter).populate('rule').sort({ dueOn: 1 }).limit(200);
  res.json({ success: true, filings: rows.map(compliance.presentFiling) });
});

const fileReturn = asyncHandler(async (req, res) => {
  requireHr(req.user);
  requireId(req.params.id, 'Filing');
  const filing = await Filing.findById(req.params.id);
  if (!filing) throw ApiError.notFound('Filing not found');
  const presented = await compliance.markFiled(filing, req.user, req.body || {});
  await audit.record(req, { action: 'filing_submitted', objectType: 'Filing', objectId: presented.id, summary: presented.ruleName });
  res.json({ success: true, message: 'Return marked filed', filing: presented });
});

const listLicenses = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  const staff = req.user.role !== ROLES.EMPLOYEE;
  const filter = await scopedEmployeeFilter(req.user);
  const query = {};
  if (!staff) query.employee = viewer ? viewer._id : { $in: [] };
  else if (filter.employee) query.$or = [{ employee: filter.employee }, { employee: null }];
  if (req.query.status) query.status = req.query.status;
  const rows = await License.find(query).sort({ expiresOn: 1, name: 1 }).limit(200);
  res.json({ success: true, licenses: rows.map(compliance.presentLicense) });
});

const createLicense = asyncHandler(async (req, res) => {
  requireHr(req.user);
  const body = req.body || {};
  let employee = null;
  if (body.employee) {
    requireId(body.employee, 'Employee');
    employee = await Employee.findById(body.employee);
    if (!employee) throw ApiError.notFound('Employee not found');
  }
  const license = await compliance.createLicense(body, employee);
  await audit.record(req, {
    action: 'license_create',
    objectType: 'License',
    objectId: license.id,
    employee: employee && employee._id,
    summary: license.name,
  });
  res.status(201).json({ success: true, message: 'Licence saved', license });
});

const revokeLicense = asyncHandler(async (req, res) => {
  requireHr(req.user);
  requireId(req.params.id, 'Licence');
  const license = await License.findById(req.params.id);
  if (!license) throw ApiError.notFound('Licence not found');
  const presented = await compliance.revokeLicense(license);
  await audit.record(req, { action: 'license_revoke', objectType: 'License', objectId: presented.id, summary: presented.name });
  res.json({ success: true, message: 'Licence revoked', license: presented });
});

const listPolicies = asyncHandler(async (req, res) => {
  const filter = req.user.role === ROLES.HR_ADMIN ? {} : { status: 'published' };
  const rows = await PolicyDocument.find(filter).sort({ status: 1, title: 1 });
  const viewer = await resolveViewerEmployee(req.user);
  let mine = [];
  if (viewer) {
    mine = await AcknowledgementLog.find({ employee: viewer._id }).select('policy version');
  }
  const acked = {};
  mine.forEach((row) => {
    acked[`${row.policy}:${row.version}`] = true;
  });
  res.json({
    success: true,
    policies: rows.map((row) =>
      compliance.presentPolicy(row, {
        acknowledged: Boolean(acked[`${row._id}:${row.version}`]),
      })
    ),
  });
});

const createPolicy = asyncHandler(async (req, res) => {
  requireHr(req.user);
  const policy = await compliance.createPolicy(req.body || {}, req.user);
  await audit.record(req, { action: 'policy_create', objectType: 'PolicyDocument', objectId: policy.id, summary: policy.title });
  res.status(201).json({ success: true, message: policy.status === 'published' ? 'Policy published' : 'Draft saved', policy });
});

const publishPolicy = asyncHandler(async (req, res) => {
  requireHr(req.user);
  requireId(req.params.id, 'Policy');
  const policy = await PolicyDocument.findById(req.params.id);
  if (!policy) throw ApiError.notFound('Policy not found');
  const presented = await compliance.publishPolicy(policy, req.user);
  await audit.record(req, { action: 'policy_publish', objectType: 'PolicyDocument', objectId: presented.id, summary: presented.title });
  res.json({ success: true, message: 'Policy published', policy: presented });
});

const acknowledgePolicy = asyncHandler(async (req, res) => {
  requireId(req.params.id, 'Policy');
  const policy = await PolicyDocument.findById(req.params.id);
  if (!policy) throw ApiError.notFound('Policy not found');
  const viewer = await resolveViewerEmployee(req.user);
  const presented = await compliance.acknowledgePolicy(policy, viewer);
  await audit.record(req, {
    action: 'policy_ack',
    objectType: 'AcknowledgementLog',
    objectId: presented.id,
    employee: viewer && viewer._id,
    summary: policy.title,
  });
  res.status(201).json({ success: true, message: 'Policy acknowledged', acknowledgement: presented });
});

const acknowledgementBoard = asyncHandler(async (req, res) => {
  if (req.user.role === ROLES.EMPLOYEE) throw ApiError.forbidden('The acknowledgement board is a manager and HR view');
  const filter = await scopedEmployeeFilter(req.user);
  const policies = await compliance.policyDashboard(null, filter);
  res.json({ success: true, policies });
});

const listRetention = asyncHandler(async (req, res) => {
  if (req.user.role !== ROLES.HR_ADMIN) throw ApiError.forbidden('Retention rules are an HR view');
  const rows = await RetentionRule.find().sort({ category: 1 });
  res.json({ success: true, rules: rows.map(compliance.presentRetention) });
});

const saveRetention = asyncHandler(async (req, res) => {
  requireHr(req.user);
  const rule = await compliance.upsertRetention(req.body || {});
  await audit.record(req, { action: 'retention_upsert', objectType: 'RetentionRule', objectId: rule.id, summary: rule.category });
  res.json({ success: true, message: 'Retention rule saved', rule });
});

const myCompliance = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  if (!viewer) {
    return res.json({ success: true, policies: [], licenses: [], schemes: [] });
  }
  const [policies, acks, licenses, schemes] = await Promise.all([
    PolicyDocument.find({ status: 'published' }).sort({ title: 1 }),
    AcknowledgementLog.find({ employee: viewer._id }),
    License.find({ employee: viewer._id, status: { $ne: 'revoked' } }).sort({ expiresOn: 1 }),
    StatutoryEnrollment.find({ employee: viewer._id, status: { $in: ['active', 'pending'] } }),
  ]);
  const acked = {};
  acks.forEach((row) => {
    acked[`${row.policy}:${row.version}`] = true;
  });
  res.json({
    success: true,
    policies: policies.map((row) =>
      compliance.presentPolicy(row, { acknowledged: Boolean(acked[`${row._id}:${row.version}`]) })
    ),
    licenses: licenses.map(compliance.presentLicense),
    schemes: schemes.map((row) => {
      const json = row.toJSON ? row.toJSON() : row;
      json.id = String(json.id || json._id);
      json.schemeLabel = STATUTORY_SCHEME_LABELS[json.scheme] || json.scheme;
      return json;
    }),
  });
});

const exportPack = asyncHandler(async (req, res) => {
  requireHr(req.user);
  const payload = await compliance.auditExport();
  await audit.record(req, { action: 'compliance_export', objectType: 'AuditLog', summary: 'Regulator export downloaded' });
  res.json({ success: true, ...payload });
});

const people = asyncHandler(async (req, res) => {
  if (req.user.role !== ROLES.HR_ADMIN) throw ApiError.forbidden('Only HR can assign personal licences');
  const rows = await Employee.find({ employmentStatus: { $in: ['confirmed', 'probation'] } })
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
    })),
  });
});

module.exports = {
  meta,
  calendar,
  listRules,
  createRule,
  listFilings,
  fileReturn,
  listLicenses,
  createLicense,
  revokeLicense,
  listPolicies,
  createPolicy,
  publishPolicy,
  acknowledgePolicy,
  acknowledgementBoard,
  listRetention,
  saveRetention,
  myCompliance,
  exportPack,
  people,
};
