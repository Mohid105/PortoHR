'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const TenantSettings = require('../models/TenantSettings');
const RolePermission = require('../models/RolePermission');
const WorkflowDefinition = require('../models/WorkflowDefinition');
const Delegation = require('../models/Delegation');
const NotificationTemplate = require('../models/NotificationTemplate');
const LookupValue = require('../models/LookupValue');
const IntegrationConnector = require('../models/IntegrationConnector');
const ApiKey = require('../models/ApiKey');
const AuditLog = require('../models/AuditLog');
const Employee = require('../models/Employee');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { ROLES, ROLE_VALUES, ROLE_MODULES, MODULES, MODULE_LABELS } = require('../config/roles');
const {
  WORKFLOW_EVENTS,
  WORKFLOW_EVENT_LABELS,
  CONNECTOR_KINDS,
  CONNECTOR_KIND_LABELS,
  LOOKUP_CATEGORIES,
  metaPayload,
} = require('../config/admin');
const { guardMatrix, invalidateModuleCache, loadOverlay } = require('./moduleAccess');
const { startOfLocalDay, endOfLocalDay } = require('./employeeAccess');
const notifications = require('./notifications.service');
const webhooks = require('./webhooks.service');

const DEFAULT_WORKFLOWS = {
  leave: { actor: 'manager', summary: 'Direct manager decides; HR can override.' },
  assignment: { actor: 'manager', summary: 'Manager of the employee decides assignment changes.' },
  loan: { actor: 'manager', summary: 'Salary loans wait on the manager.' },
  compensation: { actor: 'manager', summary: 'Claims wait on the manager.' },
  bank: { actor: 'manager', summary: 'Payment-method changes wait on the manager.' },
  requisition: { actor: 'manager', summary: 'Hiring manager’s manager (or HR) opens a requisition.' },
  offer: { actor: 'hr_admin', summary: 'Offers are an HR decision.' },
  benefits: { actor: 'hr_admin', summary: 'Benefit elections are an HR decision.' },
  statutory: { actor: 'hr_admin', summary: 'Statutory coverage is an HR decision.' },
  lms: { actor: 'manager', summary: 'Learning nominations wait on the manager.' },
};

const DEFAULT_TEMPLATES = [
  {
    code: 'delegation_granted',
    name: 'Delegation granted',
    channel: 'in_app',
    subject: 'You can approve for {{grantor}}',
    body: '{{grantor}} delegated approvals to you from {{fromOn}} to {{toOn}}. {{note}}',
  },
  {
    code: 'delegation_cancelled',
    name: 'Delegation cancelled',
    channel: 'in_app',
    subject: 'Delegation from {{grantor}} ended',
    body: 'You are no longer covering approvals for {{grantor}}.',
  },
  {
    code: 'workflow_published',
    name: 'Workflow published',
    channel: 'in_app',
    subject: '{{event}} workflow is live',
    body: 'The {{event}} approval path was published with {{steps}} step(s).',
  },
  {
    code: 'esign_sent',
    name: 'Signature requested',
    channel: 'in_app',
    subject: 'Please sign {{code}}',
    body: '{{title}} is waiting for your signature. Signing records consent — it does not change Core HR or payroll.',
  },
  {
    code: 'outbox_test',
    name: 'Outbound mail test',
    channel: 'email',
    subject: 'PortoHR outbox test',
    body: 'This is a queued email for {{grantor}}. It stays in the outbox until SMTP_HOST is configured — nothing is sent to a fake gateway.',
  },
];

