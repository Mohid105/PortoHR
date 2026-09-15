'use strict';

const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const Assignment = require('../models/Assignment');
const Person = require('../models/Person');
const Employment = require('../models/Employment');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { metaPayload } = require('../config/hr');
const { ASSIGNMENT_STATUS_LABELS, ASSIGNMENT_FIELDS, LOW_SELF_FIELDS } = require('../config/workforce');
const {
  resolveViewerEmployee,
  canViewSensitive,
  canDecideFor,
  isSelf,
  approvalScope,
  visibleEmployeeIds,
} = require('../services/employeeAccess');
const { ROLES } = require('../config/roles');
const workforce = require('../services/workforce.service');
const profile = require('../services/profile.service');
const org = require('../services/org.service');
const audit = require('../services/audit.service');
const webhooks = require('../services/webhooks.service');
const BankAccount = require('../models/BankAccount');
const StatutoryEnrollment = require('../models/StatutoryEnrollment');
const { PERSONNEL_EVENT_LABELS } = require('../config/org');

/** Fields a client is allowed to write. Anything else in the body is ignored. */
const WRITABLE_FIELDS = [
  'employeeCode',
  'firstName',
  'lastName',
  'email',
  'phone',
  'dateOfBirth',
  'gender',
  'address',
  'designation',
  'department',
  'team',
  'employmentType',
  'employmentStatus',
  'dateOfJoining',
  'reportsTo',
  'shiftType',
  'restDays',
  'annualLeaveDays',
  'compensation',
  'effectiveFrom',
  'reason',
  'event',
  'eventReason',
  'allowRetroactive',
  'preferredName',
  'fatherName',
  'middleName',
  'maritalStatus',
  'nationality',
  'personalEmail',
  'mobile',
  'employeeCategory',
  'legalEntity',
  'location',
  'payGroup',
  'probationEndDate',
  'confirmationDate',
  'originalHireDate',
  'position',
  'grade',
  'orgRole',
  'nationalIds',
];

const COMPENSATION_FIELDS = ['currency', 'baseSalary', 'fixedAllowances'];

function pick(source, fields) {
  return fields.reduce((acc, field) => {
    if (source[field] !== undefined) acc[field] = source[field];
    return acc;
  }, {});
}

function sanitizePayload(body) {
  const payload = pick(body || {}, WRITABLE_FIELDS);

  if (payload.compensation !== undefined) {
    if (payload.compensation === null || typeof payload.compensation !== 'object') {
      throw ApiError.badRequest('Compensation must be an object');
    }
    payload.compensation = pick(payload.compensation, COMPENSATION_FIELDS);

    if (payload.compensation.fixedAllowances !== undefined) {
      if (!Array.isArray(payload.compensation.fixedAllowances)) {
        throw ApiError.badRequest('Fixed allowances must be a list');
      }
      payload.compensation.fixedAllowances = payload.compensation.fixedAllowances.map((item) =>
        pick(item || {}, ['label', 'amount'])
      );
    }
  }

  // An empty string from a <select> means "not set", not an invalid enum value.
  if (payload.reportsTo === '') payload.reportsTo = null;
  if (payload.position === '') payload.position = null;
  if (payload.allowRetroactive !== undefined) payload.allowRetroactive = Boolean(payload.allowRetroactive);

  return payload;
}

function presentPerson(person) {
  if (!person) return null;
  const json = person.toJSON ? person.toJSON() : person;
  json.id = String(json.id || json._id);
  return json;
}

function presentEmployment(employment) {
  if (!employment) return null;
  const json = employment.toJSON ? employment.toJSON() : employment;
  json.id = String(json.id || json._id);
  if (json.person) json.person = String(json.person._id || json.person);
  if (json.employee) json.employee = String(json.employee._id || json.employee);
  return json;
}

