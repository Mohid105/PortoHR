'use strict';

const mongoose = require('mongoose');
const Asset = require('../models/Asset');
const AssetAssignment = require('../models/AssetAssignment');
const TransportRoute = require('../models/TransportRoute');
const AccommodationAllocation = require('../models/AccommodationAllocation');
const MaintenanceLog = require('../models/MaintenanceLog');
const Employee = require('../models/Employee');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/roles');
const { metaPayload } = require('../config/assets');
const { resolveViewerEmployee } = require('../services/employeeAccess');
const audit = require('../services/audit.service');
const assets = require('../services/assets.service');

function requireId(id, label) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound(`${label} not found`);
}

function requireHr(user) {
  if (user.role !== ROLES.HR_ADMIN) throw ApiError.forbidden('Only HR and facilities can do that');
}

async function loadEmployee(id) {
  requireId(id, 'Employee');
  const employee = await Employee.findById(id);
  if (!employee) throw ApiError.notFound('Employee not found');
  return employee;
}

const meta = asyncHandler(async (_req, res) => {
  res.json({ success: true, meta: metaPayload() });
});

const people = asyncHandler(async (req, res) => {
  requireHr(req.user);
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

const listCatalogue = asyncHandler(async (req, res) => {
  const rows = await assets.listAssets(req.user);
  res.json({ success: true, assets: rows });
});

const createAsset = asyncHandler(async (req, res) => {
  requireHr(req.user);
  const presented = await assets.createAsset(req.body || {}, req.user);
  await audit.record(req, { action: 'asset_create', objectType: 'Asset', objectId: presented.id, summary: presented.code });
  res.status(201).json({ success: true, message: 'Asset added to the register', asset: presented });
});

const retireAsset = asyncHandler(async (req, res) => {
  requireHr(req.user);
  requireId(req.params.id, 'Asset');
  const asset = await Asset.findById(req.params.id);
  if (!asset) throw ApiError.notFound('Asset not found');
  const presented = await assets.retireAsset(asset);
  await audit.record(req, { action: 'asset_retire', objectType: 'Asset', objectId: presented.id, summary: presented.code });
  res.json({ success: true, message: 'Asset retired', asset: presented });
});

const listAssignments = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  const rows = await assets.listAssignments(req.user, viewer, req.query || {});
  res.json({ success: true, assignments: rows });
});

const getAssignment = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  requireId(req.params.id, 'Assignment');
  const { presented } = await assets.getAssignment(req.user, viewer, req.params.id);
  res.json({ success: true, assignment: presented });
});

const createAssignment = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  const body = req.body || {};
  requireId(body.asset, 'Asset');
  const asset = await Asset.findById(body.asset);
  if (!asset) throw ApiError.notFound('Asset not found');

  if (req.user.role === ROLES.HR_ADMIN && body.issue) {
    const employee = await loadEmployee(body.employee);
    const presented = await assets.issueDirect(asset, employee, req.user, body);
    await audit.record(req, {
      action: 'asset_issue',
      objectType: 'AssetAssignment',
      objectId: presented.id,
      employee: employee._id,
      summary: presented.asset && presented.asset.code,
    });
    return res.status(201).json({ success: true, message: 'Asset issued', assignment: presented });
  }

  const employee = req.user.role === ROLES.HR_ADMIN && body.employee ? await loadEmployee(body.employee) : viewer;
  const presented = await assets.requestAsset(asset, employee, req.user, body);
  await audit.record(req, {
    action: 'asset_request',
    objectType: 'AssetAssignment',
    objectId: presented.id,
    employee: employee && employee._id,
    summary: presented.asset && presented.asset.code,
  });
  res.status(201).json({ success: true, message: 'Request submitted', assignment: presented });
});

const issueAssignment = asyncHandler(async (req, res) => {
  requireHr(req.user);
  const viewer = await resolveViewerEmployee(req.user);
  requireId(req.params.id, 'Assignment');
  const { row, asset } = await assets.getAssignment(req.user, viewer, req.params.id);
  const employee = await Employee.findById(row.employee);
  const presented = await assets.issueAssignment(row, asset, employee, req.user, req.body || {});
  await audit.record(req, { action: 'asset_issue', objectType: 'AssetAssignment', objectId: presented.id, summary: presented.asset && presented.asset.code });
  res.json({ success: true, message: 'Asset issued', assignment: presented });
});

