'use strict';

const Asset = require('../models/Asset');
const AssetAssignment = require('../models/AssetAssignment');
const TransportRoute = require('../models/TransportRoute');
const AccommodationAllocation = require('../models/AccommodationAllocation');
const MaintenanceLog = require('../models/MaintenanceLog');
const Employee = require('../models/Employee');
const ApiError = require('../utils/ApiError');
const { ROLES } = require('../config/roles');
const {
  ASSET_CATEGORIES,
  ASSET_CATEGORY_LABELS,
  ASSET_STATUS_LABELS,
  ASSIGNMENT_STATUS_LABELS,
  HOLDING_STATUSES,
  CUSTODY_STATUSES,
  SEPARATION_STATUSES,
  MAINTENANCE_STATUS_LABELS,
  MAINTENANCE_KIND_LABELS,
  ALLOCATION_STATUS_LABELS,
} = require('../config/assets');

function asId(value) {
  return String((value && (value._id || value.id || value)) || '');
}

function actorName(user) {
  if (!user) return '';
  return `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || 'User';
}

function snapshotOf(employee) {
  if (!employee) return { employeeCode: '', fullName: '', designation: '', department: '', positionTitle: '' };
  return {
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    designation: employee.designation,
    department: employee.department,
    positionTitle: employee.designation || '',
  };
}

function isoDay(value) {
  if (!value) return '';
  const day = new Date(value);
  const y = day.getFullYear();
  const m = String(day.getMonth() + 1).padStart(2, '0');
  const d = String(day.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function monthsBetween(from, to) {
  const start = new Date(from);
  const end = new Date(to);
  return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
}

function bookValue(asset, asOf = new Date()) {
  const purchase = Number(asset.purchaseValue) || 0;
  const residual = Number(asset.residualValue) || 0;
  const life = Number(asset.usefulLifeMonths) || 0;
  if (!asset.purchaseDate || !life || purchase <= residual) return Math.round(purchase);
  const used = Math.min(life, Math.max(0, monthsBetween(asset.purchaseDate, asOf)));
  const depreciable = purchase - residual;
  return Math.round(residual + depreciable * (1 - used / life));
}

async function nextCode(Model, prefix, startAt) {
  const rows = await Model.find({ code: new RegExp(`^${prefix}-`) }).select('code').lean();
  let max = startAt;
  rows.forEach((row) => {
    const n = Number(String(row.code).replace(/\D/g, ''));
    if (n > max) max = n;
  });
  return `${prefix}-${max + 1}`;
}

function isHolder(viewer, row) {
  return Boolean(viewer && String(row.employee) === String(viewer._id));
}

function accessFor(user, viewer, row) {
  if (user.role === ROLES.HR_ADMIN) return 'full';
  if (isHolder(viewer, row)) return 'party';
  return null;
}

function presentAsset(asset, options = {}) {
  if (!asset) return null;
  const json = {
    id: asId(asset),
    code: asset.code,
    name: asset.name,
    category: asset.category,
    categoryLabel: ASSET_CATEGORY_LABELS[asset.category] || asset.category,
    status: asset.status,
    statusLabel: ASSET_STATUS_LABELS[asset.status] || asset.status,
    serial: asset.serial || '',
    barcode: asset.barcode || '',
    location: asset.location || '',
    notes: options.finance ? asset.notes || '' : '',
    currency: asset.currency,
  };
  if (options.finance) {
    json.purchaseDate = isoDay(asset.purchaseDate);
    json.purchaseValue = asset.purchaseValue || 0;
    json.residualValue = asset.residualValue || 0;
    json.usefulLifeMonths = asset.usefulLifeMonths || 0;
    json.bookValue = bookValue(asset);
  }
  if (options.holder) json.holder = options.holder;
  if (options.assignmentStatus) json.assignmentStatus = options.assignmentStatus;
  return json;
}

function presentAssignment(row, asset, access) {
  const holder = row.snapshot && row.snapshot.fullName;
  return {
    id: asId(row),
    access,
    status: row.status,
    statusLabel: ASSIGNMENT_STATUS_LABELS[row.status] || row.status,
    conditionOut: row.conditionOut || '',
    conditionIn: row.conditionIn || '',
    issuedOn: isoDay(row.issuedOn),
    acknowledgedOn: isoDay(row.acknowledgedOn),
    dueOn: isoDay(row.dueOn),
    returnedOn: isoDay(row.returnedOn),
    recoveryQueuedOn: isoDay(row.recoveryQueuedOn),
    note: row.note || '',
    holder: access === 'full' ? holder : '',
    employee: asId(row.employee),
    snapshot: access === 'full' ? row.snapshot : { designation: row.snapshot && row.snapshot.designation },
    asset: presentAsset(asset, { finance: access === 'full', holder: access === 'full' ? holder : '' }),
  };
}

async function loadAssetMap(ids) {
  const rows = await Asset.find({ _id: { $in: ids } });
  const map = {};
  rows.forEach((row) => {
    map[String(row._id)] = row;
  });
  return map;
}

async function holdersByAsset() {
  const rows = await AssetAssignment.find({ status: { $in: HOLDING_STATUSES } }).select('asset snapshot status').lean();
  const map = {};
  rows.forEach((row) => {
    map[String(row.asset)] = {
      name: row.snapshot && row.snapshot.fullName,
      status: row.status,
    };
  });
  return map;
}

async function listAssets(user) {
  const filter = user.role === ROLES.HR_ADMIN ? {} : { status: { $in: ['available', 'issued'] } };
  const rows = await Asset.find(filter).sort({ category: 1, code: 1 });
  const holders = await holdersByAsset();
  const finance = user.role === ROLES.HR_ADMIN;
  return rows.map((row) => {
    const open = holders[String(row._id)] || {};
    return presentAsset(row, {
      finance,
      holder: finance ? open.name || '' : '',
      assignmentStatus: open.status || '',
    });
  });
}

async function createAsset(body, _user) {
  const name = String(body.name || '').trim();
  if (name.length < 3) throw ApiError.badRequest('Asset name is required');
  if (!ASSET_CATEGORIES.includes(body.category)) throw ApiError.badRequest('Unknown asset category');
  const barcode = String(body.barcode || '').trim().toUpperCase();
  const doc = await Asset.create({
    code: body.code ? String(body.code).trim().toUpperCase() : await nextCode(Asset, 'AST', 1000),
    name,
    category: body.category,
    serial: String(body.serial || '').trim(),
    barcode,
    location: String(body.location || '').trim(),
    notes: String(body.notes || '').trim(),
    purchaseDate: body.purchaseDate || null,
    purchaseValue: Number(body.purchaseValue) || 0,
    residualValue: Number(body.residualValue) || 0,
    usefulLifeMonths: Number(body.usefulLifeMonths) || 36,
    currency: body.currency || 'USD',
    status: 'available',
  });
  return presentAsset(doc, { finance: true });
}

async function retireAsset(asset) {
  const open = await AssetAssignment.findOne({ asset: asset._id, status: { $in: HOLDING_STATUSES } });
  if (open) throw ApiError.badRequest('Return the asset before retiring it');
  asset.status = 'retired';
  await asset.save();
  return presentAsset(asset, { finance: true });
}

async function listAssignments(user, viewer, query = {}) {
  const filter = {};
  if (user.role !== ROLES.HR_ADMIN) {
    if (!viewer) return [];
    filter.employee = viewer._id;
  } else if (query.employee) {
    filter.employee = query.employee;
  }
  if (query.status) filter.status = query.status;
  const rows = await AssetAssignment.find(filter).sort({ createdAt: -1 }).limit(300);
  const assets = await loadAssetMap(rows.map((row) => row.asset));
  return rows.map((row) => presentAssignment(row, assets[String(row.asset)], accessFor(user, viewer, row)));
}

async function getAssignment(user, viewer, id) {
  const row = await AssetAssignment.findById(id);
  if (!row) throw ApiError.notFound('Assignment not found');
  const access = accessFor(user, viewer, row);
  if (!access) throw ApiError.notFound('Assignment not found');
  const asset = await Asset.findById(row.asset);
  return { row, asset, presented: presentAssignment(row, asset, access) };
}

async function requestAsset(asset, employee, user, body = {}) {
  if (!employee) throw ApiError.badRequest('An employee record is required to request an asset');
  if (asset.status !== 'available') throw ApiError.badRequest('That asset is not available');
  const existing = await AssetAssignment.findOne({ asset: asset._id, status: { $in: HOLDING_STATUSES } });
  if (existing) throw ApiError.conflict('That asset already has an open assignment');
  const doc = await AssetAssignment.create({
    asset: asset._id,
    employee: employee._id,
    position: employee.currentPosition || null,
    snapshot: snapshotOf(employee),
    status: 'requested',
    note: String(body.note || '').trim(),
  });
  return presentAssignment(doc, asset, accessFor(user, employee, doc));
}

async function issueAssignment(row, asset, employee, user, body = {}) {
  if (row.status !== 'requested') throw ApiError.badRequest('Only a requested item can be issued');
  if (asset.status === 'retired') throw ApiError.badRequest('A retired asset cannot be issued');
  row.status = 'issued';
  row.issuedOn = body.issuedOn ? new Date(body.issuedOn) : new Date();
  row.dueOn = body.dueOn ? new Date(body.dueOn) : null;
  row.conditionOut = body.conditionOut || row.conditionOut || 'good';
  row.issuedBy = user._id;
  row.note = String(body.note || row.note || '').trim();
  asset.status = 'issued';
  await row.save();
  await asset.save();
  return presentAssignment(row, asset, 'full');
}

async function issueDirect(asset, employee, user, body = {}) {
  if (asset.status !== 'available') throw ApiError.badRequest('That asset is not available');
  const existing = await AssetAssignment.findOne({ asset: asset._id, status: { $in: HOLDING_STATUSES } });
  if (existing) throw ApiError.conflict('That asset already has an open assignment');
  const doc = await AssetAssignment.create({
    asset: asset._id,
    employee: employee._id,
    position: employee.currentPosition || null,
    snapshot: snapshotOf(employee),
    status: 'issued',
    conditionOut: body.conditionOut || 'good',
    issuedOn: body.issuedOn ? new Date(body.issuedOn) : new Date(),
    dueOn: body.dueOn ? new Date(body.dueOn) : null,
    note: String(body.note || '').trim(),
    issuedBy: user._id,
  });
  asset.status = 'issued';
  await asset.save();
  return presentAssignment(doc, asset, 'full');
}

async function acknowledgeAssignment(row, asset, user) {
  if (row.status !== 'issued') throw ApiError.badRequest('Only an issued item can be acknowledged');
  row.status = 'acknowledged';
  row.acknowledgedOn = new Date();
  await row.save();
  return presentAssignment(row, asset, 'party');
}

async function requestReturn(row, asset) {
  if (!['issued', 'acknowledged', 'recovery'].includes(row.status)) {
    throw ApiError.badRequest('This item is not currently in custody');
  }
  if (row.status !== 'recovery') {
    row.status = 'recovery';
    row.recoveryQueuedOn = new Date();
    row.note = row.note ? `${row.note} Return requested.` : 'Return requested.';
    await row.save();
  }
  return presentAssignment(row, asset, 'party');
}

async function completeReturn(row, asset, user, body = {}) {
  if (!HOLDING_STATUSES.includes(row.status)) throw ApiError.badRequest('There is no open assignment to return');
  row.status = 'returned';
  row.returnedOn = new Date();
  row.returnedBy = user._id;
  row.conditionIn = body.conditionIn || 'good';
  row.note = String(body.note || row.note || '').trim();
  asset.status = asset.status === 'retired' ? 'retired' : 'available';
  await row.save();
  await asset.save();
  return presentAssignment(row, asset, 'full');
}

async function markLost(row, asset, user, body = {}) {
  if (!HOLDING_STATUSES.includes(row.status)) throw ApiError.badRequest('There is no open assignment to write off');
  row.status = 'lost';
  row.returnedOn = new Date();
  row.returnedBy = user._id;
  row.note = String(body.note || 'Recorded as lost').trim();
  asset.status = 'retired';
  await row.save();
  await asset.save();
  return presentAssignment(row, asset, 'full');
}

async function scanBarcode(barcode, employee, user) {
  const code = String(barcode || '').trim().toUpperCase();
  if (!code) throw ApiError.badRequest('Barcode is required');
  const asset = await Asset.findOne({ barcode: code });
  if (!asset) throw ApiError.notFound('No asset matches that barcode');
  const open = await AssetAssignment.findOne({ asset: asset._id, status: { $in: HOLDING_STATUSES } });
  if (open && ['issued', 'acknowledged', 'recovery'].includes(open.status)) {
    return {
      action: 'returned',
      assignment: await completeReturn(open, asset, user, { note: 'Checked in by barcode' }),
    };
  }
  if (open && open.status === 'requested') {
    const holder = await Employee.findById(open.employee);
    return {
      action: 'issued',
      assignment: await issueAssignment(open, asset, holder, user, { note: 'Checked out by barcode' }),
    };
  }
  if (!employee) throw ApiError.badRequest('Name the employee to check this asset out to');
  return {
    action: 'issued',
    assignment: await issueDirect(asset, employee, user, { note: 'Checked out by barcode' }),
  };
}

async function queueRecovery(employee, _user) {
  if (!employee) return { updated: 0 };
  const rows = await AssetAssignment.find({
    employee: employee._id,
    status: { $in: ['issued', 'acknowledged', 'requested'] },
  });
  let updated = 0;
  for (const row of rows) {
    if (row.status === 'requested') {
      row.status = 'returned';
      row.returnedOn = new Date();
      row.note = row.note ? `${row.note} Cancelled on separation.` : 'Cancelled on separation.';
      const asset = await Asset.findById(row.asset);
      if (asset && asset.status === 'issued') {
        const stillHeld = await AssetAssignment.findOne({
          _id: { $ne: row._id },
          asset: asset._id,
          status: { $in: CUSTODY_STATUSES },
        });
        if (!stillHeld) asset.status = 'available';
        await asset.save();
      }
    } else {
      row.status = 'recovery';
      row.recoveryQueuedOn = row.recoveryQueuedOn || new Date();
      row.dueOn = employee.lastWorkingDay || row.dueOn;
      if (!row.note) row.note = 'Queued for recovery on separation.';
    }
    await row.save();
    updated += 1;
  }

  const left = ['resigned', 'terminated'].indexOf(employee.employmentStatus) !== -1;
  if (left) {
    await TransportRoute.updateMany(
      { 'allocations.employee': employee._id, 'allocations.status': { $in: ['requested', 'allocated'] } },
      { $set: { 'allocations.$[slot].status': 'cancelled', 'allocations.$[slot].effectiveTo': new Date() } },
      { arrayFilters: [{ 'slot.employee': employee._id, 'slot.status': { $in: ['requested', 'allocated'] } }] }
    );

    await AccommodationAllocation.updateMany(
      { employee: employee._id, status: { $in: ['requested', 'allocated'] } },
      { $set: { status: 'vacated', checkOutOn: new Date(), note: 'Vacate on separation.' } }
    );
  }

  return { updated };
}

async function syncRecoveries() {
  const leavers = await Employee.find({ employmentStatus: { $in: SEPARATION_STATUSES } }).select(
    '_id firstName lastName employeeCode designation department employmentStatus lastWorkingDay currentPosition'
  );
  for (const person of leavers) {
    await queueRecovery(person, null);
  }
  return leavers;
}

async function recoveryChecklist() {
  const leavers = await syncRecoveries();
  const ids = leavers.map((row) => row._id);
  const assignments = await AssetAssignment.find({
    employee: { $in: ids },
    status: { $in: ['recovery', 'issued', 'acknowledged'] },
  }).sort({ dueOn: 1 });
  const assets = await loadAssetMap(assignments.map((row) => row.asset));
  const rooms = await AccommodationAllocation.find({
    employee: { $in: ids },
    status: { $in: ['allocated', 'requested'] },
  });
  const routes = await TransportRoute.find({ 'allocations.employee': { $in: ids } });

  return leavers.map((person) => {
    const held = assignments.filter((row) => String(row.employee) === String(person._id));
    const lodging = rooms.filter((row) => String(row.employee) === String(person._id));
    const rides = [];
    routes.forEach((route) => {
      (route.allocations || []).forEach((slot) => {
        if (String(slot.employee) === String(person._id) && ['requested', 'allocated'].includes(slot.status)) {
          rides.push({ route: route.name, departsAt: route.departsAt, seat: slot.seat });
        }
      });
    });
    return {
      employee: asId(person),
      fullName: person.fullName,
      employeeCode: person.employeeCode,
      designation: person.designation,
      department: person.department,
      employmentStatus: person.employmentStatus,
      lastWorkingDay: isoDay(person.lastWorkingDay),
      outstanding: held.length + lodging.length + rides.length,
      assignments: held.map((row) => presentAssignment(row, assets[String(row.asset)], 'full')),
      accommodation: lodging.map(presentAccommodation),
      transport: rides,
    };
  });
}

function presentSeat(slot, access) {
  return {
    id: asId(slot),
    employee: asId(slot.employee),
    holder: access === 'full' ? slot.snapshot && slot.snapshot.fullName : '',
    status: slot.status,
    statusLabel: ALLOCATION_STATUS_LABELS[slot.status] || slot.status,
    seat: slot.seat || '',
    effectiveFrom: isoDay(slot.effectiveFrom),
    effectiveTo: isoDay(slot.effectiveTo),
  };
}

function presentRoute(route, user, viewer) {
  const taken = (route.allocations || []).filter((slot) => ['requested', 'allocated'].includes(slot.status)).length;
  const mine = viewer
    ? (route.allocations || []).filter((slot) => String(slot.employee) === String(viewer._id) && slot.status !== 'cancelled')
    : [];
  const access = user.role === ROLES.HR_ADMIN ? 'full' : 'party';
  return {
    id: asId(route),
    code: route.code,
    name: route.name,
    origin: route.origin,
    destination: route.destination,
    departsAt: route.departsAt,
    capacity: route.capacity,
    occupied: taken,
    remaining: Math.max(0, route.capacity - taken),
    vehicleLabel: route.vehicleLabel || '',
    active: route.active !== false,
    mine: mine.map((slot) => presentSeat(slot, access)),
    allocations: access === 'full' ? (route.allocations || []).map((slot) => presentSeat(slot, access)) : [],
  };
}

async function listRoutes(user, viewer) {
  const rows = await TransportRoute.find({}).sort({ departsAt: 1, code: 1 });
  return rows.map((row) => presentRoute(row, user, viewer));
}

async function createRoute(body) {
  const name = String(body.name || '').trim();
  if (name.length < 3) throw ApiError.badRequest('Route name is required');
  const doc = await TransportRoute.create({
    code: body.code ? String(body.code).trim().toUpperCase() : await nextCode(TransportRoute, 'TR', 0),
    name,
    origin: String(body.origin || '').trim(),
    destination: String(body.destination || '').trim(),
    departsAt: String(body.departsAt || '').trim(),
    capacity: Number(body.capacity) || 8,
    vehicleLabel: String(body.vehicleLabel || '').trim(),
  });
  return presentRoute(doc, { role: ROLES.HR_ADMIN }, null);
}

function occupiedCount(route) {
  return (route.allocations || []).filter((slot) => ['requested', 'allocated'].includes(slot.status)).length;
}

async function allocateSeat(route, employee, user, body = {}, asRequest) {
  const existing = (route.allocations || []).find(
    (slot) => String(slot.employee) === String(employee._id) && ['requested', 'allocated'].includes(slot.status)
  );
  if (existing) throw ApiError.conflict('That employee already has a seat on this route');
  const status = asRequest ? 'requested' : 'allocated';
  if (status === 'allocated' && occupiedCount(route) >= route.capacity) {
    throw ApiError.badRequest('This route is full');
  }
  route.allocations.push({
    employee: employee._id,
    snapshot: snapshotOf(employee),
    status,
    seat: String(body.seat || '').trim(),
    note: String(body.note || '').trim(),
  });
  await route.save();
  return presentRoute(route, user, employee);
}

async function cancelSeat(route, slotId, user, viewer) {
  const slot = route.allocations.id(slotId);
  if (!slot) throw ApiError.notFound('Allocation not found');
  if (user.role !== ROLES.HR_ADMIN && (!viewer || String(slot.employee) !== String(viewer._id))) {
    throw ApiError.notFound('Allocation not found');
  }
  slot.status = 'cancelled';
  slot.effectiveTo = new Date();
  await route.save();
  return presentRoute(route, user, viewer);
}

function presentAccommodation(row, access = 'full') {
  return {
    id: asId(row),
    employee: asId(row.employee),
    holder: access === 'full' ? row.snapshot && row.snapshot.fullName : '',
    site: row.site,
    room: row.room,
    bed: row.bed || '',
    status: row.status,
    statusLabel: ALLOCATION_STATUS_LABELS[row.status] || row.status,
    checkInOn: isoDay(row.checkInOn),
    checkOutOn: isoDay(row.checkOutOn),
    monthlyCharge: access === 'full' ? row.monthlyCharge || 0 : 0,
    currency: row.currency,
    note: row.note || '',
  };
}

async function listAccommodation(user, viewer) {
  const filter = user.role === ROLES.HR_ADMIN || !viewer ? (user.role === ROLES.HR_ADMIN ? {} : { _id: null }) : { employee: viewer._id };
  const rows = await AccommodationAllocation.find(filter).sort({ site: 1, room: 1 });
  const access = user.role === ROLES.HR_ADMIN ? 'full' : 'party';
  return rows.map((row) => presentAccommodation(row, access));
}

async function allocateRoom(employee, body) {
  const site = String(body.site || '').trim();
  const room = String(body.room || '').trim();
  if (!site || !room) throw ApiError.badRequest('Site and room are required');
  const doc = await AccommodationAllocation.create({
    employee: employee._id,
    snapshot: snapshotOf(employee),
    site,
    room,
    bed: String(body.bed || '').trim(),
    status: 'allocated',
    checkInOn: body.checkInOn ? new Date(body.checkInOn) : new Date(),
    monthlyCharge: Number(body.monthlyCharge) || 0,
    currency: body.currency || 'USD',
    note: String(body.note || '').trim(),
  });
  return presentAccommodation(doc, 'full');
}

async function vacateRoom(row, body = {}) {
  if (!['requested', 'allocated'].includes(row.status)) throw ApiError.badRequest('This allocation is already closed');
  row.status = 'vacated';
  row.checkOutOn = body.checkOutOn ? new Date(body.checkOutOn) : new Date();
  row.note = String(body.note || row.note || '').trim();
  await row.save();
  return presentAccommodation(row, 'full');
}

function presentMaintenance(row, asset, access) {
  return {
    id: asId(row),
    kind: row.kind,
    kindLabel: MAINTENANCE_KIND_LABELS[row.kind] || row.kind,
    status: row.status,
    statusLabel: MAINTENANCE_STATUS_LABELS[row.status] || row.status,
    summary: row.summary,
    notes: row.notes || '',
    vendor: access === 'full' ? row.vendor || '' : '',
    cost: access === 'full' ? row.cost || 0 : 0,
    scheduledOn: isoDay(row.scheduledOn),
    completedOn: isoDay(row.completedOn),
    requesterName: row.requesterName || '',
    asset: presentAsset(asset, { finance: access === 'full' }),
  };
}

async function listMaintenance(user, viewer) {
  let filter = {};
  if (user.role !== ROLES.HR_ADMIN) {
    if (!viewer) return [];
    const mine = await AssetAssignment.find({
      employee: viewer._id,
      status: { $in: CUSTODY_STATUSES },
    }).select('asset');
    const ids = mine.map((row) => row.asset);
    if (!ids.length) return [];
    filter = { asset: { $in: ids } };
  }
  const rows = await MaintenanceLog.find(filter).sort({ createdAt: -1 }).limit(200);
  const assets = await loadAssetMap(rows.map((row) => row.asset));
  const access = user.role === ROLES.HR_ADMIN ? 'full' : 'party';
  return rows.map((row) => presentMaintenance(row, assets[String(row.asset)], access));
}

async function openMaintenance(asset, employee, user, body = {}) {
  const summary = String(body.summary || '').trim();
  if (summary.length < 5) throw ApiError.badRequest('Describe the fault in a few words');
  if (asset.status === 'available') asset.status = 'maintenance';
  await asset.save();
  const doc = await MaintenanceLog.create({
    asset: asset._id,
    requestedBy: employee ? employee._id : null,
    requesterName: employee ? employee.fullName : actorName(user),
    kind: body.kind || 'repair',
    status: 'open',
    summary,
    notes: String(body.notes || '').trim(),
  });
  return presentMaintenance(doc, asset, user.role === ROLES.HR_ADMIN ? 'full' : 'party');
}

async function scheduleMaintenance(row, asset, body = {}) {
  if (!['open', 'scheduled'].includes(row.status)) throw ApiError.badRequest('This job is already closed');
  row.status = 'scheduled';
  row.scheduledOn = body.scheduledOn ? new Date(body.scheduledOn) : row.scheduledOn;
  row.vendor = String(body.vendor || row.vendor || '').trim();
  row.notes = String(body.notes || row.notes || '').trim();
  await row.save();
  if (asset.status === 'available') {
    asset.status = 'maintenance';
    await asset.save();
  }
  return presentMaintenance(row, asset, 'full');
}

async function completeMaintenance(row, asset, body = {}) {
  if (row.status === 'done') throw ApiError.badRequest('This job is already closed');
  row.status = 'done';
  row.completedOn = new Date();
  row.cost = Number(body.cost) || row.cost || 0;
  row.vendor = String(body.vendor || row.vendor || '').trim();
  row.notes = String(body.notes || row.notes || '').trim();
  await row.save();
  const open = await MaintenanceLog.findOne({ asset: asset._id, status: { $in: ['open', 'scheduled'] } });
  const held = await AssetAssignment.findOne({ asset: asset._id, status: { $in: CUSTODY_STATUSES } });
  if (!open) asset.status = held ? 'issued' : 'available';
  await asset.save();
  return presentMaintenance(row, asset, 'full');
}

async function financeExport() {
  const assets = await Asset.find({ status: { $ne: 'retired' } }).sort({ category: 1, code: 1 });
  const holders = await holdersByAsset();
  return {
    generatedOn: isoDay(new Date()),
    currencyNote: 'Book value is a straight-line reference for Finance — PortoHR does not post the GL.',
    assets: assets.map((row) => ({
      ...presentAsset(row, { finance: true, holder: (holders[String(row._id)] && holders[String(row._id)].name) || '' }),
    })),
  };
}

module.exports = {
  presentAsset,
  presentAssignment,
  listAssets,
  createAsset,
  retireAsset,
  listAssignments,
  getAssignment,
  requestAsset,
  issueAssignment,
  issueDirect,
  acknowledgeAssignment,
  requestReturn,
  completeReturn,
  markLost,
  scanBarcode,
  queueRecovery,
  recoveryChecklist,
  listRoutes,
  createRoute,
  allocateSeat,
  cancelSeat,
  listAccommodation,
  allocateRoom,
  vacateRoom,
  listMaintenance,
  openMaintenance,
  scheduleMaintenance,
  completeMaintenance,
  financeExport,
  accessFor,
};
