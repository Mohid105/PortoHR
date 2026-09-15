'use strict';

const Requisition = require('../models/Requisition');
const Candidate = require('../models/Candidate');
const Application = require('../models/Application');
const Offer = require('../models/Offer');
const OnboardingTask = require('../models/OnboardingTask');
const Position = require('../models/Position');
const Employee = require('../models/Employee');
const ApiError = require('../utils/ApiError');
const org = require('./org.service');
const workforce = require('./workforce.service');
const webhooks = require('./webhooks.service');
const {
  REQUISITION_STATUS_LABELS,
  STAGE_LABELS,
  OFFER_STATUS_LABELS,
  SOURCE_LABELS,
  ONBOARDING_DEFAULTS,
  PIPELINE_STAGES,
} = require('../config/recruitment');

function asId(value) {
  return String((value && (value._id || value.id || value)) || '');
}

function snapshotOf(employee) {
  if (!employee) return { employeeCode: '', fullName: '', designation: '', department: '' };
  return {
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    designation: employee.designation,
    department: employee.department,
  };
}

function presentRequisition(doc) {
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  json.statusLabel = REQUISITION_STATUS_LABELS[json.status] || json.status;
  if (json.position && json.position._id) {
    json.positionId = String(json.position._id);
    json.positionCode = json.position.positionCode;
    json.positionTitle = json.position.title;
  } else if (json.position) {
    json.positionId = String(json.position);
  }
  if (json.hiringManager && json.hiringManager._id) {
    json.hiringManagerName = `${json.hiringManager.firstName || ''} ${json.hiringManager.lastName || ''}`.trim();
    json.hiringManagerId = String(json.hiringManager._id);
  }
  json.employee = asId(json.employee);
  return json;
}

function presentCandidate(doc) {
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  json.fullName = json.fullName || `${json.firstName || ''} ${json.lastName || ''}`.trim();
  json.sourceLabel = SOURCE_LABELS[json.source] || json.source;
  return json;
}

function presentApplication(doc) {
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  json.stageLabel = STAGE_LABELS[json.stage] || json.stage;
  json.candidate = json.candidate ? presentCandidate(json.candidate) : null;
  if (json.requisition && json.requisition.title) {
    json.requisitionId = String(json.requisition._id || json.requisition);
    json.requisitionTitle = json.requisition.title;
    json.requisitionCode = json.requisition.code;
  } else {
    json.requisitionId = asId(json.requisition);
  }
  return json;
}

function presentOffer(doc) {
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  json.application = asId(json.application);
  json.requisition = asId(json.requisition);
  json.candidate = asId(json.candidate);
  json.submittedBy = asId(json.submittedBy);
  json.statusLabel = OFFER_STATUS_LABELS[json.status] || json.status;
  json.startDate = json.startDate ? new Date(json.startDate).toISOString().slice(0, 10) : '';
  return json;
}

function presentTask(doc) {
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  return json;
}

async function nextCode(Model, prefix, field) {
  const rows = await Model.find({ [field]: new RegExp(`^${prefix}-`) }).select(field).lean();
  let max = 1000;
  rows.forEach((row) => {
    const n = Number(String(row[field]).replace(/\D/g, ''));
    if (n > max) max = n;
  });
  return `${prefix}-${max + 1}`;
}

async function nextEmployeeCode() {
  return nextCode(Employee, 'PH', 'employeeCode');
}

async function populateRequisition(id) {
  return Requisition.findById(id)
    .populate('position', 'positionCode title status location incumbent')
    .populate('hiringManager', 'firstName lastName employeeCode designation department');
}

function canDecideOffer(user, viewer, offer) {
  const submittedBy = String(offer.submittedBy || '');
  if (submittedBy && submittedBy === String(user._id)) return false;
  if (user.role === 'hr_admin') return true;
  return Boolean(user.role === 'manager' && viewer && String(offer.employee) === String(viewer._id));
}

function canSeeRequisition(user, viewer, reqn) {
  if (user.role === 'hr_admin') return true;
  if (user.role === 'manager' && viewer && String(reqn.hiringManager._id || reqn.hiringManager) === String(viewer._id)) {
    return true;
  }
  if (reqn.status === 'open') return true;
  return false;
}

