'use strict';

const ComplianceRule = require('../models/ComplianceRule');
const Filing = require('../models/Filing');
const License = require('../models/License');
const PolicyDocument = require('../models/PolicyDocument');
const AcknowledgementLog = require('../models/AcknowledgementLog');
const RetentionRule = require('../models/RetentionRule');
const EmployeeDocument = require('../models/EmployeeDocument');
const StatutoryEnrollment = require('../models/StatutoryEnrollment');
const CertificationRecord = require('../models/CertificationRecord');
const Employee = require('../models/Employee');
const AuditLog = require('../models/AuditLog');
const ApiError = require('../utils/ApiError');
const { STATUTORY_SCHEME_LABELS } = require('../config/org');
const {
  FREQUENCY_LABELS,
  FILING_CATEGORY_LABELS,
  FILING_STATUS_LABELS,
  LICENSE_KIND_LABELS,
  LICENSE_SCOPE_LABELS,
  LICENSE_STATUS_LABELS,
  POLICY_STATUS_LABELS,
  RETENTION_CATEGORY_LABELS,
  RETENTION_ACTION_LABELS,
  ALERT_DAYS,
  dueDatesForYear,
  filingStatus,
  expiryStatus,
  dateOnly,
  addDays,
} = require('../config/compliance');

function asId(value) {
  return String((value && (value._id || value.id || value)) || '');
}