function present(doc) {
  if (!doc) return null;
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  if (json.actor) json.actor = String(json.actor);
  if (json.employee) json.employee = String(json.employee._id || json.employee);
  if (json.grantor) json.grantor = String(json.grantor._id || json.grantor);
  if (json.delegate) json.delegate = String(json.delegate._id || json.delegate);
  if (json.createdBy) json.createdBy = String(json.createdBy);
  if (json.user) json.user = String(json.user);
  if (json.fromOn) json.fromOn = calendarKey(new Date(json.fromOn));
  if (json.toOn) json.toOn = calendarKey(new Date(json.toOn));
  if (json.publishedAt) json.publishedAt = calendarKey(new Date(json.publishedAt));
  if (Array.isArray(json.steps)) {
    json.steps = json.steps.map((step) => {
      const row = Object.assign({}, step);
      if (row._id) row.id = String(row._id);
      return row;
    });
  }
  return json;
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

function parseLocalDate(value, label) {
  const text = String(value || '').slice(0, 10);
  const parts = text.split('-').map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw ApiError.badRequest(`${label} must be a calendar date`);
  }
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function calendarKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

async function ensureTenant() {
  let row = await TenantSettings.findOne();
  if (!row) {
    row = await TenantSettings.create({
      name: 'PortoHR',
      legalEntity: 'PortoHR (Pvt) Ltd',
      country: 'PK',
      locale: 'en-PK',
      timezone: 'Asia/Karachi',
      currency: 'PKR',
      fyStartMonth: 7,
      supportEmail: 'hr@portohr.test',
    });
  }
  return present(row);
}

async function ensureWorkflows() {
  for (const event of WORKFLOW_EVENTS) {
    const exists = await WorkflowDefinition.findOne({ event });
    if (exists) continue;
    const def = DEFAULT_WORKFLOWS[event] || { actor: 'manager', summary: '' };
    await WorkflowDefinition.create({
      event,
      name: WORKFLOW_EVENT_LABELS[event] || event,
      summary: def.summary,
      status: 'published',
      publishedAt: new Date(),
      steps: [{ order: 1, actorRole: def.actor, thresholdAmount: 0, label: 'Decide' }],
    });
  }
}

async function ensureTemplates() {
  for (const row of DEFAULT_TEMPLATES) {
    await NotificationTemplate.updateOne({ code: row.code }, { $setOnInsert: row }, { upsert: true });
  }
}

async function ensureConnectors() {
  for (const kind of CONNECTOR_KINDS) {
    const exists = await IntegrationConnector.findOne({ kind });
    if (exists) continue;
    const webhook = kind === 'webhook';
    await IntegrationConnector.create({
      kind,
      name: CONNECTOR_KIND_LABELS[kind],
      enabled: webhook,
      endpoint: webhook ? webhooks.inboxUrl() : '',
      secret: webhook ? 'portohr-webhook-dev' : '',
      rateLimitPerMin: 60,
    });
  }
  const webhook = await IntegrationConnector.findOne({ kind: 'webhook' });
  if (webhook && !webhook.endpoint) {
    webhook.enabled = true;
    webhook.endpoint = webhooks.inboxUrl();
    webhook.secret = webhook.secret || 'portohr-webhook-dev';
    await webhook.save();
  }
}

async function ensureLookups() {
  const rows = [
    { category: 'reason_code', code: 'NEW_HIRE', label: 'New hire' },
    { category: 'reason_code', code: 'PROMOTION', label: 'Promotion' },
    { category: 'reason_code', code: 'TRANSFER', label: 'Transfer' },
    { category: 'document_type', code: 'CNIC', label: 'National ID' },
    { category: 'document_type', code: 'CONTRACT', label: 'Employment contract' },
    { category: 'separation_reason', code: 'RESIGNATION', label: 'Resignation' },
    { category: 'separation_reason', code: 'TERMINATION', label: 'Termination' },
    { category: 'cost_center', code: 'ENG', label: 'Engineering' },
    { category: 'cost_center', code: 'HR', label: 'Human Resources' },
  ];
  for (const row of rows) {
    await LookupValue.updateOne(
      { category: row.category, code: row.code },
      { $setOnInsert: Object.assign({ active: true }, row) },
      { upsert: true }
    );
  }
}

async function ensureDefaults() {
  await Promise.all([ensureTenant(), ensureWorkflows(), ensureTemplates(), ensureConnectors(), ensureLookups()]);
}

function adminMeta(overlay) {
  const modules = Object.values(MODULES).map((value) => ({ value, label: MODULE_LABELS[value] || value }));
  return {
    ...metaPayload(),
    modules,
    roles: ROLE_VALUES.map((value) => ({
      value,
      label: value === ROLES.HR_ADMIN ? 'HR Admin' : value === ROLES.MANAGER ? 'Manager' : 'Employee',
      modules: overlay[value] || ROLE_MODULES[value],
    })),
  };
}

async function getSettings() {
  await ensureDefaults();
  const overlay = await loadOverlay();
  return {
    settings: await ensureTenant(),
    meta: adminMeta(overlay),
  };
}

async function saveSettings(body) {
  const row = (await TenantSettings.findOne()) || new TenantSettings();
  ['name', 'legalEntity', 'country', 'locale', 'timezone', 'currency', 'supportEmail'].forEach((key) => {
    if (body[key] !== undefined) row[key] = String(body[key]).trim();
  });
  if (body.fyStartMonth !== undefined) {
    const month = Number(body.fyStartMonth);
    if (month < 1 || month > 12) throw ApiError.badRequest('Financial year start month must be 1–12');
    row.fyStartMonth = month;
  }
  await row.save();
  return present(row);
}

async function getPermissions() {
  const overlay = await loadOverlay();
  return ROLE_VALUES.map((role) => ({
    role,
    modules: overlay[role] || [],
  }));
}

async function savePermissions(body) {
  const incoming = (body && body.roles) || {};
  const saved = [];
  for (const role of ROLE_VALUES) {
    const modules = guardMatrix(role, incoming[role] || ROLE_MODULES[role]);
    const row = await RolePermission.findOneAndUpdate(
      { role },
      { $set: { role, modules } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    saved.push({ role: row.role, modules: row.modules, id: String(row._id) });
  }
  invalidateModuleCache();
  return saved;
}

function normalizeSteps(steps) {
  if (!Array.isArray(steps) || !steps.length) {
    throw ApiError.badRequest('A workflow needs at least one step');
  }
  return steps.map((step, index) => ({
    order: index + 1,
    actorRole: step.actorRole,
    thresholdAmount: Number(step.thresholdAmount || 0),
    label: String(step.label || '').trim().slice(0, 80),
  }));
}

async function listWorkflows() {
  await ensureWorkflows();
  const rows = await WorkflowDefinition.find({}).sort({ event: 1 });
  return rows.map(present);
}

async function saveWorkflow(id, body) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Workflow not found');
  const row = await WorkflowDefinition.findById(id);
  if (!row) throw ApiError.notFound('Workflow not found');
  if (body.name !== undefined) row.name = String(body.name).trim();
  if (body.summary !== undefined) row.summary = String(body.summary).trim();
  if (body.steps) {
    row.steps = normalizeSteps(body.steps);
    if (row.status === 'published') row.status = 'draft';
  }
  await row.save();
  return present(row);
}

async function publishWorkflow(id, user) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Workflow not found');
  const row = await WorkflowDefinition.findById(id);
  if (!row) throw ApiError.notFound('Workflow not found');
  if (!row.steps.length) throw ApiError.badRequest('Add at least one step before publishing');
  row.status = 'published';
  row.publishedAt = new Date();
  await row.save();
  await notifications.dispatch('workflow_published', user, {
    event: WORKFLOW_EVENT_LABELS[row.event] || row.event,
    steps: row.steps.length,
  });
  return present(row);
}

async function archiveWorkflow(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Workflow not found');
  const row = await WorkflowDefinition.findById(id);
  if (!row) throw ApiError.notFound('Workflow not found');
  row.status = 'archived';
  await row.save();
  return present(row);
}

async function listDelegations(filter) {
  const rows = await Delegation.find(filter || {})
    .sort({ createdAt: -1 })
    .limit(100);
  return rows.map(present);
}

async function createDelegation(actor, body) {
  const grantor = await Employee.findById(body.grantor);
  const delegate = await Employee.findById(body.delegate);
  if (!grantor || !delegate) throw ApiError.notFound('Employee not found');
  if (String(grantor._id) === String(delegate._id)) {
    throw ApiError.badRequest('A person cannot cover their own approvals');
  }

  const fromOn = startOfLocalDay(parseLocalDate(body.fromOn, 'Start date'));
  const toOn = endOfLocalDay(parseLocalDate(body.toOn, 'End date'));
  if (toOn < fromOn) throw ApiError.badRequest('End date cannot be before the start date');

  const grantorUser = await User.findOne({
    $or: [{ email: grantor.email }, { employeeId: grantor.employeeCode }],
  });
  const grantorRole = grantorUser ? grantorUser.role : ROLES.MANAGER;
  if (grantorRole === ROLES.EMPLOYEE) {
    throw ApiError.badRequest('This person has no approval queue to delegate');
  }
  if (actor.role !== ROLES.HR_ADMIN) {
    const viewerCode = actor.employeeId;
    if (grantor.employeeCode !== viewerCode && grantor.email !== actor.email) {
      throw ApiError.forbidden('You can only delegate your own approvals');
    }
  }

  const row = await Delegation.create({
    grantor: grantor._id,
    grantorRole: grantorRole === ROLES.HR_ADMIN ? ROLES.HR_ADMIN : ROLES.MANAGER,
    grantorSnapshot: snapshotOf(grantor),
    delegate: delegate._id,
    delegateSnapshot: snapshotOf(delegate),
    fromOn,
    toOn,
    status: 'active',
    note: String(body.note || '').trim(),
    createdBy: actor._id,
  });

  await notifications.notifyEmployee('delegation_granted', delegate, {
    grantor: grantor.fullName,
    fromOn: calendarKey(fromOn),
    toOn: calendarKey(toOn),
    note: row.note,
  });

  return present(row);
}

async function cancelDelegation(id, actor) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Delegation not found');
  const row = await Delegation.findById(id);
  if (!row) throw ApiError.notFound('Delegation not found');
  if (row.status !== 'active') throw ApiError.conflict('This delegation is no longer active');
  row.status = 'cancelled';
  await row.save();
  const delegate = await Employee.findById(row.delegate);
  await notifications.notifyEmployee('delegation_cancelled', delegate, {
    grantor: (row.grantorSnapshot && row.grantorSnapshot.fullName) || 'a colleague',
  });
  return present(row);
}

