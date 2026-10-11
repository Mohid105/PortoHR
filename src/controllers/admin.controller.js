'use strict';

const admin = require('../services/admin.service');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../services/audit.service');
const { resolveViewerEmployee } = require('../services/employeeAccess');
const { ROLES } = require('../config/roles');
const ApiError = require('../utils/ApiError');

const meta = asyncHandler(async (_req, res) => {
  const payload = await admin.getSettings();
  res.json({ success: true, ...payload });
});

const saveSettings = asyncHandler(async (req, res) => {
  const settings = await admin.saveSettings(req.body || {});
  await audit.record(req, { action: 'admin_settings', objectType: 'TenantSettings', objectId: settings.id, summary: settings.name });
  res.json({ success: true, settings });
});

const permissions = asyncHandler(async (_req, res) => {
  res.json({ success: true, roles: await admin.getPermissions() });
});

const savePermissions = asyncHandler(async (req, res) => {
  const roles = await admin.savePermissions(req.body || {});
  await audit.record(req, { action: 'admin_permissions', objectType: 'RolePermission', summary: 'Role matrix saved' });
  res.json({ success: true, roles });
});

const workflows = asyncHandler(async (_req, res) => {
  res.json({ success: true, workflows: await admin.listWorkflows() });
});

const saveWorkflow = asyncHandler(async (req, res) => {
  const workflow = await admin.saveWorkflow(req.params.id, req.body || {});
  await audit.record(req, {
    action: 'admin_workflow',
    objectType: 'WorkflowDefinition',
    objectId: workflow.id,
    summary: `${workflow.event} saved as ${workflow.status}`,
  });
  res.json({ success: true, workflow });
});

const publishWorkflow = asyncHandler(async (req, res) => {
  const workflow = await admin.publishWorkflow(req.params.id, req.user);
  await audit.record(req, {
    action: 'admin_workflow_publish',
    objectType: 'WorkflowDefinition',
    objectId: workflow.id,
    summary: workflow.event,
  });
  res.json({ success: true, message: `${workflow.name} is now live`, workflow });
});

const archiveWorkflow = asyncHandler(async (req, res) => {
  const workflow = await admin.archiveWorkflow(req.params.id);
  await audit.record(req, {
    action: 'admin_workflow_archive',
    objectType: 'WorkflowDefinition',
    objectId: workflow.id,
    summary: workflow.event,
  });
  res.json({ success: true, workflow });
});

const delegations = asyncHandler(async (_req, res) => {
  res.json({ success: true, delegations: await admin.listDelegations() });
});

const createDelegation = asyncHandler(async (req, res) => {
  const row = await admin.createDelegation(req.user, req.body || {});
  await audit.record(req, {
    action: 'admin_delegation',
    objectType: 'Delegation',
    objectId: row.id,
    employee: row.grantor,
    summary: `${row.grantorSnapshot.fullName} → ${row.delegateSnapshot.fullName}`,
  });
  res.status(201).json({ success: true, message: 'Delegation recorded', delegation: row });
});

const cancelDelegation = asyncHandler(async (req, res) => {
  const row = await admin.cancelDelegation(req.params.id, req.user);
  await audit.record(req, {
    action: 'admin_delegation_cancel',
    objectType: 'Delegation',
    objectId: row.id,
    summary: 'Delegation cancelled',
  });
  res.json({ success: true, delegation: row });
});

const templates = asyncHandler(async (_req, res) => {
  res.json({ success: true, templates: await admin.listTemplates() });
});

const saveTemplate = asyncHandler(async (req, res) => {
  const template = await admin.saveTemplate(req.params.id, req.body || {});
  await audit.record(req, { action: 'admin_template', objectType: 'NotificationTemplate', objectId: template.id, summary: template.code });
  res.json({ success: true, template });
});

const testTemplate = asyncHandler(async (req, res) => {
  const notification = await admin.testTemplate(req.params.id, req.user);
  const queued = notification && notification.status === 'queued';
  res.json({
    success: true,
    message: queued
      ? `Queued on ${notification.channel} — held in the outbox (no SMTP gateway)`
      : 'Test notification sent to you',
    notification,
  });
});

const lookups = asyncHandler(async (req, res) => {
  res.json({ success: true, lookups: await admin.listLookups(req.query.category) });
});

const createLookup = asyncHandler(async (req, res) => {
  const lookup = await admin.createLookup(req.body || {});
  await audit.record(req, { action: 'admin_lookup', objectType: 'LookupValue', objectId: lookup.id, summary: lookup.code });
  res.status(201).json({ success: true, lookup });
});

const saveLookup = asyncHandler(async (req, res) => {
  const lookup = await admin.saveLookup(req.params.id, req.body || {});
  res.json({ success: true, lookup });
});

const connectors = asyncHandler(async (_req, res) => {
  res.json({ success: true, connectors: await admin.listConnectors() });
});

const saveConnector = asyncHandler(async (req, res) => {
  const connector = await admin.saveConnector(req.params.id, req.body || {});
  await audit.record(req, { action: 'admin_connector', objectType: 'IntegrationConnector', objectId: connector.id, summary: connector.kind });
  res.json({ success: true, connector });
});

const testConnector = asyncHandler(async (req, res) => {
  const connector = await admin.testConnector(req.params.id);
  res.json({ success: true, message: connector.lastTestNote, connector });
});

