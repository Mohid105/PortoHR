'use strict';

const Employee = require('../models/Employee');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/roles');
const { metaPayload } = require('../config/esign');
const { resolveViewerEmployee } = require('../services/employeeAccess');
const audit = require('../services/audit.service');
const esign = require('../services/esign.service');

function requireHr(user) {
  if (user.role !== ROLES.HR_ADMIN) throw ApiError.forbidden('Only HR can send signature packs');
}

function clientMeta(req) {
  return {
    ip: req.ip || (req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || '',
    userAgent: String((req.headers && req.headers['user-agent']) || '').slice(0, 300),
  };
}

/** GET /api/esign/meta */
const meta = asyncHandler(async (_req, res) => {
  res.json({ success: true, meta: metaPayload() });
});

/** GET /api/esign/people */
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

/** GET /api/esign/packs */
const list = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  const packs = await esign.list(req.user, viewer, req.query || {});
  res.json({ success: true, total: packs.length, packs });
});

/** POST /api/esign/packs */
const create = asyncHandler(async (req, res) => {
  requireHr(req.user);
  const pack = await esign.send(req.user, req.body || {});
  await audit.record(req, {
    action: 'esign_send',
    employee: pack.employee,
    objectType: 'SignaturePack',
    objectId: pack.id,
    summary: `${pack.code} ${pack.title}`,
  });
  res.status(201).json({
    success: true,
    message: `${pack.snapshot.fullName} has been asked to sign ${pack.code}`,
    pack,
  });
});

/** GET /api/esign/packs/:id */
const getOne = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  const pack = await esign.getOne(req.user, viewer, req.params.id, true);
  res.json({ success: true, pack });
});

/** GET /api/esign/packs/:id/evidence */
const evidence = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  const pack = await esign.getOne(req.user, viewer, req.params.id, true);
  res.json({
    success: true,
    evidence: {
      code: pack.code,
      title: pack.title,
      body: pack.body,
      bodyHash: pack.bodyHash,
      bodyUnchanged: pack.bodyUnchanged,
      contentHash: pack.contentHash,
      typedName: pack.typedName,
      signedAt: pack.signedAt,
      ip: pack.ip,
      userAgent: pack.userAgent,
      strokeCount: pack.strokeCount,
      signatureImage: pack.signatureImage,
      status: pack.status,
      signer: pack.snapshot,
    },
  });
});

/** POST /api/esign/packs/:id/sign */
const sign = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  const pack = await esign.sign(req.user, viewer, req.params.id, req.body || {}, clientMeta(req));
  await audit.record(req, {
    action: 'esign_sign',
    employee: pack.employee,
    objectType: 'SignaturePack',
    objectId: pack.id,
    summary: pack.contentHash,
  });
  res.json({
    success: true,
    message: `${pack.code} signed. Core HR and payroll were not changed.`,
    pack,
  });
});

/** POST /api/esign/packs/:id/decline */
const decline = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  const pack = await esign.decline(req.user, viewer, req.params.id, req.body || {});
  await audit.record(req, {
    action: 'esign_decline',
    employee: pack.employee,
    objectType: 'SignaturePack',
    objectId: pack.id,
    summary: pack.declineReason,
  });
  res.json({ success: true, message: `${pack.code} declined`, pack });
});

/** POST /api/esign/packs/:id/cancel */
const cancel = asyncHandler(async (req, res) => {
  requireHr(req.user);
  const pack = await esign.cancel(req.user, req.params.id);
  await audit.record(req, {
    action: 'esign_cancel',
    employee: pack.employee,
    objectType: 'SignaturePack',
    objectId: pack.id,
    summary: pack.code,
  });
  res.json({ success: true, message: `${pack.code} cancelled`, pack });
});

module.exports = {
  meta,
  people,
  list,
  create,
  getOne,
  evidence,
  sign,
  decline,
  cancel,
};