async function listTemplates() {
  await ensureTemplates();
  const rows = await NotificationTemplate.find({}).sort({ code: 1 });
  return rows.map(present);
}

async function saveTemplate(id, body) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Template not found');
  const row = await NotificationTemplate.findById(id);
  if (!row) throw ApiError.notFound('Template not found');
  ['name', 'subject', 'body', 'channel'].forEach((key) => {
    if (body[key] !== undefined) row[key] = body[key];
  });
  if (body.active !== undefined) row.active = Boolean(body.active);
  await row.save();
  return present(row);
}

async function testTemplate(id, user) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Template not found');
  const row = await NotificationTemplate.findById(id);
  if (!row) throw ApiError.notFound('Template not found');
  const sent = await notifications.dispatch(row.code, user, {
    grantor: user.fullName,
    fromOn: calendarKey(new Date()),
    toOn: calendarKey(new Date()),
    note: 'This is a test notification.',
    event: row.name,
    steps: 1,
  });
  return sent;
}

async function listLookups(category) {
  await ensureLookups();
  const filter = {};
  if (category && LOOKUP_CATEGORIES.indexOf(category) !== -1) filter.category = category;
  const rows = await LookupValue.find(filter).sort({ category: 1, code: 1 });
  return rows.map(present);
}

async function createLookup(body) {
  const category = body.category;
  if (LOOKUP_CATEGORIES.indexOf(category) === -1) throw ApiError.badRequest('Unknown lookup category');
  const code = String(body.code || '')
    .trim()
    .toUpperCase();
  const label = String(body.label || '').trim();
  if (!code || !label) throw ApiError.badRequest('Code and label are required');
  try {
    const row = await LookupValue.create({ category, code, label, active: body.active !== false });
    return present(row);
  } catch (err) {
    if (err && err.code === 11000) throw ApiError.conflict('That lookup code already exists');
    throw err;
  }
}