function present(employee, showCompensation, extras) {
  const json = employee.toJSON();
  if (!showCompensation) {
    json.compensation = { restricted: true };
    delete json.totalAllowances;
    delete json.grossSalary;
  }
  json.id = String(json.id || json._id);
  if (extras) Object.assign(json, extras);
  return json;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function assertReportsToIsValid(payload, employeeId) {
  if (!payload.reportsTo) return;

  if (!mongoose.isValidObjectId(payload.reportsTo)) {
    throw ApiError.badRequest('Manager reference is not a valid employee id');
  }
  if (employeeId && String(payload.reportsTo) === String(employeeId)) {
    throw ApiError.badRequest('An employee cannot report to themselves');
  }
  const manager = await Employee.findById(payload.reportsTo).select('_id');
  if (!manager) throw ApiError.badRequest('The selected manager does not exist');
}

async function attachWorkforce(employee, showCompensation) {
  await workforce.ensureWorkforce(employee);
  const [history, pending, person, employment] = await Promise.all([
    workforce.loadHistory(employee._id),
    Assignment.findOne({ employee: employee._id, status: 'pending' }),
    employee.person ? Person.findById(employee.person) : null,
    employee.employment ? Employment.findById(employee.employment) : null,
  ]);

  await Assignment.populate(history, {
    path: 'reportsTo',
    select: 'firstName lastName employeeCode designation',
  });
  if (pending) {
    await pending.populate('reportsTo', 'firstName lastName employeeCode designation');
  }

  const current = history.filter((row) => row.status === 'active')[0] || null;

  return present(employee, showCompensation, {
    person: presentPerson(person),
    employment: presentEmployment(employment),
    currentAssignment: workforce.presentAssignment(current, showCompensation),
    pendingAssignment: workforce.presentAssignment(pending, showCompensation),
    history: history.map((row) => workforce.presentAssignment(row, showCompensation)),
  });
}

/** GET /api/employees/meta */
const meta = asyncHandler(async (_req, res) => {
  const hr = metaPayload();
  res.json({
    success: true,
    meta: Object.assign({}, hr, {
      assignmentStatuses: Object.keys(ASSIGNMENT_STATUS_LABELS).map((value) => ({
        value,
        label: ASSIGNMENT_STATUS_LABELS[value],
      })),
      checkerFields: ['designation', 'department', 'team', 'position', 'grade', 'compensation', 'shiftType', 'restDays', 'reportsTo'],
      personnelEventLabels: PERSONNEL_EVENT_LABELS,
    }),
  });
});

/** GET /api/employees/changes — pending assignment queue / own requests. */
const listChanges = asyncHandler(async (req, res) => {
  const { scope } = req.query;
  const filter = { status: 'pending' };
  const queue = await approvalScope(req.user);

  if (scope === 'queue') {
    if (!queue) {
      return res.json({ success: true, total: 0, pendingCount: 0, canApprove: false, assignments: [] });
    }
    Object.assign(filter, queue);
  } else if (scope === 'mine') {
    const viewer = await resolveViewerEmployee(req.user);
    if (!viewer) throw ApiError.badRequest('Your login is not linked to an employee record yet. Ask HR to add you to Core HR.');
    filter.employee = viewer._id;
  } else if (req.user.role !== ROLES.HR_ADMIN) {
    const viewer = await resolveViewerEmployee(req.user);
    const allowed = [viewer && viewer._id].filter(Boolean);
    if (queue && queue.employee && queue.employee.$in) {
      queue.employee.$in.forEach((id) => allowed.push(id));
    }
    filter.employee = { $in: allowed };
  }

  const assignments = await Assignment.find(filter)
    .populate('employee', 'firstName lastName employeeCode designation department team')
    .populate('reportsTo', 'firstName lastName employeeCode')
    .sort({ createdAt: 1 })
    .limit(200);

  const pendingCount = queue ? await Assignment.countDocuments(Object.assign({}, queue, { status: 'pending' })) : 0;

  res.json({
    success: true,
    total: assignments.length,
    pendingCount,
    canApprove: Boolean(queue),
    assignments: assignments.map((row) => {
      const presented = workforce.presentAssignment(row, true);
      const employee = row.employee && row.employee.toJSON ? row.employee.toJSON() : row.employee;
      const requesterId = row.requestedBy ? String(row.requestedBy._id || row.requestedBy) : '';
      presented.canDecide = Boolean(queue) && requesterId !== String(req.user._id);
      presented.employeeSnapshot = employee
        ? {
            id: String(employee.id || employee._id),
            fullName: `${employee.firstName} ${employee.lastName}`.trim(),
            employeeCode: employee.employeeCode,
            designation: employee.designation,
            department: employee.department,
            team: employee.team,
          }
        : null;
      return presented;
    }),
  });
});

/** GET /api/employees */
const list = asyncHandler(async (req, res) => {
  const { q, department, employmentStatus, shiftType } = req.query;

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));

  const filter = {};
  if (department) filter.department = department;
  if (employmentStatus) filter.employmentStatus = employmentStatus;
  if (shiftType) filter.shiftType = shiftType;

  if (q && String(q).trim()) {
    const term = new RegExp(escapeRegex(String(q).trim()), 'i');
    filter.$or = [
      { firstName: term },
      { lastName: term },
      { email: term },
      { employeeCode: term },
      { designation: term },
      { team: term },
    ];
  }

  const [employees, total, viewerEmployee] = await Promise.all([
    Employee.find(filter)
      .populate('reportsTo', 'firstName lastName employeeCode designation')
      .sort({ firstName: 1, lastName: 1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Employee.countDocuments(filter),
    resolveViewerEmployee(req.user),
  ]);

  const ids = employees.map((employee) => employee._id);
  const pending = await Assignment.find({ employee: { $in: ids }, status: 'pending' }).select('employee');
  const pendingByEmployee = new Set(pending.map((row) => String(row.employee)));

  res.json({
    success: true,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit) || 1,
    employees: employees.map((employee) => {
      const showPay = canViewSensitive(req.user, viewerEmployee, employee);
      return present(employee, showPay, {
        hasPendingAssignment: pendingByEmployee.has(String(employee._id)),
      });
    }),
  });
});

