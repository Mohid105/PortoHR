'use strict';

const analytics = require('../services/analytics.service');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/roles');
const { metaPayload } = require('../config/analytics');
const { visibleEmployeeIds } = require('../services/employeeAccess');
const audit = require('../services/audit.service');
const ApiError = require('../utils/ApiError');

function requireHr(user) {
  if (user.role !== ROLES.HR_ADMIN) throw ApiError.forbidden('Only HR can run that analytics action');
}

const meta = asyncHandler(async (_req, res) => {
  res.json({ success: true, meta: metaPayload() });
});

const overview = asyncHandler(async (req, res) => {
  const ids = await visibleEmployeeIds(req.user);
  res.json({ success: true, overview: await analytics.overview(req.user, ids) });
});

const headcount = asyncHandler(async (req, res) => {
  const ids = await visibleEmployeeIds(req.user);
  res.json({ success: true, headcount: await analytics.headcount(req.user, ids, req.query || {}) });
});

const quality = asyncHandler(async (req, res) => {
  const ids = await visibleEmployeeIds(req.user);
  res.json({ success: true, quality: await analytics.quality(req.user, ids) });
});

const outlook = asyncHandler(async (req, res) => {
  const ids = await visibleEmployeeIds(req.user);
  res.json({ success: true, outlook: await analytics.outlook(req.user, ids) });
});

const listReports = asyncHandler(async (req, res) => {
  await analytics.ensureCatalogue();
  res.json({ success: true, reports: await analytics.listReports(req.user) });
});

const runReport = asyncHandler(async (req, res) => {
  const ids = await visibleEmployeeIds(req.user);
  const payload = await analytics.runReport(req.user, ids, req.params.code, req.query || {});
  res.json({ success: true, ...payload });
});

const adhoc = asyncHandler(async (req, res) => {
  const ids = await visibleEmployeeIds(req.user);
  const query = Object.assign({}, req.query || {}, req.body || {});
  const payload = await analytics.runAdhoc(req.user, ids, query);
  const logged = await analytics.recordExport(req.user, payload, query);
  await audit.record(req, {
    action: 'analytics_adhoc',
    objectType: 'ExportLog',
    objectId: logged.id,
    summary: `roster by ${payload.groupBy}`,
  });
  res.json({ success: true, export: logged, ...payload });
});

const exportReport = asyncHandler(async (req, res) => {
  const ids = await visibleEmployeeIds(req.user);
  const query = Object.assign({}, req.query || {}, req.body || {});
  const payload = await analytics.runReport(req.user, ids, req.params.code, query);
  const logged = await analytics.recordExport(req.user, payload, query);
  await audit.record(req, {
    action: 'analytics_export',
    objectType: 'ExportLog',
    objectId: logged.id,
    summary: payload.report.code,
  });
  res.json({ success: true, export: logged, ...payload });
});

const snapshots = asyncHandler(async (req, res) => {
  requireHr(req.user);
  res.json({ success: true, snapshots: await analytics.listSnapshots() });
});

const refresh = asyncHandler(async (req, res) => {
  requireHr(req.user);
  const ids = await visibleEmployeeIds(req.user);
  const snapshot = await analytics.refreshSnapshot(req.user, ids);
  await audit.record(req, {
    action: 'analytics_snapshot',
    objectType: 'KPISnapshot',
    objectId: snapshot.id,
    summary: snapshot.asOf,
  });
  res.status(201).json({ success: true, message: 'KPI snapshot stored', snapshot });
});

const exportsList = asyncHandler(async (req, res) => {
  requireHr(req.user);
  res.json({ success: true, exports: await analytics.listExports() });
});

module.exports = {
  meta,
  overview,
  headcount,
  quality,
  outlook,
  listReports,
  runReport,
  adhoc,
  exportReport,
  snapshots,
  refresh,
  exportsList,
};
