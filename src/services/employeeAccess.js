'use strict';

const Employee = require('../models/Employee');
const Delegation = require('../models/Delegation');
const WorkflowDefinition = require('../models/WorkflowDefinition');
const { ROLES } = require('../config/roles');

/** Calendar day in the server's local timezone — never UTC slice. */
function startOfLocalDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfLocalDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

/** The Employee record belonging to the signed-in User, if one exists. */
async function resolveViewerEmployee(user) {
  return Employee.findOne({
    $or: [{ userAccount: user._id }, { email: user.email }, { employeeCode: user.employeeId }],
  });
}

function isSelf(user, viewerEmployee, employee) {
  const viewerId = viewerEmployee && String(viewerEmployee._id);
  return Boolean((viewerId && viewerId === String(employee._id)) || employee.email === user.email);
}

function managesDirectly(viewerEmployee, employee) {
  if (!viewerEmployee || !employee.reportsTo) return false;
  const managerId = employee.reportsTo._id || employee.reportsTo;
  return String(managerId) === String(viewerEmployee._id);
}

/**
 * Salary, attendance, payslips and requests are not directory information.
 * HR Admins see everything; everyone else sees their own record, and managers
 * additionally see the records of their direct reports.
 */
function canViewSensitive(user, viewerEmployee, employee) {
  if (user.role === ROLES.HR_ADMIN) return true;
  if (isSelf(user, viewerEmployee, employee)) return true;
  return user.role === ROLES.MANAGER && managesDirectly(viewerEmployee, employee);
}

function employeeIdOf(value) {
  if (!value) return '';
  return String(value._id || value);
}

async function activeDelegationsFor(viewerEmployee) {
  if (!viewerEmployee) return [];
  const now = new Date();
  return Delegation.find({
    delegate: viewerEmployee._id,
    status: 'active',
    fromOn: { $lte: endOfLocalDay(now) },
    toOn: { $gte: startOfLocalDay(now) },
  }).populate('grantor', 'firstName lastName employeeCode designation department reportsTo');
}

async function publishedActorRoles(event) {
  if (!event) return null;
  const workflow = await WorkflowDefinition.findOne({ event, status: 'published' }).lean();
  if (!workflow || !workflow.steps || !workflow.steps.length) return null;
  return Array.from(new Set(workflow.steps.map((step) => step.actorRole)));
}

/**
 * Roles this caller may act as when deciding a request for `employee`.
 * Delegation copies the grantor's role for the grantor's team only.
 */
async function actingRoles(user, viewerEmployee, employee) {
  if (isSelf(user, viewerEmployee, employee)) return [];

  const roles = [];
  if (user.role === ROLES.HR_ADMIN) roles.push(ROLES.HR_ADMIN);
  if (user.role === ROLES.MANAGER && managesDirectly(viewerEmployee, employee)) {
    roles.push(ROLES.MANAGER);
  }

  const delegations = await activeDelegationsFor(viewerEmployee);
  delegations.forEach((row) => {
    const grantor = row.grantor;
    if (!grantor) return;
    if (employeeIdOf(grantor) === String(employee._id)) return;
    if (row.grantorRole === ROLES.HR_ADMIN) roles.push(ROLES.HR_ADMIN);
    if (row.grantorRole === ROLES.MANAGER && managesDirectly(grantor, employee)) {
      roles.push(ROLES.MANAGER);
    }
  });

  return Array.from(new Set(roles));
}

/**
 * Who may approve or reject a request raised for `employee`.
 *
 * Nobody signs off their own request, including HR Admins — an approval is a
 * control, and a control you can apply to yourself is not one.
 *
 * `event` is a published workflow key (leave, bank, …). When a published
 * definition exists, only its actor roles may decide; HR still overrides
 * unless they are the requester.
 */
async function canDecideFor(user, viewerEmployee, employee, event) {
  const acting = await actingRoles(user, viewerEmployee, employee);
  if (!acting.length) return false;

  const allowed = await publishedActorRoles(event);
  if (!allowed) return true;
  if (acting.includes(ROLES.HR_ADMIN)) return true;
  return acting.some((role) => allowed.includes(role));
}

/**
 * The employees whose records a caller may read. `null` means no restriction.
 * Shared by Payroll, Loans and Compensation so the scoping cannot drift apart.
 * Delegation never expands this — it is for approvals only.
 */
async function visibleEmployeeIds(user) {
  if (user.role === ROLES.HR_ADMIN) return null;

  const viewer = await resolveViewerEmployee(user);
  if (!viewer) return [];

  const ids = [viewer._id];
  if (user.role === ROLES.MANAGER) {
    const reports = await Employee.find({ reportsTo: viewer._id }).select('_id');
    reports.forEach((report) => ids.push(report._id));
  }
  return ids;
}

async function reportIdsFor(managerEmployee) {
  if (!managerEmployee) return [];
  const reports = await Employee.find({ reportsTo: managerEmployee._id }).select('_id');
  return reports.map((report) => report._id);
}

/**
 * A Mongo filter fragment selecting the requests this caller is entitled to
 * decide, or null when they may decide none. Self-raised requests are excluded
 * for the same reason `canDecideFor` refuses them. Active delegations add the
 * grantor's queue without opening salary or team-file access.
 */
async function approvalScope(user) {
  const viewer = await resolveViewerEmployee(user);
  const excluded = [];
  if (viewer) excluded.push(viewer._id);

  let companyWide = user.role === ROLES.HR_ADMIN;
  const reportIds = [];

  if (user.role === ROLES.MANAGER && viewer) {
    (await reportIdsFor(viewer)).forEach((id) => reportIds.push(id));
  }

  const delegations = await activeDelegationsFor(viewer);
  for (const row of delegations) {
    const grantor = row.grantor;
    if (!grantor) continue;
    excluded.push(grantor._id);
    if (row.grantorRole === ROLES.HR_ADMIN) companyWide = true;
    if (row.grantorRole === ROLES.MANAGER) {
      (await reportIdsFor(grantor)).forEach((id) => reportIds.push(id));
    }
  }

  if (companyWide) {
    if (!excluded.length) return {};
    return { employee: { $nin: excluded } };
  }

  const unique = [];
  const seen = new Set();
  reportIds.forEach((id) => {
    const key = String(id);
    if (seen.has(key)) return;
    if (viewer && key === String(viewer._id)) return;
    seen.add(key);
    unique.push(id);
  });

  if (!unique.length) return null;
  return { employee: { $in: unique } };
}

module.exports = {
  resolveViewerEmployee,
  isSelf,
  managesDirectly,
  canViewSensitive,
  canDecideFor,
  visibleEmployeeIds,
  approvalScope,
  startOfLocalDay,
  endOfLocalDay,
  activeDelegationsFor,
};