/** GET /api/employees/:id */
const getOne = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Employee not found');

  const employee = await Employee.findById(req.params.id).populate(
    'reportsTo',
    'firstName lastName employeeCode designation department'
  );
  if (!employee) throw ApiError.notFound('Employee not found');

  const viewerEmployee = await resolveViewerEmployee(req.user);
  const showPay = canViewSensitive(req.user, viewerEmployee, employee);
  const presented = await attachWorkforce(employee, showPay);
  presented.permissions = {
    canEditIdentity: req.user.role === ROLES.HR_ADMIN,
    canRequestAssignment: isSelf(req.user, viewerEmployee, employee) || req.user.role === ROLES.HR_ADMIN,
    canDecide: await canDecideFor(req.user, viewerEmployee, employee),
    canEditLowRisk: isSelf(req.user, viewerEmployee, employee) || req.user.role === ROLES.HR_ADMIN,
    canViewPayment: req.user.role === ROLES.HR_ADMIN || isSelf(req.user, viewerEmployee, employee),
    canSeparate: req.user.role === ROLES.HR_ADMIN,
    canRehire: req.user.role === ROLES.HR_ADMIN && ['resigned', 'terminated'].indexOf(employee.employmentStatus) !== -1,
  };

  const extras = await profile.loadProfileExtras(employee, {
    revealPayment: presented.permissions.canViewPayment,
  });
  Object.assign(presented, extras);

  if (req.query.asOf) {
    const historical = await workforce.assignmentAsOf(employee._id, req.query.asOf);
    presented.asOfAssignment = workforce.presentAssignment(historical, showPay);
    presented.asOf = req.query.asOf;
  }

  res.json({ success: true, employee: presented });
});

/** POST /api/employees */
const create = asyncHandler(async (req, res) => {
  const payload = sanitizePayload(req.body);
  await assertReportsToIsValid(payload, null);

  const employee = await workforce.createHire(payload, req.user._id);
  await employee.populate('reportsTo', 'firstName lastName employeeCode designation');
  await audit.record(req, {
    action: 'hire',
    employee: employee._id,
    objectType: 'Employee',
    objectId: String(employee._id),
    summary: `Hired ${employee.fullName}`,
  });

  const presented = await attachWorkforce(employee, true);
  res.status(201).json({ success: true, employee: presented });
});