async function saveLookup(id, body) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Lookup not found');
  const row = await LookupValue.findById(id);
  if (!row) throw ApiError.notFound('Lookup not found');
  if (body.label !== undefined) row.label = String(body.label).trim();
  if (body.active !== undefined) row.active = Boolean(body.active);
  await row.save();
  return present(row);
}

async function listConnectors() {
  await ensureConnectors();
  const rows = await IntegrationConnector.find({}).sort({ kind: 1 });
  return rows.map(present);
}

async function saveConnector(id, body) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Connector not found');
  const row = await IntegrationConnector.findById(id);
  if (!row) throw ApiError.notFound('Connector not found');
  if (body.name !== undefined) row.name = String(body.name).trim();
  if (body.endpoint !== undefined) row.endpoint = String(body.endpoint).trim();
  if (body.enabled !== undefined) row.enabled = Boolean(body.enabled);
  if (body.rateLimitPerMin !== undefined) row.rateLimitPerMin = Number(body.rateLimitPerMin);
  if (body.secret !== undefined && body.secret && !/^•+$/.test(String(body.secret))) {
    row.secret = String(body.secret).trim();
  }
  await row.save();
  return present(row);
}

async function testConnector(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Connector not found');
  const row = await IntegrationConnector.findById(id);
  if (!row) throw ApiError.notFound('Connector not found');
  row.lastTestAt = new Date();
  if (row.kind === 'webhook') {
    const delivery = await webhooks.deliver('webhook.test', {
      kind: row.kind,
      name: row.name,
      at: new Date().toISOString(),
    });
    const target = delivery.endpoint || 'inbox';
    row.lastTestNote = delivery.status === 'sent'
      ? `Signed POST accepted (${delivery.responseStatus || 202}) → ${target}`
      : `${delivery.status}: ${delivery.lastError || target}`;
    await row.save();
    return present(row);
  }
  row.lastTestNote = row.enabled
    ? `${CONNECTOR_KIND_LABELS[row.kind] || row.kind} has no live adapter in this stack — settings stored only.`
    : 'Connector is disabled — nothing was sent.';
  await row.save();
  return present(row);
}

