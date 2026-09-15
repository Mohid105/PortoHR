'use strict';

const mongoose = require('mongoose');
const Requisition = require('../models/Requisition');
const Candidate = require('../models/Candidate');
const Application = require('../models/Application');
const Offer = require('../models/Offer');
const OnboardingTask = require('../models/OnboardingTask');
const Position = require('../models/Position');
const Employee = require('../models/Employee');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/roles');
const { metaPayload } = require('../config/recruitment');
const { resolveViewerEmployee, canDecideFor } = require('../services/employeeAccess');
const ats = require('../services/recruitment.service');
const webhooks = require('../services/webhooks.service');

function requireId(id, label) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound(`${label} not found`);
}

const meta = asyncHandler(async (_req, res) => {
  const vacant = await Position.find({ status: { $in: ['vacant', 'approved'] }, incumbent: null })
    .select('positionCode title status location')
    .sort({ positionCode: 1 });
  const managers = await Employee.find({ employmentStatus: { $in: ['confirmed', 'probation'] } })
    .select('firstName lastName employeeCode designation department')
    .sort({ firstName: 1 })
    .limit(80);

  res.json({
    success: true,
    meta: Object.assign(metaPayload(), {
      vacantPositions: vacant.map((row) => ({
        id: String(row._id),
        positionCode: row.positionCode,
        title: row.title,
        location: row.location,
      })),
      managers: managers.map((row) => ({
        id: String(row._id),
        fullName: row.fullName,
        employeeCode: row.employeeCode,
        designation: row.designation,
      })),
    }),
  });
});

const listRequisitions = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.user.role === ROLES.MANAGER && viewer) {
    filter.hiringManager = viewer._id;
  } else if (req.user.role === ROLES.EMPLOYEE) {
    filter.status = 'open';
  }

  const rows = await Requisition.find(filter)
    .populate('position', 'positionCode title status location')
    .populate('hiringManager', 'firstName lastName employeeCode designation department')
    .sort({ createdAt: -1 })
    .limit(100);

  const counts = await Application.aggregate([{ $group: { _id: '$requisition', total: { $sum: 1 } } }]);
  const byReq = {};
  counts.forEach((row) => {
    byReq[String(row._id)] = row.total;
  });

  res.json({
    success: true,
    requisitions: rows.map((row) =>
      Object.assign(ats.presentRequisition(row), { applicationCount: byReq[String(row._id)] || 0 })
    ),
  });
});

const createRequisition = asyncHandler(async (req, res) => {
  if (req.user.role === ROLES.EMPLOYEE) {
    throw ApiError.forbidden('Employees cannot open a requisition');
  }
  const viewer = await resolveViewerEmployee(req.user);
  const presented = await ats.createRequisition(req.body || {}, req.user, viewer);
  res.status(201).json({
    success: true,
    message: presented.status === 'open' ? 'Requisition opened' : 'Requisition submitted for HR approval',
    requisition: presented,
  });
});

const decideRequisition = asyncHandler(async (req, res) => {
  requireId(req.params.id, 'Requisition');
  const requisition = await Requisition.findById(req.params.id);
  if (!requisition) throw ApiError.notFound('Requisition not found');

  const viewer = await resolveViewerEmployee(req.user);
  const hiringManager = await Employee.findById(requisition.hiringManager);
  if (!(await canDecideFor(req.user, viewer, hiringManager || { _id: requisition.employee, email: '' }, 'requisition'))) {
    throw ApiError.forbidden('You are not the approver for this requisition');
  }

  let status = (req.body || {}).status;
  if (status === 'approved') status = 'open';
  const presented = await ats.decideRequisition(requisition, req.user, status, (req.body || {}).decisionNote);
  webhooks.emitApprovalCompleted({
    kind: 'requisition',
    decision: (req.body || {}).status,
    objectId: requisition._id,
    employeeCode: hiringManager && hiringManager.employeeCode,
    fullName: hiringManager && hiringManager.fullName,
  });
  res.json({ success: true, message: `Requisition ${presented.statusLabel.toLowerCase()}`, requisition: presented });
});