/** PATCH /api/employees/:id */
const update = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Employee not found');

  const employee = await Employee.findById(req.params.id);
  if (!employee) throw ApiError.notFound('Employee not found');

  const viewer = await resolveViewerEmployee(req.user);
  const self = isSelf(req.user, viewer, employee);
  const isHr = req.user.role === ROLES.HR_ADMIN;

  if (!isHr && !self) {
    throw ApiError.forbidden('You can only request changes to your own assignment');
  }

  let payload = sanitizePayload(req.body);
  await assertReportsToIsValid(payload, employee._id);

  // Employees may request a new assignment row. Identity and contract stay HR-only.
  if (!isHr) {
    payload = pick(payload, ASSIGNMENT_FIELDS.concat(LOW_SELF_FIELDS).concat(['effectiveFrom', 'reason', 'event', 'eventReason']));
    if (!Object.keys(payload).filter((key) => key !== 'effectiveFrom' && key !== 'reason' && key !== 'event' && key !== 'eventReason').length) {
      throw ApiError.forbidden('Only HR can change identity or employment contract fields');
    }
  }

  const result = await workforce.applyEmployeePatch(employee, payload, req.user);
  await result.employee.populate('reportsTo', 'firstName lastName employeeCode designation');
  await audit.record(req, {
    action: result.pendingAssignment ? 'assignment_request' : 'employee_update',
    employee: employee._id,
    objectType: 'Employee',
    objectId: String(employee._id),
    summary: result.pendingAssignment
      ? `Requested ${(result.pendingAssignment.changedFields || []).join(', ')}`
      : `Updated ${result.employee.fullName}`,
  });

  const showPay = canViewSensitive(req.user, viewer, result.employee);
  const presented = await attachWorkforce(result.employee, showPay);
  presented.permissions = {
    canEditIdentity: isHr,
    canRequestAssignment: true,
    canDecide: await canDecideFor(req.user, viewer, result.employee),
  };

  res.json({
    success: true,
    pending: Boolean(result.pendingAssignment),
    scheduled: Boolean(result.scheduledAssignment),
    employee: presented,
  });
});

/** PATCH /api/employees/assignments/:id/status */
const decideAssignment = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Assignment not found');

  const assignment = await Assignment.findById(req.params.id);
  if (!assignment) throw ApiError.notFound('Assignment not found');

  const employee = await Employee.findById(assignment.employee);
  if (!employee) throw ApiError.notFound('Employee not found');

  const viewer = await resolveViewerEmployee(req.user);
  if (!(await canDecideFor(req.user, viewer, employee, 'assignment'))) {
    throw ApiError.forbidden('You cannot approve this assignment change');
  }
  if (assignment.requestedBy && String(assignment.requestedBy) === String(req.user._id)) {
    throw ApiError.forbidden('You cannot approve a change you requested');
  }

  const status = req.body && req.body.status;
  await workforce.decideAssignment(assignment, req.user, status, req.body && req.body.decisionNote);

  webhooks.emitApprovalCompleted({
    kind: 'assignment',
    decision: status,
    objectId: assignment._id,
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
  });

  await employee.populate('reportsTo', 'firstName lastName employeeCode designation');
  const presented = await attachWorkforce(employee, canViewSensitive(req.user, viewer, employee));

  res.json({ success: true, employee: presented });
});

/** DELETE /api/employees/:id */
const remove = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Employee not found');

  const employee = await Employee.findById(req.params.id);
  if (!employee) throw ApiError.notFound('Employee not found');

  await Employee.updateMany({ reportsTo: employee._id }, { $set: { reportsTo: null } });
  await Assignment.deleteMany({ employee: employee._id });
  if (employee.employment) await Employment.deleteOne({ _id: employee.employment });
  if (employee.person) await Person.deleteOne({ _id: employee.person });
  await employee.deleteOne();

  res.json({ success: true, message: `${employee.fullName} has been removed` });
});