const acknowledgeAssignment = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  requireId(req.params.id, 'Assignment');
  const { row, asset, presented: current } = await assets.getAssignment(req.user, viewer, req.params.id);
  if (current.access !== 'party' && req.user.role !== ROLES.HR_ADMIN) throw ApiError.notFound('Assignment not found');
  if (req.user.role !== ROLES.HR_ADMIN && current.access !== 'party') throw ApiError.notFound('Assignment not found');
  const presented = await assets.acknowledgeAssignment(row, asset, req.user);
  await audit.record(req, { action: 'asset_ack', objectType: 'AssetAssignment', objectId: presented.id, summary: presented.asset && presented.asset.code });
  res.json({ success: true, message: 'Custody acknowledged', assignment: presented });
});

const returnAssignment = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  requireId(req.params.id, 'Assignment');
  const { row, asset, presented: current } = await assets.getAssignment(req.user, viewer, req.params.id);
  if (req.user.role === ROLES.HR_ADMIN && (req.body || {}).complete) {
    const presented = await assets.completeReturn(row, asset, req.user, req.body || {});
    await audit.record(req, { action: 'asset_return', objectType: 'AssetAssignment', objectId: presented.id, summary: presented.asset && presented.asset.code });
    return res.json({ success: true, message: 'Asset returned to the register', assignment: presented });
  }
  if (current.access !== 'party' && req.user.role !== ROLES.HR_ADMIN) throw ApiError.notFound('Assignment not found');
  const presented = await assets.requestReturn(row, asset);
  await audit.record(req, { action: 'asset_return_request', objectType: 'AssetAssignment', objectId: presented.id, summary: presented.asset && presented.asset.code });
  res.json({ success: true, message: 'Return requested', assignment: presented });
});

const lostAssignment = asyncHandler(async (req, res) => {
  requireHr(req.user);
  const viewer = await resolveViewerEmployee(req.user);
  requireId(req.params.id, 'Assignment');
  const { row, asset } = await assets.getAssignment(req.user, viewer, req.params.id);
  const presented = await assets.markLost(row, asset, req.user, req.body || {});
  await audit.record(req, { action: 'asset_lost', objectType: 'AssetAssignment', objectId: presented.id, summary: presented.asset && presented.asset.code });
  res.json({ success: true, message: 'Asset written off as lost', assignment: presented });
});

const scan = asyncHandler(async (req, res) => {
  requireHr(req.user);
  const body = req.body || {};
  const employee = body.employee ? await loadEmployee(body.employee) : null;
  const result = await assets.scanBarcode(body.barcode, employee, req.user);
  await audit.record(req, {
    action: result.action === 'returned' ? 'asset_return' : 'asset_issue',
    objectType: 'AssetAssignment',
    objectId: result.assignment && result.assignment.id,
    summary: body.barcode,
  });
  res.json({
    success: true,
    message: result.action === 'returned' ? 'Checked in' : 'Checked out',
    ...result,
  });
});

const recovery = asyncHandler(async (req, res) => {
  requireHr(req.user);
  const checklist = await assets.recoveryChecklist();
  res.json({ success: true, checklist });
});

const financeExport = asyncHandler(async (req, res) => {
  requireHr(req.user);
  const payload = await assets.financeExport();
  res.json({ success: true, ...payload });
});

const listRoutes = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  res.json({ success: true, routes: await assets.listRoutes(req.user, viewer) });
});

const createRoute = asyncHandler(async (req, res) => {
  requireHr(req.user);
  const presented = await assets.createRoute(req.body || {});
  res.status(201).json({ success: true, message: 'Route added', route: presented });
});