async function createRequisition(body, user, viewer) {
  if (!body.position) throw ApiError.badRequest('A vacant position is required');
  const seat = await org.assertPositionAvailable(body.position, null);
  if (seat.status === 'filled') throw ApiError.conflict('That position already has an incumbent');

  const openOnSame = await Requisition.countDocuments({
    position: seat._id,
    status: { $in: ['pending', 'open', 'on_hold'] },
  });
  if (openOnSame) throw ApiError.conflict('An open requisition already exists for this position');

  let hiringManager = viewer;
  if (body.hiringManager) {
    hiringManager = await Employee.findById(body.hiringManager);
    if (!hiringManager) throw ApiError.badRequest('Hiring manager not found');
  }
  if (!hiringManager) throw ApiError.badRequest('A hiring manager is required');

  const reason = String(body.reason || '').trim();
  if (reason.length < 8) throw ApiError.badRequest('Please give at least 8 characters of context');

  const hrOpensDirectly = user.role === 'hr_admin';
  const requisition = await Requisition.create({
    code: await nextCode(Requisition, 'REQ', 'code'),
    position: seat._id,
    title: body.title || seat.title,
    department: body.department || hiringManager.department || '',
    location: body.location || seat.location || '',
    openings: Number(body.openings) || 1,
    hiringManager: hiringManager._id,
    employee: hiringManager._id,
    reason,
    snapshot: snapshotOf(hiringManager),
    status: hrOpensDirectly ? 'open' : 'pending',
    requestedBy: user._id,
    decidedBy: hrOpensDirectly ? user._id : null,
    decidedAt: hrOpensDirectly ? new Date() : null,
  });

  if (seat.status !== 'vacant' && seat.status !== 'approved') {
    seat.status = 'vacant';
    await seat.save();
  }

  return presentRequisition(await populateRequisition(requisition._id));
}

async function decideRequisition(requisition, user, status, note) {
  if (requisition.status !== 'pending') {
    throw ApiError.conflict('This requisition is no longer waiting for a decision');
  }
  if (['open', 'rejected'].indexOf(status) === -1) {
    throw ApiError.badRequest('A requisition decision must be open or rejected');
  }
  const decisionNote = String(note || '').trim();
  if (status === 'rejected' && !decisionNote) {
    throw ApiError.badRequest('Please give a reason when rejecting a requisition');
  }
  requisition.status = status;
  requisition.decisionNote = decisionNote;
  requisition.decidedBy = user._id;
  requisition.decidedAt = new Date();
  await requisition.save();
  return presentRequisition(await populateRequisition(requisition._id));
}

async function findOrCreateCandidate(body) {
  const email = String(body.email || '').toLowerCase().trim();
  if (!email) throw ApiError.badRequest('Candidate email is required');
  const existing = await Candidate.findOne({ email });
  if (existing) {
    if (body.phone) existing.phone = body.phone;
    if (body.resumeUrl) existing.resumeUrl = body.resumeUrl;
    if (body.tags) existing.tags = body.tags;
    await existing.save();
    return existing;
  }
  if (!body.firstName || !body.lastName) throw ApiError.badRequest('First and last name are required');
  return Candidate.create({
    firstName: body.firstName,
    lastName: body.lastName,
    email,
    phone: body.phone || '',
    source: body.source || 'career_site',
    resumeUrl: body.resumeUrl || '',
    tags: body.tags || [],
    employee: body.employee || null,
  });
}

async function applyToRequisition(requisition, candidate, extras) {
  if (requisition.status !== 'open') {
    throw ApiError.conflict('Candidates can only be added to an open requisition');
  }
  try {
    const application = await Application.create({
      requisition: requisition._id,
      candidate: candidate._id,
      employee: extras.employee || candidate.employee || null,
      source: extras.source || candidate.source || 'career_site',
      coverNote: extras.coverNote || '',
      stage: 'applied',
    });
    return Application.findById(application._id).populate('candidate').populate('requisition', 'code title status');
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('This person has already applied for that role');
    throw err;
  }
}

async function moveStage(application, stage) {
  if (PIPELINE_STAGES.indexOf(stage) === -1) throw ApiError.badRequest('Unknown pipeline stage');
  if (application.stage === 'hired' && stage !== 'hired') {
    throw ApiError.conflict('A hired application cannot be moved backwards');
  }
  if (stage === 'hired') {
    throw ApiError.badRequest('Hire the candidate from an approved offer, not by moving the card');
  }
  if (stage === 'offer') {
    throw ApiError.badRequest('Raise an offer instead of moving the card to Offer');
  }
  application.stage = stage;
  await application.save();
  return Application.findById(application._id).populate('candidate').populate('requisition', 'code title status');
}

async function addInterview(application, body, user) {
  application.interviews.push({
    scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : new Date(),
    interviewerName: String(body.interviewerName || '').trim(),
    score: body.score ? Number(body.score) : null,
    notes: String(body.notes || '').trim(),
    recommendation: body.recommendation || '',
    recordedBy: user._id,
  });
  if (body.score) application.score = Number(body.score);
  if (application.stage === 'applied' || application.stage === 'screening') {
    application.stage = 'interview';
  }
  await application.save();
  return Application.findById(application._id).populate('candidate').populate('requisition', 'code title status');
}

