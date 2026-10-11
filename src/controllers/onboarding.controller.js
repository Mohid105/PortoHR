'use strict';

const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const HireTask = require('../models/HireTask');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const onboarding = require('../services/onboarding.service');
const audit = require('../services/audit.service');
const { ROLES } = require('../config/roles');
const { visibleEmployeeIds } = require('../services/employeeAccess');

const nextCode = asyncHandler(async (_req, res) => {
  res.json({ success: true, employeeCode: await onboarding.suggestCode() });
});

/** POST /api/employees/onboard — one request carries the whole new-hire form. */
const onboard = asyncHandler(async (req, res) => {
  const result = await onboarding.onboard(req.body, req.user);
  const { employee } = result;
  await audit.record(req, {
    action: 'hire',
    employee: employee._id,
    objectType: 'Employee',
    objectId: String(employee._id),
    summary: `Hired ${employee.fullName} through the new-employee form`,
  });
  res.status(201).json({
    success: true,
    employee: { id: String(employee._id), employeeCode: employee.employeeCode, name: employee.fullName, designation: employee.designation, department: employee.department, dateOfJoining: employee.dateOfJoining },
    documents: result.documents,
    login: result.login,
    checklist: result.checklist,
    warnings: result.warnings,
  });
});

/** GET /api/employees/onboarding — open checklists; managers only see their own reports. */
const overview = asyncHandler(async (req, res) => {
  const scope = await visibleEmployeeIds(req.user);
  const rows = await onboarding.openChecklists(scope);
  res.json({ success: true, total: rows.length, starters: rows });
});

async function assertCanSee(user, employeeId) {
  if (!mongoose.isValidObjectId(employeeId)) throw ApiError.notFound('Employee not found');
  const scope = await visibleEmployeeIds(user);
  if (scope && !scope.some((id) => String(id) === String(employeeId))) throw ApiError.forbidden();
}

/** GET /api/employees/:id/onboarding */
const checklist = asyncHandler(async (req, res) => {
  await assertCanSee(req.user, req.params.id);
  res.json({ success: true, ...(await onboarding.checklistFor(req.params.id)) });
});

/** POST /api/employees/:id/onboarding — start (or top up) the checklist for an existing employee. */
const start = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.params.id);
  if (!employee) throw ApiError.notFound('Employee not found');
  await onboarding.startChecklist(employee, employee.dateOfJoining);
  res.status(201).json({ success: true, ...(await onboarding.checklistFor(employee._id)) });
});

/** PATCH /api/employees/onboarding/:taskId */
const updateTask = asyncHandler(async (req, res) => {
  const task = await HireTask.findById(req.params.taskId);
  if (!task) throw ApiError.notFound('Task not found');
  await assertCanSee(req.user, task.employee);
  if (req.user.role === ROLES.MANAGER && !['manager', 'employee'].includes(task.owner)) {
    throw ApiError.forbidden('This step belongs to HR, IT or Finance');
  }
  const saved = await onboarding.setTask(req.params.taskId, req.body || {}, req.user);
  res.json({ success: true, task: { id: String(saved._id), status: saved.status, doneAt: saved.doneAt, note: saved.note } });
});

module.exports = { nextCode, onboard, overview, checklist, start, updateTask };