const deliveries = asyncHandler(async (req, res) => {
  res.json({ success: true, deliveries: await admin.listDeliveries(req.query || {}) });
});

const outbox = asyncHandler(async (_req, res) => {
  res.json({ success: true, outbox: await admin.listOutbox() });
});

const keys = asyncHandler(async (_req, res) => {
  res.json({ success: true, keys: await admin.listKeys() });
});

const createKey = asyncHandler(async (req, res) => {
  const key = await admin.createKey(req.user, req.body || {});
  await audit.record(req, { action: 'admin_api_key', objectType: 'ApiKey', objectId: key.id, summary: key.name });
  res.status(201).json({ success: true, message: 'Copy the secret now — it is not stored in plain text', key });
});

const revokeKey = asyncHandler(async (req, res) => {
  const key = await admin.revokeKey(req.params.id);
  await audit.record(req, { action: 'admin_api_key_revoke', objectType: 'ApiKey', objectId: key.id, summary: key.name });
  res.json({ success: true, key });
});

const auditLog = asyncHandler(async (req, res) => {
  res.json({ success: true, entries: await admin.listAudit(req.query || {}) });
});

const directory = asyncHandler(async (_req, res) => {
  res.json({ success: true, employees: await admin.directory() });
});

/** Non-admin callers: own delegations only. */
const myDelegations = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  if (!viewer) return res.json({ success: true, delegations: [] });
  const rows = await admin.listDelegations({
    $or: [{ grantor: viewer._id }, { delegate: viewer._id }],
  });
  res.json({ success: true, delegations: rows });
});

const createMyDelegation = asyncHandler(async (req, res) => {
  if (req.user.role === ROLES.EMPLOYEE) {
    throw ApiError.forbidden('Employees cannot delegate an approval queue');
  }
  const viewer = await resolveViewerEmployee(req.user);
  if (!viewer) throw ApiError.badRequest('Your login is not linked to an employee record yet');
  const row = await admin.createDelegation(req.user, Object.assign({}, req.body || {}, { grantor: String(viewer._id) }));
  res.status(201).json({ success: true, message: 'Delegation recorded', delegation: row });
});

const cancelMyDelegation = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  const existing = (await admin.listDelegations({ _id: req.params.id }))[0];
  if (!existing) throw ApiError.notFound('Delegation not found');
  if (req.user.role !== ROLES.HR_ADMIN && (!viewer || existing.grantor !== String(viewer._id))) {
    throw ApiError.forbidden('You can only cancel a delegation you granted');
  }
  const row = await admin.cancelDelegation(req.params.id, req.user);
  res.json({ success: true, delegation: row });
});

const access = require('../services/access.service');

const users = asyncHandler(async (_req, res) => {
  res.json({ success: true, users: await access.listUsers() });
});

const unlinkedEmployees = asyncHandler(async (_req, res) => {
  res.json({ success: true, employees: await access.listUnlinked() });
});

const createUser = asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!body.employee) throw ApiError.badRequest('Choose an employee to give a login to');
  const result = await access.createLogin(body.employee, body);
  await audit.record(req, { action: 'user_create', objectType: 'User', objectId: result.user.id, summary: `Login created for ${result.user.fullName} (${result.user.roleLabel})` });
  res.status(201).json({ success: true, ...result });
});

const updateUser = asyncHandler(async (req, res) => {
  const user = await access.updateUser(req.params.id, req.body || {}, req.user);
  await audit.record(req, { action: 'user_update', objectType: 'User', objectId: user.id, summary: `${user.fullName}: ${user.roleLabel}, ${user.isActive ? 'active' : 'deactivated'}` });
  res.json({ success: true, user });
});

const resetPassword = asyncHandler(async (req, res) => {
  const result = await access.resetPassword(req.params.id, req.user);
  await audit.record(req, { action: 'user_password_reset', objectType: 'User', objectId: result.user.id, summary: `Password reset for ${result.user.fullName}` });
  res.json({ success: true, ...result });
});

const unlockUser = asyncHandler(async (req, res) => {
  const user = await access.unlock(req.params.id);
  await audit.record(req, { action: 'user_unlock', objectType: 'User', objectId: user.id, summary: `Unlocked ${user.fullName}` });
  res.json({ success: true, user });
});

const revokeSessions = asyncHandler(async (req, res) => {
  const user = await access.revokeSessions(req.params.id);
  await audit.record(req, { action: 'sessions_revoked', objectType: 'User', objectId: user.id, summary: `Ended all sessions for ${user.fullName}` });
  res.json({ success: true, user });
});

const securityEvents = asyncHandler(async (req, res) => {
  res.json({ success: true, events: await access.listEvents(req.query || {}) });
});

module.exports = {
  unlockUser,
  revokeSessions,
  securityEvents,
  users,
  unlinkedEmployees,
  createUser,
  updateUser,
  resetPassword,
  meta,
  saveSettings,
  permissions,
  savePermissions,
  workflows,
  saveWorkflow,
  publishWorkflow,
  archiveWorkflow,
  delegations,
  createDelegation,
  cancelDelegation,
  templates,
  saveTemplate,
  testTemplate,
  lookups,
  createLookup,
  saveLookup,
  connectors,
  saveConnector,
  testConnector,
  deliveries,
  outbox,
  keys,
  createKey,
  revokeKey,
  auditLog,
  directory,
  myDelegations,
  createMyDelegation,
  cancelMyDelegation,
};