async function listDeliveries(query) {
  return webhooks.listDeliveries(query);
}

async function listOutbox() {
  return notifications.listOutbox();
}

async function listKeys() {
  const rows = await ApiKey.find({}).sort({ createdAt: -1 }).limit(50);
  return rows.map(present);
}

async function createKey(user, body) {
  const name = String((body && body.name) || '').trim();
  if (!name) throw ApiError.badRequest('Give the key a name');
  const raw = `phr_${crypto.randomBytes(24).toString('hex')}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const row = await ApiKey.create({
    name,
    prefix: raw.slice(0, 12),
    hash,
    createdBy: user._id,
  });
  const presented = present(row);
  presented.secret = raw;
  return presented;
}

async function revokeKey(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('API key not found');
  const row = await ApiKey.findById(id);
  if (!row) throw ApiError.notFound('API key not found');
  if (row.revokedAt) throw ApiError.conflict('This key is already revoked');
  row.revokedAt = new Date();
  await row.save();
  return present(row);
}

async function listAudit(query) {
  const filter = {};
  if (query.action) filter.action = new RegExp(String(query.action).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const rows = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(80);
  return rows.map(present);
}

async function directory() {
  const rows = await Employee.find({ employmentStatus: { $nin: ['terminated'] } })
    .select('employeeCode firstName lastName designation department email')
    .sort({ firstName: 1 })
    .limit(200);
  return rows.map((row) => {
    const json = row.toJSON();
    json.id = String(json.id || json._id);
    json.fullName = row.fullName;
    return json;
  });
}

module.exports = {
  present,
  ensureDefaults,
  getSettings,
  saveSettings,
  getPermissions,
  savePermissions,
  listWorkflows,
  saveWorkflow,
  publishWorkflow,
  archiveWorkflow,
  listDelegations,
  createDelegation,
  cancelDelegation,
  listTemplates,
  saveTemplate,
  testTemplate,
  listLookups,
  createLookup,
  saveLookup,
  listConnectors,
  saveConnector,
  testConnector,
  listDeliveries,
  listOutbox,
  listKeys,
  createKey,
  revokeKey,
  listAudit,
  directory,
};