const listApplications = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  const filter = {};
  if (req.query.stage) filter.stage = req.query.stage;
  if (req.query.requisition) {
    requireId(req.query.requisition, 'Requisition');
    filter.requisition = req.query.requisition;
  } else if (req.user.role === ROLES.MANAGER && viewer) {
    const mine = await Requisition.find({ hiringManager: viewer._id }).select('_id');
    filter.requisition = { $in: mine.map((row) => row._id) };
  } else if (req.user.role === ROLES.EMPLOYEE && viewer) {
    filter.employee = viewer._id;
  }

  const rows = await Application.find(filter)
    .populate('candidate')
    .populate('requisition', 'code title status hiringManager')
    .sort({ updatedAt: -1 })
    .limit(200);

  res.json({ success: true, applications: rows.map(ats.presentApplication) });
});

const addCandidate = asyncHandler(async (req, res) => {
  if (req.user.role === ROLES.EMPLOYEE) throw ApiError.forbidden('Use Apply on the job board instead');
  const body = req.body || {};
  requireId(body.requisition, 'Requisition');
  const requisition = await Requisition.findById(body.requisition);
  if (!requisition) throw ApiError.notFound('Requisition not found');

  const viewer = await resolveViewerEmployee(req.user);
  if (!ats.canSeeRequisition(req.user, viewer, requisition) || requisition.status !== 'open') {
    throw ApiError.forbidden('You cannot add candidates to this requisition');
  }

  const candidate = await ats.findOrCreateCandidate(body);
  const application = await ats.applyToRequisition(requisition, candidate, {
    source: body.source,
    coverNote: body.coverNote,
  });
  res.status(201).json({
    success: true,
    message: 'Candidate added to the pipeline',
    application: ats.presentApplication(application),
  });
});

const applyInternal = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  if (!viewer) throw ApiError.badRequest('Your login is not linked to an employee record yet');
  const body = req.body || {};
  requireId(body.requisition, 'Requisition');
  const requisition = await Requisition.findById(body.requisition);
  if (!requisition || requisition.status !== 'open') {
    throw ApiError.notFound('That role is not open');
  }

  const candidate = await ats.findOrCreateCandidate({
    firstName: viewer.firstName,
    lastName: viewer.lastName,
    email: viewer.email,
    phone: viewer.phone,
    source: 'internal',
    employee: viewer._id,
  });
  const application = await ats.applyToRequisition(requisition, candidate, {
    employee: viewer._id,
    source: 'internal',
    coverNote: body.coverNote || '',
  });
  res.status(201).json({
    success: true,
    message: 'Application submitted',
    application: ats.presentApplication(application),
  });
});

const patchApplication = asyncHandler(async (req, res) => {
  if (req.user.role === ROLES.EMPLOYEE) throw ApiError.forbidden('Employees cannot move pipeline stages');
  requireId(req.params.id, 'Application');
  const application = await Application.findById(req.params.id);
  if (!application) throw ApiError.notFound('Application not found');
  const body = req.body || {};
  if (body.score) application.score = Number(body.score);
  let updated = application;
  if (body.stage) updated = await ats.moveStage(application, body.stage);
  else await application.save();
  const full = await Application.findById(updated._id).populate('candidate').populate('requisition', 'code title status');
  res.json({ success: true, application: ats.presentApplication(full) });
});

const addInterview = asyncHandler(async (req, res) => {
  if (req.user.role === ROLES.EMPLOYEE) throw ApiError.forbidden('Employees cannot submit scorecards');
  requireId(req.params.id, 'Application');
  const application = await Application.findById(req.params.id);
  if (!application) throw ApiError.notFound('Application not found');
  const full = await ats.addInterview(application, req.body || {}, req.user);
  res.status(201).json({ success: true, message: 'Scorecard saved', application: ats.presentApplication(full) });
});

const createOffer = asyncHandler(async (req, res) => {
  if (req.user.role !== ROLES.HR_ADMIN) throw ApiError.forbidden('Only HR can raise an offer');
  requireId(req.params.id, 'Application');
  const application = await Application.findById(req.params.id);
  if (!application) throw ApiError.notFound('Application not found');
  const requisition = await Requisition.findById(application.requisition);
  const offer = await ats.createOffer(application, requisition, req.body || {}, req.user);
  res.status(201).json({ success: true, message: 'Offer submitted for hiring-manager approval', offer });
});

