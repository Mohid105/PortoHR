'use strict';

const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../services/audit.service');
const personnelFile = require('../services/personnelFile.service');
const { accessFor } = require('../services/reports/employeeReport.service');
const { visibleEmployeeIds, resolveViewerEmployee } = require('../services/employeeAccess');

async function load(req, { hrOnly } = {}) {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Employee not found');
  const employee = await Employee.findById(req.params.id);
  if (!employee) throw ApiError.notFound('Employee not found');
  const [scope, viewer] = await Promise.all([visibleEmployeeIds(req.user), resolveViewerEmployee(req.user)]);
  const inLine = scope !== null && scope.some((id) => String(id) === String(employee._id));
  const access = accessFor(req.user, viewer, employee, inLine);
  if (!access.isHr && !access.isSelf && !access.isManager) throw ApiError.forbidden('You cannot view this personnel file');
  if (hrOnly && !access.isHr) throw ApiError.forbidden('Only HR can change the personnel file');
  return { employee, access };
}

const get = asyncHandler(async (req, res) => {
  const { employee, access } = await load(req);
  res.json({ success: true, file: await personnelFile.build(employee, access, req.query.year) });
});

const respond = async (req, res, employee, access, status = 200) => {
  res.status(status).json({ success: true, file: await personnelFile.build(employee, access, req.query.year) });
};

const saveDetails = asyncHandler(async (req, res) => {
  const { employee, access } = await load(req, { hrOnly: true });
  await personnelFile.saveDetails(employee, req.body || {});
  await audit.record(req, { action: 'personnel_file_update', employee: employee._id, objectType: 'PersonnelFile', summary: `Updated personnel file details for ${employee.fullName}` });
  await respond(req, res, employee, access);
});

const addEntry = asyncHandler(async (req, res) => {
  const { employee, access } = await load(req, { hrOnly: true });
  await personnelFile.addEntry(employee, req.params.list, req.body);
  await audit.record(req, { action: 'personnel_file_entry', employee: employee._id, objectType: 'PersonnelFile', summary: `Added a ${req.params.list} entry for ${employee.fullName}` });
  await respond(req, res, employee, access, 201);
});

const removeEntry = asyncHandler(async (req, res) => {
  const { employee, access } = await load(req, { hrOnly: true });
  await personnelFile.removeEntry(employee, req.params.list, req.params.entryId);
  await audit.record(req, { action: 'personnel_file_entry_removed', employee: employee._id, objectType: 'PersonnelFile', summary: `Removed a ${req.params.list} entry for ${employee.fullName}` });
  await respond(req, res, employee, access);
});

module.exports = { get, saveDetails, addEntry, removeEntry };