function isoDay(value) {
  if (!value) return '';
  const day = new Date(value);
  const y = day.getFullYear();
  const m = String(day.getMonth() + 1).padStart(2, '0');
  const d = String(day.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function snapshotOf(employee) {
  if (!employee) return { employeeCode: '', fullName: '', designation: '', department: '' };
  return {
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    designation: employee.designation,
    department: employee.department,
  };
}

async function nextCode(Model, prefix, field) {
  const rows = await Model.find({ [field]: new RegExp(`^${prefix}-`) }).select(field).lean();
  let max = 1000;
  rows.forEach((row) => {
    const n = Number(String(row[field]).replace(/\D/g, ''));
    if (n > max) max = n;
  });
  return `${prefix}-${max + 1}`;
}

function presentRule(doc) {
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  json.frequencyLabel = FREQUENCY_LABELS[json.frequency] || json.frequency;
  json.categoryLabel = FILING_CATEGORY_LABELS[json.category] || json.category;
  return json;
}

function presentFiling(doc) {
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  json.ruleId = json.rule && json.rule.name ? String(json.rule._id || json.rule.id) : asId(json.rule);
  json.ruleName = json.rule && json.rule.name ? json.rule.name : '';
  json.authority = json.rule && json.rule.authority ? json.rule.authority : '';
  json.category = json.rule && json.rule.category ? json.rule.category : '';
  json.categoryLabel = FILING_CATEGORY_LABELS[json.category] || json.category;
  json.status = filingStatus(json.dueOn, json.filedOn);
  json.statusLabel = FILING_STATUS_LABELS[json.status] || json.status;
  json.dueOn = isoDay(json.dueOn);
  json.filedOn = isoDay(json.filedOn);
  return json;
}

function presentLicense(doc) {
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  json.employee = asId(json.employee);
  json.holder = json.snapshot && json.snapshot.fullName ? json.snapshot.fullName : 'Company';
  json.kindLabel = LICENSE_KIND_LABELS[json.kind] || json.kind;
  json.scopeLabel = LICENSE_SCOPE_LABELS[json.scope] || json.scope;
  json.status = expiryStatus(json.expiresOn, json.status);
  json.statusLabel = LICENSE_STATUS_LABELS[json.status] || json.status;
  json.issuedOn = isoDay(json.issuedOn);
  json.expiresOn = isoDay(json.expiresOn);
  return json;
}

function presentPolicy(doc, extra = {}) {
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  json.statusLabel = POLICY_STATUS_LABELS[json.status] || json.status;
  json.publishedAt = isoDay(json.publishedAt);
  json.dueOn =
    json.publishedAt && json.dueWithinDays
      ? isoDay(addDays(json.publishedAt, json.dueWithinDays))
      : '';
  return Object.assign(json, extra);
}

function presentAck(doc) {
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  json.employee = asId(json.employee);
  json.policyId = json.policy && json.policy.title ? String(json.policy._id || json.policy.id) : asId(json.policy);
  json.policyTitle = json.policy && json.policy.title ? json.policy.title : '';
  json.learner = json.snapshot && json.snapshot.fullName ? json.snapshot.fullName : '';
  json.acknowledgedAt = json.acknowledgedAt ? new Date(json.acknowledgedAt).toISOString() : '';
  return json;
}

function presentRetention(doc) {
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  json.categoryLabel = RETENTION_CATEGORY_LABELS[json.category] || json.category;
  json.actionLabel = RETENTION_ACTION_LABELS[json.action] || json.action;
  return json;
}

function periodLabel(rule, dueOn) {
  const due = new Date(dueOn);
  const year = due.getFullYear();
  const month = due.getMonth() + 1;
  if (rule.frequency === 'monthly') {
    return `${due.toLocaleString('en', { month: 'short' })} ${year}`;
  }
  if (rule.frequency === 'quarterly') {
    const quarter = month <= 1 ? `Q4 ${year - 1}` : `Q${Math.ceil((month - 1) / 3)} ${year}`;
    return quarter;
  }
  return String(year);
}

async function ensureFilings(year = new Date().getFullYear()) {
  const rules = await ComplianceRule.find({ status: 'published' });
  const created = [];
  for (const rule of rules) {
    const dates = dueDatesForYear(rule, year);
    for (const dueOn of dates) {
      const existing = await Filing.findOne({ rule: rule._id, dueOn });
      if (existing) continue;
      const monthStart = new Date(dueOn.getFullYear(), dueOn.getMonth(), 1);
      const monthEnd = new Date(dueOn.getFullYear(), dueOn.getMonth() + 1, 0, 23, 59, 59);
      const stale = await Filing.findOne({
        rule: rule._id,
        dueOn: { $gte: monthStart, $lte: monthEnd },
        filedOn: null,
      });
      if (stale) {
        stale.dueOn = dueOn;
        stale.periodLabel = periodLabel(rule, dueOn);
        stale.status = filingStatus(dueOn, null);
        await stale.save();
        continue;
      }
      const row = await Filing.create({
        code: await nextCode(Filing, 'FIL', 'code'),
        rule: rule._id,
        dueOn,
        periodLabel: periodLabel(rule, dueOn),
        status: filingStatus(dueOn, null),
      });
      created.push(row);
    }
  }
  return created;
}

async function createRule(body) {
  const name = String(body.name || '').trim();
  if (name.length < 3) throw ApiError.badRequest('Rule name must be at least 3 characters');
  if (!body.category) throw ApiError.badRequest('A filing category is required');
  if (!body.frequency) throw ApiError.badRequest('A filing frequency is required');
  const dueMonths = Array.isArray(body.dueMonths)
    ? body.dueMonths.map(Number).filter((n) => n >= 1 && n <= 12)
    : String(body.dueMonths || '')
        .split(',')
        .map((item) => Number(item.trim()))
        .filter((n) => n >= 1 && n <= 12);
  const rule = await ComplianceRule.create({
    code: body.code || (await nextCode(ComplianceRule, 'RUL', 'code')),
    name,
    country: body.country || 'PK',
    category: body.category,
    authority: String(body.authority || '').trim(),
    frequency: body.frequency,
    dueDay: Number(body.dueDay) || 15,
    dueMonth: Number(body.dueMonth) || null,
    dueMonths,
    summary: String(body.summary || '').trim(),
    status: 'published',
  });
  await ensureFilings();
  return presentRule(rule);
}

async function markFiled(filing, user, body = {}) {
  if (filing.filedOn) throw ApiError.conflict('This return is already filed');
  filing.filedOn = body.filedOn ? new Date(body.filedOn) : new Date();
  filing.filedBy = user._id;
  filing.reference = String(body.reference || '').trim();
  filing.notes = String(body.notes || '').trim();
  filing.status = 'filed';
  await filing.save();
  return presentFiling(await Filing.findById(filing._id).populate('rule'));
}

async function createLicense(body, employee) {
  const name = String(body.name || '').trim();
  if (name.length < 3) throw ApiError.badRequest('Licence name must be at least 3 characters');
  if (!body.kind) throw ApiError.badRequest('A licence kind is required');
  const scope = employee ? 'employee' : body.scope || 'company';
  if (scope === 'employee' && !employee) throw ApiError.badRequest('An employee is required for a personal licence');
  const license = await License.create({
    code: body.code || (await nextCode(License, 'LIC', 'code')),
    name,
    kind: body.kind,
    scope,
    employee: employee ? employee._id : null,
    snapshot: employee ? snapshotOf(employee) : undefined,
    issuer: String(body.issuer || '').trim(),
    reference: String(body.reference || '').trim(),
    issuedOn: body.issuedOn || null,
    expiresOn: body.expiresOn || null,
    documentUrl: String(body.documentUrl || '').trim(),
    notes: String(body.notes || '').trim(),
    status: 'active',
  });
  return presentLicense(license);
}

async function revokeLicense(license) {
  if (license.status === 'revoked') throw ApiError.conflict('This licence is already revoked');
  license.status = 'revoked';
  await license.save();
  return presentLicense(license);
}

async function createPolicy(body, user) {
  const title = String(body.title || '').trim();
  if (title.length < 3) throw ApiError.badRequest('Policy title must be at least 3 characters');
  const publish = body.status === 'published' || body.publish === true || body.publish === 'true' || body.publish === 'on';
  const policy = await PolicyDocument.create({
    code: body.code || (await nextCode(PolicyDocument, 'POL', 'code')),
    title,
    summary: String(body.summary || '').trim(),
    body: String(body.body || '').trim(),
    version: 1,
    requiresAck: body.requiresAck !== false && body.requiresAck !== 'false',
    dueWithinDays: Number(body.dueWithinDays) || 14,
    status: publish ? 'published' : 'draft',
    publishedAt: publish ? new Date() : null,
    publishedBy: publish ? user._id : null,
  });
  return presentPolicy(policy);
}

async function publishPolicy(policy, user) {
  if (policy.status === 'archived') throw ApiError.conflict('An archived policy cannot be published');
  if (policy.status === 'published') {
    policy.version += 1;
  }
  policy.status = 'published';
  policy.publishedAt = new Date();
  policy.publishedBy = user._id;
  await policy.save();
  return presentPolicy(policy);
}

async function acknowledgePolicy(policy, employee) {
  if (!employee) throw ApiError.badRequest('An employee record is required to acknowledge a policy');
  if (policy.status !== 'published' || !policy.requiresAck) {
    throw ApiError.badRequest('This policy is not open for acknowledgement');
  }
  const existing = await AcknowledgementLog.findOne({
    policy: policy._id,
    employee: employee._id,
    version: policy.version,
  });
  if (existing) throw ApiError.conflict('You have already acknowledged this version');
  const row = await AcknowledgementLog.create({
    policy: policy._id,
    employee: employee._id,
    snapshot: snapshotOf(employee),
    version: policy.version,
    acknowledgedAt: new Date(),
  });
  return presentAck(await AcknowledgementLog.findById(row._id).populate('policy', 'title code version'));
}

async function upsertRetention(body) {
  if (!body.category) throw ApiError.badRequest('A data category is required');
  const years = Number(body.years);
  if (!years || years < 1) throw ApiError.badRequest('Retention years must be at least 1');
  const row = await RetentionRule.findOneAndUpdate(
    { category: body.category },
    {
      category: body.category,
      years,
      action: body.action || 'archive',
      notes: String(body.notes || '').trim(),
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return presentRetention(row);
}

async function policyDashboard(policyIds, employeeFilter) {
  const policies = await PolicyDocument.find(
    Object.assign({ status: 'published', requiresAck: true }, policyIds ? { _id: { $in: policyIds } } : {})
  ).sort({ publishedAt: -1 });
  const peopleFilter = { employmentStatus: { $in: ['confirmed', 'probation'] } };
  if (employeeFilter && employeeFilter.employee && employeeFilter.employee.$in) {
    peopleFilter._id = employeeFilter.employee;
  } else if (employeeFilter && employeeFilter._id === null) {
    return [];
  }
  const people = await Employee.find(peopleFilter).select('_id firstName lastName employeeCode designation department');
  const acks = await AcknowledgementLog.find({
    policy: { $in: policies.map((row) => row._id) },
    employee: { $in: people.map((row) => row._id) },
  });
  const ackKey = {};
  acks.forEach((row) => {
    ackKey[`${row.policy}:${row.employee}:${row.version}`] = row;
  });
  return policies.map((policy) => {
    const outstanding = [];
    let done = 0;
    people.forEach((person) => {
      if (ackKey[`${policy._id}:${person._id}:${policy.version}`]) done += 1;
      else outstanding.push({ id: String(person._id), fullName: person.fullName, employeeCode: person.employeeCode });
    });
    return presentPolicy(policy, {
      headcount: people.length,
      acknowledged: done,
      outstandingCount: outstanding.length,
      outstanding: outstanding.slice(0, 12),
    });
  });
}

function calendarEvent(item) {
  return item;
}

async function buildCalendar({ from, to, employeeFilter, includeCompany, viewerId }) {
  const start = from ? dateOnly(from) : addDays(new Date(), -30);
  const end = to ? dateOnly(to) : addDays(new Date(), 180);
  const horizon = addDays(new Date(), ALERT_DAYS);
  await ensureFilings();

  const events = [];
  const personFilter = employeeFilter && Object.keys(employeeFilter).length ? employeeFilter : {};
  const ownOrTeam = personFilter.employee || (personFilter._id === null ? { $in: [] } : null);

  if (includeCompany) {
    const filings = await Filing.find({ dueOn: { $gte: start, $lte: end } })
      .populate('rule')
      .sort({ dueOn: 1 });
    filings.forEach((row) => {
      const presented = presentFiling(row);
      if (presented.status === 'filed') return;
      events.push({
        id: `filing-${presented.id}`,
        kind: 'filing',
        title: presented.ruleName || 'Statutory filing',
        detail: presented.periodLabel || presented.authority,
        dueOn: presented.dueOn,
        status: presented.status,
        statusLabel: presented.statusLabel,
        holder: presented.authority,
      });
    });
  }

  const licenseQuery = { expiresOn: { $ne: null, $gte: start, $lte: end }, status: { $ne: 'revoked' } };
  if (!includeCompany && viewerId) licenseQuery.employee = viewerId;
  else if (ownOrTeam) licenseQuery.$or = [{ employee: ownOrTeam }, ...(includeCompany ? [{ employee: null }] : [])];
  else if (!includeCompany) licenseQuery.employee = { $in: [] };

  const licenses = await License.find(licenseQuery).sort({ expiresOn: 1 });
  licenses.forEach((row) => {
    const presented = presentLicense(row);
    const due = presented.expiresOn;
    const status = dateOnly(due) < dateOnly(new Date()) ? 'overdue' : dateOnly(due) <= horizon ? 'due' : 'upcoming';
    events.push({
      id: `license-${presented.id}`,
      kind: 'license',
      title: presented.name,
      detail: presented.kindLabel,
      dueOn: due,
      status,
      statusLabel: status === 'overdue' ? 'Expired' : status === 'due' ? 'Renew soon' : 'Scheduled',
      holder: presented.holder,
    });
  });

  const docQuery = { expiresOn: { $ne: null, $gte: start, $lte: end } };
  if (ownOrTeam) docQuery.employee = ownOrTeam;
  else if (!includeCompany && viewerId) docQuery.employee = viewerId;
  const documents = await EmployeeDocument.find(docQuery)
    .populate('employee', 'firstName lastName employeeCode')
    .sort({ expiresOn: 1 });
  documents.forEach((row) => {
    const due = isoDay(row.expiresOn);
    const status = dateOnly(row.expiresOn) < dateOnly(new Date()) ? 'overdue' : dateOnly(row.expiresOn) <= horizon ? 'due' : 'upcoming';
    const holder = row.employee && row.employee.fullName ? row.employee.fullName : '';
    events.push({
      id: `document-${row._id}`,
      kind: 'document',
      title: row.title || row.type,
      detail: 'Personnel document',
      dueOn: due,
      status,
      statusLabel: status === 'overdue' ? 'Expired' : 'Expiring',
      holder,
    });
  });

  const certQuery = { expiresAt: { $ne: null, $gte: start, $lte: end } };
  if (ownOrTeam) certQuery.employee = ownOrTeam;
  else if (!includeCompany && viewerId) certQuery.employee = viewerId;
  const certs = await CertificationRecord.find(certQuery)
    .populate('employee', 'firstName lastName employeeCode')
    .populate('course', 'title code')
    .sort({ expiresAt: 1 });
  certs.forEach((row) => {
    const due = isoDay(row.expiresAt);
    const status = dateOnly(row.expiresAt) < dateOnly(new Date()) ? 'overdue' : dateOnly(row.expiresAt) <= horizon ? 'due' : 'upcoming';
    events.push({
      id: `cert-${row._id}`,
      kind: 'certificate',
      title: row.title,
      detail: row.course && row.course.title ? row.course.title : 'Certificate',
      dueOn: due,
      status,
      statusLabel: status === 'overdue' ? 'Expired' : 'Expiring',
      holder: row.employee && row.employee.fullName ? row.employee.fullName : '',
    });
  });

  events.sort((a, b) => String(a.dueOn).localeCompare(String(b.dueOn)));
  const summary = events.reduce(
    (acc, item) => {
      if (item.status === 'overdue') acc.overdue += 1;
      else if (item.status === 'due') acc.dueSoon += 1;
      return acc;
    },
    { overdue: 0, dueSoon: 0, total: events.length }
  );
  return { from: isoDay(start), to: isoDay(end), summary, events: events.map(calendarEvent) };
}

async function auditExport() {
  const [filings, licenses, policies, acks, retention, logs, schemes] = await Promise.all([
    Filing.find().populate('rule').sort({ dueOn: 1 }).limit(200),
    License.find({ status: { $ne: 'revoked' } }).sort({ expiresOn: 1 }).limit(200),
    PolicyDocument.find({ status: 'published' }).sort({ code: 1 }),
    AcknowledgementLog.find().populate('policy', 'code title version').sort({ acknowledgedAt: -1 }).limit(400),
    RetentionRule.find().sort({ category: 1 }),
    AuditLog.find().sort({ createdAt: -1 }).limit(200),
    StatutoryEnrollment.find({ status: 'active' }).select('scheme covered status').lean(),
  ]);
  const schemeCounts = {};
  schemes.forEach((row) => {
    const key = row.scheme;
    schemeCounts[key] = (schemeCounts[key] || 0) + 1;
  });
  return {
    generatedAt: new Date().toISOString(),
    countryPack: 'PK',
    statutoryCoverage: Object.keys(schemeCounts).map((scheme) => ({
      scheme,
      label: STATUTORY_SCHEME_LABELS[scheme] || scheme,
      heads: schemeCounts[scheme],
    })),
    filings: filings.map(presentFiling),
    licenses: licenses.map(presentLicense),
    policies: policies.map((row) => presentPolicy(row)),
    acknowledgements: acks.map(presentAck),
    retention: retention.map(presentRetention),
    auditTrail: logs.map((row) => {
      const json = row.toJSON ? row.toJSON() : row;
      return {
        id: String(json.id || json._id),
        at: json.createdAt,
        actor: json.actorName,
        role: json.role,
        action: json.action,
        objectType: json.objectType,
        summary: json.summary,
      };
    }),
  };
}

module.exports = {
  asId,
  snapshotOf,
  nextCode,
  presentRule,
  presentFiling,
  presentLicense,
  presentPolicy,
  presentAck,
  presentRetention,
  ensureFilings,
  createRule,
  markFiled,
  createLicense,
  revokeLicense,
  createPolicy,
  publishPolicy,
  acknowledgePolicy,
  upsertRetention,
  policyDashboard,
  buildCalendar,
  auditExport,
};