async function loadScopedEmployee(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Employee not found');
  const employee = await Employee.findById(req.params.id);
  if (!employee) throw ApiError.notFound('Employee not found');
  await workforce.ensureWorkforce(employee);
  return employee;
}

const separate = asyncHandler(async (req, res) => {
  const employee = await loadScopedEmployee(req);
  const updated = await workforce.separateEmployee(employee, req.body || {}, req.user);
  await audit.record(req, {
    action: 'separation',
    employee: employee._id,
    objectType: 'Employment',
    summary: `Separated ${updated.fullName}`,
    newValue: { type: req.body && req.body.separationType, lastWorkingDay: req.body && req.body.lastWorkingDay },
  });
  const presented = await attachWorkforce(updated, true);
  res.json({ success: true, employee: presented });
});

const rehire = asyncHandler(async (req, res) => {
  const employee = await loadScopedEmployee(req);
  const updated = await workforce.rehireEmployee(employee, sanitizePayload(req.body), req.user);
  await audit.record(req, { action: 'rehire', employee: employee._id, objectType: 'Employment', summary: `Rehired ${updated.fullName}` });
  const presented = await attachWorkforce(updated, true);
  res.json({ success: true, employee: presented });
});

const saveFamily = asyncHandler(async (req, res) => {
  const employee = await loadScopedEmployee(req);
  const viewer = await resolveViewerEmployee(req.user);
  if (req.user.role !== ROLES.HR_ADMIN && !isSelf(req.user, viewer, employee)) {
    throw ApiError.forbidden('You cannot change this family record');
  }
  const row = await profile.saveFamily(employee.person, employee._id, req.body || {});
  await audit.record(req, { action: 'family_update', employee: employee._id, objectType: 'FamilyMember', objectId: row.id, summary: row.name });
  res.json({ success: true, member: row });
});

const saveAddress = asyncHandler(async (req, res) => {
  const employee = await loadScopedEmployee(req);
  const viewer = await resolveViewerEmployee(req.user);
  if (req.user.role !== ROLES.HR_ADMIN && !isSelf(req.user, viewer, employee)) {
    throw ApiError.forbidden('You cannot change this address');
  }
  const row = await profile.saveAddress(employee.person, req.body || {});
  res.json({ success: true, address: row });
});

const saveQualification = asyncHandler(async (req, res) => {
  const employee = await loadScopedEmployee(req);
  const viewer = await resolveViewerEmployee(req.user);
  if (req.user.role !== ROLES.HR_ADMIN && !isSelf(req.user, viewer, employee)) {
    throw ApiError.forbidden('You cannot change this qualification');
  }
  const row = await profile.saveQualification(employee.person, employee._id, req.body || {});
  res.json({ success: true, qualification: row });
});

const saveDocument = asyncHandler(async (req, res) => {
  const employee = await loadScopedEmployee(req);
  if (req.user.role !== ROLES.HR_ADMIN) {
    const viewer = await resolveViewerEmployee(req.user);
    if (!isSelf(req.user, viewer, employee)) throw ApiError.forbidden('You cannot add documents on this file');
  }
  const row = await profile.saveDocument(employee._id, employee.person, req.user._id, req.body || {});
  await audit.record(req, { action: 'document_upload', employee: employee._id, objectType: 'EmployeeDocument', objectId: row.id, summary: row.type });
  res.json({ success: true, document: row });
});

const saveBank = asyncHandler(async (req, res) => {
  const employee = await loadScopedEmployee(req);
  const viewer = await resolveViewerEmployee(req.user);
  if (req.user.role !== ROLES.HR_ADMIN && !isSelf(req.user, viewer, employee)) {
    throw ApiError.forbidden('You cannot change this payment instruction');
  }
  const result = await profile.saveBank(employee, req.user, req.body || {});
  await audit.record(req, { action: 'bank_request', employee: employee._id, objectType: 'BankAccount', summary: 'Bank details submitted for approval' });
  res.json({ success: true, pending: true, bankAccount: result.pending });
});