const allocateRoute = asyncHandler(async (req, res) => {
  requireId(req.params.id, 'Route');
  const route = await TransportRoute.findById(req.params.id);
  if (!route) throw ApiError.notFound('Route not found');
  const viewer = await resolveViewerEmployee(req.user);
  const body = req.body || {};
  if (req.user.role === ROLES.HR_ADMIN && body.employee) {
    const employee = await loadEmployee(body.employee);
    const presented = await assets.allocateSeat(route, employee, req.user, body, false);
    return res.status(201).json({ success: true, message: 'Seat allocated', route: presented });
  }
  if (!viewer) throw ApiError.badRequest('An employee record is required to request a seat');
  const presented = await assets.allocateSeat(route, viewer, req.user, body, true);
  res.status(201).json({ success: true, message: 'Seat requested', route: presented });
});

const cancelRouteSeat = asyncHandler(async (req, res) => {
  requireId(req.params.id, 'Route');
  requireId(req.params.slotId, 'Allocation');
  const route = await TransportRoute.findById(req.params.id);
  if (!route) throw ApiError.notFound('Route not found');
  const viewer = await resolveViewerEmployee(req.user);
  const presented = await assets.cancelSeat(route, req.params.slotId, req.user, viewer);
  res.json({ success: true, message: 'Seat cancelled', route: presented });
});

const listRooms = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  res.json({ success: true, rooms: await assets.listAccommodation(req.user, viewer) });
});

const allocateRoom = asyncHandler(async (req, res) => {
  requireHr(req.user);
  const employee = await loadEmployee((req.body || {}).employee);
  const presented = await assets.allocateRoom(employee, req.body || {});
  res.status(201).json({ success: true, message: 'Room allocated', room: presented });
});

const vacateRoom = asyncHandler(async (req, res) => {
  requireHr(req.user);
  requireId(req.params.id, 'Allocation');
  const row = await AccommodationAllocation.findById(req.params.id);
  if (!row) throw ApiError.notFound('Allocation not found');
  const presented = await assets.vacateRoom(row, req.body || {});
  res.json({ success: true, message: 'Room vacated', room: presented });
});

const listMaintenance = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  res.json({ success: true, jobs: await assets.listMaintenance(req.user, viewer) });
});

const createMaintenance = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  const body = req.body || {};
  requireId(body.asset, 'Asset');
  const asset = await Asset.findById(body.asset);
  if (!asset) throw ApiError.notFound('Asset not found');
  if (req.user.role !== ROLES.HR_ADMIN) {
    const held = await AssetAssignment.findOne({
      asset: asset._id,
      employee: viewer && viewer._id,
      status: { $in: ['issued', 'acknowledged', 'recovery'] },
    });
    if (!held) throw ApiError.forbidden('You can only raise maintenance on kit in your custody');
  }
  const presented = await assets.openMaintenance(asset, viewer, req.user, body);
  await audit.record(req, { action: 'asset_maintenance', objectType: 'MaintenanceLog', objectId: presented.id, summary: presented.summary });
  res.status(201).json({ success: true, message: 'Maintenance logged', job: presented });
});

const scheduleJob = asyncHandler(async (req, res) => {
  requireHr(req.user);
  requireId(req.params.id, 'Job');
  const row = await MaintenanceLog.findById(req.params.id);
  if (!row) throw ApiError.notFound('Job not found');
  const asset = await Asset.findById(row.asset);
  const presented = await assets.scheduleMaintenance(row, asset, req.body || {});
  res.json({ success: true, message: 'Job scheduled', job: presented });
});

const completeJob = asyncHandler(async (req, res) => {
  requireHr(req.user);
  requireId(req.params.id, 'Job');
  const row = await MaintenanceLog.findById(req.params.id);
  if (!row) throw ApiError.notFound('Job not found');
  const asset = await Asset.findById(row.asset);
  const presented = await assets.completeMaintenance(row, asset, req.body || {});
  res.json({ success: true, message: 'Job closed', job: presented });
});

module.exports = {
  meta,
  people,
  listCatalogue,
  createAsset,
  retireAsset,
  listAssignments,
  getAssignment,
  createAssignment,
  issueAssignment,
  acknowledgeAssignment,
  returnAssignment,
  lostAssignment,
  scan,
  recovery,
  financeExport,
  listRoutes,
  createRoute,
  allocateRoute,
  cancelRouteSeat,
  listRooms,
  allocateRoom,
  vacateRoom,
  listMaintenance,
  createMaintenance,
  scheduleJob,
  completeJob,
};
