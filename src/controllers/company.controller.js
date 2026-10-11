'use strict';

const mongoose = require('mongoose');
const company = require('../services/company.service');
const Employee = require('../models/Employee');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../services/audit.service');
const ApiError = require('../utils/ApiError');

function requireId(id, label) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound(`${label} not found`);
}

const announcements = asyncHandler(async (req, res) => {
  const includeExpired = req.user.role === 'hr_admin' && req.query.all === '1';
  res.json({ success: true, announcements: await company.listAnnouncements({ includeExpired }) });
});

const createAnnouncement = asyncHandler(async (req, res) => {
  const row = await company.createAnnouncement(req.body || {}, req.user);
  await audit.record(req, { action: 'announcement_post', objectType: 'Announcement', objectId: row.id, summary: row.title });
  res.status(201).json({ success: true, announcement: row });
});

const updateAnnouncement = asyncHandler(async (req, res) => {
  requireId(req.params.id, 'Announcement');
  const row = await company.updateAnnouncement(req.params.id, req.body || {});
  await audit.record(req, { action: 'announcement_edit', objectType: 'Announcement', objectId: row.id, summary: row.title });
  res.json({ success: true, announcement: row });
});

const deleteAnnouncement = asyncHandler(async (req, res) => {
  requireId(req.params.id, 'Announcement');
  await company.deleteAnnouncement(req.params.id);
  await audit.record(req, { action: 'announcement_delete', objectType: 'Announcement', objectId: req.params.id, summary: 'Removed announcement' });
  res.json({ success: true });
});

const pulse = asyncHandler(async (req, res) => {
  const { visibleEmployeeIds } = require('../services/employeeAccess');
  const ids = await visibleEmployeeIds(req.user);
  res.json({ success: true, ...(await company.pulse(req.user, ids)) });
});

const moments = asyncHandler(async (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
  res.json({ success: true, ...(await company.moments(days)) });
});

const orgChart = asyncHandler(async (_req, res) => {
  res.json({ success: true, ...(await company.orgChart()) });
});

const offboarding = asyncHandler(async (_req, res) => {
  res.json({ success: true, cases: await company.listOffboarding() });
});

const startOffboarding = asyncHandler(async (req, res) => {
  requireId(req.params.employeeId, 'Employee');
  const employee = await Employee.findById(req.params.employeeId);
  if (!employee) throw ApiError.notFound('Employee not found');
  const total = await company.startOffboarding(employee);
  await audit.record(req, { action: 'offboarding_start', employee: employee._id, objectType: 'Employee', summary: `Offboarding checklist for ${employee.fullName}` });
  res.status(201).json({ success: true, total });
});

const setExitTask = asyncHandler(async (req, res) => {
  requireId(req.params.id, 'Checklist item');
  const result = await company.setExitTask(req.params.id, req.body || {}, req.user);
  await audit.record(req, {
    action: 'offboarding_task',
    employee: result.task.employee,
    objectType: 'ExitTask',
    objectId: result.task.id,
    summary: `${result.task.title} → ${result.task.status}`,
  });
  res.json({ success: true, ...result });
});

module.exports = {
  pulse,
  announcements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  moments,
  orgChart,
  offboarding,
  startOffboarding,
  setExitTask,
};