async function createOffer(application, requisition, body, user) {
  if (['rejected', 'withdrawn', 'hired'].indexOf(application.stage) !== -1) {
    throw ApiError.conflict('An offer cannot be raised from this stage');
  }
  const existing = await Offer.findOne({ application: application._id });
  if (existing) throw ApiError.conflict('An offer already exists for this application');

  const salary = Number(body.salary);
  if (!salary || salary <= 0) throw ApiError.badRequest('Offer salary is required');
  if (!body.startDate) throw ApiError.badRequest('A start date is required');

  const candidate = await Candidate.findById(application.candidate);
  const hiringSnap = requisition.snapshot || {};
  const offer = await Offer.create({
    application: application._id,
    requisition: requisition._id,
    candidate: application.candidate,
    employee: requisition.hiringManager,
    snapshot: Object.assign(snapshotOf({
      employeeCode: hiringSnap.employeeCode,
      fullName: hiringSnap.fullName,
      designation: hiringSnap.designation,
      department: hiringSnap.department,
    }), {
      candidateName: candidate ? candidate.fullName : '',
      title: requisition.title,
    }),
    currency: body.currency || 'USD',
    salary,
    startDate: new Date(body.startDate),
    employmentType: body.employmentType || 'full_time',
    letterBody:
      body.letterBody ||
      `We are pleased to offer you the position of ${requisition.title} at PortoHR, starting ${body.startDate}.`,
    status: 'pending',
    submittedBy: user._id,
  });

  application.stage = 'offer';
  await application.save();
  return presentOffer(offer);
}

async function decideOffer(offer, user, status, note) {
  if (offer.status !== 'pending') {
    throw ApiError.conflict('This offer is no longer waiting for a decision');
  }
  if (['approved', 'rejected'].indexOf(status) === -1) {
    throw ApiError.badRequest('An offer decision must be approved or rejected');
  }
  const decisionNote = String(note || '').trim();
  if (status === 'rejected' && !decisionNote) {
    throw ApiError.badRequest('Please give a reason when rejecting an offer');
  }
  offer.status = status === 'approved' ? 'sent' : 'rejected';
  offer.decisionNote = decisionNote;
  offer.decidedBy = user._id;
  offer.decidedAt = new Date();
  await offer.save();

  if (status === 'rejected') {
    const application = await Application.findById(offer.application);
    if (application && application.stage === 'offer') {
      application.stage = 'interview';
      await application.save();
    }
  }
  return presentOffer(offer);
}

async function acceptOffer(offer, user) {
  if (['sent', 'approved'].indexOf(offer.status) === -1) {
    throw ApiError.conflict('Only an approved offer can be accepted into Core HR');
  }

  const application = await Application.findById(offer.application).populate('candidate');
  const requisition = await Requisition.findById(offer.requisition);
  const candidate = application.candidate;
  const manager = await Employee.findById(requisition.hiringManager);
  const seat = await Position.findById(requisition.position);

  const employee = await workforce.createHire(
    {
      employeeCode: await nextEmployeeCode(),
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      email: candidate.email,
      phone: candidate.phone || '',
      designation: requisition.title,
      department: requisition.department || (manager && manager.department) || 'Engineering',
      dateOfJoining: offer.startDate,
      position: seat && seat._id,
      reportsTo: manager && manager._id,
      employmentType: offer.employmentType,
      employmentStatus: 'probation',
      compensation: {
        currency: offer.currency,
        baseSalary: offer.salary,
        fixedAllowances: [],
      },
      location: requisition.location || '',
    },
    user._id
  );

  offer.status = 'accepted';
  offer.hiredEmployee = employee._id;
  await offer.save();

  application.stage = 'hired';
  application.hiredEmployee = employee._id;
  await application.save();

  requisition.filledCount += 1;
  if (requisition.filledCount >= requisition.openings) requisition.status = 'filled';
  await requisition.save();

  await OnboardingTask.insertMany(
    ONBOARDING_DEFAULTS.map((task) => ({
      application: application._id,
      offer: offer._id,
      hiredEmployee: employee._id,
      title: task.title,
      owner: task.owner,
    }))
  );

  webhooks.emit('employee.hired', {
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    startDate: offer.startDate,
    requisition: requisition.code,
    department: requisition.department || employee.department,
    offerId: String(offer._id),
  });

  return {
    offer: presentOffer(offer),
    employee: {
      id: String(employee._id),
      employeeCode: employee.employeeCode,
      fullName: employee.fullName,
    },
  };
}

module.exports = {
  snapshotOf,
  presentRequisition,
  presentCandidate,
  presentApplication,
  presentOffer,
  presentTask,
  populateRequisition,
  canSeeRequisition,
  canDecideOffer,
  createRequisition,
  decideRequisition,
  findOrCreateCandidate,
  applyToRequisition,
  moveStage,
  addInterview,
  createOffer,
  decideOffer,
  acceptOffer,
  asId,
};