const decideBank = asyncHandler(async (req, res) => {
  const row = await BankAccount.findById(req.params.bankId);
  if (!row) throw ApiError.notFound('Bank instruction not found');
  const employee = await Employee.findById(row.employee);
  const viewer = await resolveViewerEmployee(req.user);
  if (!(await canDecideFor(req.user, viewer, employee, 'bank')) && req.user.role !== ROLES.HR_ADMIN) {
    throw ApiError.forbidden('You cannot approve this payment change');
  }
  if (row.requestedBy && String(row.requestedBy) === String(req.user._id) && req.user.role !== ROLES.HR_ADMIN) {
    throw ApiError.forbidden('You cannot approve a change you requested');
  }
  await profile.decideBank(row, req.user, req.body && req.body.status, req.body && req.body.decisionNote);
  await audit.record(req, { action: 'bank_decision', employee: employee._id, objectType: 'BankAccount', objectId: String(row._id), summary: req.body && req.body.status });
  webhooks.emitApprovalCompleted({
    kind: 'bank',
    decision: req.body && req.body.status,
    objectId: row._id,
    employeeCode: employee && employee.employeeCode,
    fullName: employee && employee.fullName,
  });
  res.json({ success: true, bankAccount: profile.presentBank(row, true) });
});

const saveStatutory = asyncHandler(async (req, res) => {
  const employee = await loadScopedEmployee(req);
  if (req.user.role !== ROLES.HR_ADMIN) throw ApiError.forbidden('Only HR can maintain statutory coverage');
  const row = await profile.saveStatutory(employee, req.user, req.body || {});
  res.json({ success: true, pending: true, enrollment: row });
});

const decideStatutory = asyncHandler(async (req, res) => {
  const row = await StatutoryEnrollment.findById(req.params.statId);
  if (!row) throw ApiError.notFound('Enrolment not found');
  const viewer = await resolveViewerEmployee(req.user);
  const employee = await Employee.findById(row.employee);
  if (!(await canDecideFor(req.user, viewer, employee || { _id: row.employee, email: '' }, 'statutory'))) {
    throw ApiError.forbidden('You cannot approve this statutory change');
  }
  await profile.decideStatutory(row, req.user, req.body && req.body.status, req.body && req.body.decisionNote);
  webhooks.emitApprovalCompleted({
    kind: 'statutory',
    decision: req.body && req.body.status,
    objectId: row._id,
    employeeCode: employee && employee.employeeCode,
    fullName: employee && employee.fullName,
  });
  res.json({ success: true, enrollment: profile.presentStatutory(row, true) });
});

const alerts = asyncHandler(async (req, res) => {
  const ids = await visibleEmployeeIds(req.user);
  const items = await profile.collectAlerts(ids);
  res.json({ success: true, total: items.length, alerts: items });
});

const reports = asyncHandler(async (req, res) => {
  const EmployeeModel = Employee;
  const [byStatus, byDepartment, teams, pending] = await Promise.all([
    EmployeeModel.aggregate([{ $group: { _id: '$employmentStatus', count: { $sum: 1 } } }]),
    EmployeeModel.aggregate([{ $group: { _id: '$department', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    org.headcountByTeam(),
    Assignment.countDocuments({ status: 'pending' }),
  ]);
  res.json({
    success: true,
    report: {
      byStatus: byStatus.map((row) => ({ status: row._id, count: row.count })),
      byDepartment: byDepartment.map((row) => ({ department: row._id, count: row.count })),
      teams,
      pendingChanges: pending,
    },
  });
});

module.exports = {
  meta,
  list,
  listChanges,
  getOne,
  create,
  update,
  decideAssignment,
  remove,
  separate,
  rehire,
  saveFamily,
  saveAddress,
  saveQualification,
  saveDocument,
  saveBank,
  decideBank,
  saveStatutory,
  decideStatutory,
  alerts,
  reports,
};