const listOffers = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;

  if (req.query.scope === 'queue') {
    if (req.user.role === ROLES.EMPLOYEE) {
      return res.json({ success: true, offers: [], pendingCount: 0, canApprove: false });
    }
    if (!req.query.status) filter.status = 'pending';
    if (req.user.role === ROLES.MANAGER) {
      if (!viewer) return res.json({ success: true, offers: [], pendingCount: 0, canApprove: false });
      filter.employee = viewer._id;
      filter.submittedBy = { $ne: req.user._id };
    } else if (req.user.role === ROLES.HR_ADMIN) {
      filter.submittedBy = { $ne: req.user._id };
    }
  } else if (req.user.role === ROLES.MANAGER && viewer) {
    filter.employee = viewer._id;
  } else if (req.user.role === ROLES.EMPLOYEE) {
    return res.json({ success: true, offers: [] });
  }

  const rows = await Offer.find(filter).sort({ createdAt: -1 }).limit(100);
  const pendingFilter = Object.assign({}, filter, { status: 'pending' });
  const pendingCount = await Offer.countDocuments(pendingFilter);
  res.json({
    success: true,
    canApprove: req.user.role !== ROLES.EMPLOYEE,
    pendingCount,
    offers: rows.map(ats.presentOffer),
  });
});

const decideOffer = asyncHandler(async (req, res) => {
  requireId(req.params.id, 'Offer');
  const offer = await Offer.findById(req.params.id);
  if (!offer) throw ApiError.notFound('Offer not found');
  const hiringManager = await Employee.findById(offer.employee);
  const viewer = await resolveViewerEmployee(req.user);
  if (!ats.canDecideOffer(req.user, viewer, offer)) {
    throw ApiError.forbidden(
      hiringManager && viewer && String(hiringManager._id) === String(viewer._id) && String(offer.submittedBy) === String(req.user._id)
        ? 'You cannot approve an offer you raised'
        : 'You are not the approver for this offer'
    );
  }
  const presented = await ats.decideOffer(offer, req.user, (req.body || {}).status, (req.body || {}).decisionNote);
  webhooks.emitApprovalCompleted({
    kind: 'offer',
    decision: (req.body || {}).status,
    objectId: offer._id,
    employeeCode: hiringManager && hiringManager.employeeCode,
    fullName: hiringManager && hiringManager.fullName,
  });
  res.json({ success: true, message: `Offer ${presented.statusLabel.toLowerCase()}`, offer: presented });
});

const acceptOffer = asyncHandler(async (req, res) => {
  if (req.user.role !== ROLES.HR_ADMIN) throw ApiError.forbidden('Only HR can convert an accepted offer into a hire');
  requireId(req.params.id, 'Offer');
  const offer = await Offer.findById(req.params.id);
  if (!offer) throw ApiError.notFound('Offer not found');
  const result = await ats.acceptOffer(offer, req.user);
  res.json({
    success: true,
    message: `${result.employee.fullName} hired as ${result.employee.employeeCode}`,
    ...result,
  });
});

const listOnboarding = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.application) {
    requireId(req.query.application, 'Application');
    filter.application = req.query.application;
  } else if (req.user.role === ROLES.EMPLOYEE) {
    const viewer = await resolveViewerEmployee(req.user);
    if (viewer) filter.hiredEmployee = viewer._id;
  }
  const rows = await OnboardingTask.find(filter).sort({ createdAt: 1 }).limit(200);
  res.json({ success: true, tasks: rows.map(ats.presentTask) });
});

const completeOnboarding = asyncHandler(async (req, res) => {
  requireId(req.params.id, 'Onboarding task');
  const task = await OnboardingTask.findById(req.params.id);
  if (!task) throw ApiError.notFound('Onboarding task not found');
  task.status = (req.body || {}).status === 'pending' ? 'pending' : 'done';
  task.doneAt = task.status === 'done' ? new Date() : null;
  task.doneBy = req.user._id;
  await task.save();
  res.json({ success: true, task: ats.presentTask(task) });
});

module.exports = {
  meta,
  listRequisitions,
  createRequisition,
  decideRequisition,
  listApplications,
  addCandidate,
  applyInternal,
  patchApplication,
  addInterview,
  createOffer,
  listOffers,
  decideOffer,
  acceptOffer,
  listOnboarding,
  completeOnboarding,
};
