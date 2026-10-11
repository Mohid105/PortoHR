'use strict';

const FamilyMember = require('../models/FamilyMember');
const Address = require('../models/Address');
const Qualification = require('../models/Qualification');
const WorkExperience = require('../models/WorkExperience');
const EmployeeReward = require('../models/EmployeeReward');
const EmployeeDocument = require('../models/EmployeeDocument');
const BankAccount = require('../models/BankAccount');
const StatutoryEnrollment = require('../models/StatutoryEnrollment');
const AuditLog = require('../models/AuditLog');
const ApiError = require('../utils/ApiError');
const { maskAccount, maskNationalId } = require('../utils/mask');

function present(doc) {
  if (!doc) return null;
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  return json;
}

function presentBank(doc, reveal) {
  const json = present(doc);
  if (!json) return null;
  if (!reveal) {
    json.accountNumber = maskAccount(json.accountNumber);
    json.iban = maskAccount(json.iban);
    json.masked = true;
  }
  return json;
}

function presentStatutory(doc, reveal) {
  const json = present(doc);
  if (!json) return null;
  if (!reveal) {
    json.membershipNumber = maskNationalId(json.membershipNumber);
    json.masked = true;
  }
  return json;
}

async function loadProfileExtras(employee, options) {
  const revealPayment = Boolean(options && options.revealPayment);
  const personId = employee.person;
  const employeeId = employee._id;

  const [family, addresses, qualifications, experience, rewards, documents, banks, statutory, audit] = await Promise.all([
    FamilyMember.find({ person: personId }).sort({ isEmergency: -1, name: 1 }),
    Address.find({ person: personId }).sort({ type: 1, createdAt: -1 }),
    Qualification.find({ person: personId }).sort({ issuedOn: -1 }),
    WorkExperience.find({ person: personId }).sort({ toYear: -1, fromYear: -1 }),
    EmployeeReward.find({ employee: employeeId }).sort({ awardedOn: -1 }),
    EmployeeDocument.find({ employee: employeeId }).sort({ type: 1, version: -1 }),
    BankAccount.find({ employee: employeeId }).sort({ createdAt: -1 }),
    StatutoryEnrollment.find({ employee: employeeId }).sort({ scheme: 1, createdAt: -1 }),
    AuditLog.find({ employee: employeeId }).sort({ createdAt: -1 }).limit(50),
  ]);

  const now = new Date();
  const soon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  return {
    family: family.map(present),
    addresses: addresses.map(present),
    qualifications: qualifications.map(present),
    experience: experience.map(present),
    rewards: rewards.map(present),
    documents: documents.map((doc) => {
      const json = present(doc);
      json.expiringSoon = Boolean(json.expiresOn && new Date(json.expiresOn) <= soon);
      json.expired = Boolean(json.expiresOn && new Date(json.expiresOn) < now);
      return json;
    }),
    bankAccounts: banks.map((row) => presentBank(row, revealPayment)),
    statutory: statutory.map((row) => presentStatutory(row, revealPayment)),
    audit: audit.map(present),
  };
}

async function saveFamily(personId, employeeId, body) {
  if (!body.name) throw ApiError.badRequest('Name is required');
  if (body.id) {
    const row = await FamilyMember.findOne({ _id: body.id, person: personId });
    if (!row) throw ApiError.notFound('Family member not found');
    row.set(body);
    await row.save();
    return present(row);
  }
  const row = await FamilyMember.create(Object.assign({}, body, { person: personId }));
  return present(row);
}

async function saveAddress(personId, body) {
  if (body.id) {
    const row = await Address.findOne({ _id: body.id, person: personId });
    if (!row) throw ApiError.notFound('Address not found');
    row.set(body);
    await row.save();
    return present(row);
  }
  if (body.type) {
    await Address.updateMany(
      { person: personId, type: body.type, status: 'active' },
      { $set: { status: 'superseded', effectiveTo: new Date() } }
    );
  }
  const row = await Address.create(Object.assign({}, body, { person: personId, status: 'active' }));
  return present(row);
}

async function saveQualification(personId, employeeId, body) {
  if (!body.title) throw ApiError.badRequest('Title is required');
  if (body.id) {
    const row = await Qualification.findOne({ _id: body.id, person: personId });
    if (!row) throw ApiError.notFound('Qualification not found');
    row.set(body);
    await row.save();
    return present(row);
  }
  const row = await Qualification.create(Object.assign({}, body, { person: personId, employee: employeeId }));
  return present(row);
}

async function saveExperience(personId, employeeId, body) {
  if (!body.organization) throw ApiError.badRequest('Organization is required');
  const clean = (value) => (value === undefined || value === '' ? null : Number(value));
  const fields = {
    organization: body.organization,
    designation: body.designation,
    leavingCause: body.leavingCause,
    description: body.description,
    fromYear: clean(body.fromYear),
    toYear: clean(body.toYear),
  };
  if (fields.fromYear && fields.toYear && fields.toYear < fields.fromYear) {
    throw ApiError.badRequest('The end year cannot be before the start year');
  }
  const row = await WorkExperience.create(Object.assign(fields, { person: personId, employee: employeeId }));
  return present(row);
}

async function saveReward(employeeId, userId, body) {
  if (!body.reward) throw ApiError.badRequest('Name the reward or award');
  const row = await EmployeeReward.create({
    employee: employeeId,
    authority: body.authority || '',
    reward: body.reward,
    description: body.description || '',
    awardedOn: body.awardedOn || new Date(),
    recordedBy: userId,
  });
  return present(row);
}

async function saveDocument(employeeId, personId, userId, body) {
  if (!body.type) throw ApiError.badRequest('Document type is required');
  const latest = await EmployeeDocument.findOne({ employee: employeeId, type: body.type }).sort({ version: -1 });
  const version = latest ? latest.version + 1 : 1;
  const row = await EmployeeDocument.create({
    employee: employeeId,
    person: personId,
    type: body.type,
    title: body.title || '',
    reference: body.reference || '',
    documentDate: body.documentDate || new Date(),
    issuedOn: body.issuedOn || null,
    expiresOn: body.expiresOn || null,
    version,
    verificationStatus: body.verificationStatus || 'unverified',
    confidentiality: body.confidentiality || 'general',
    notes: body.notes || '',
    uploadedBy: userId,
  });
  return present(row);
}

async function saveBank(employee, user, body) {
  const existing = await BankAccount.findOne({ employee: employee._id, status: 'pending' });
  if (existing) throw ApiError.conflict('A bank change is already waiting for approval');

  const active = await BankAccount.findOne({ employee: employee._id, status: 'active' });
  const row = await BankAccount.create({
    employee: employee._id,
    person: employee.person,
    method: body.method || 'bank_transfer',
    bankName: body.bankName || '',
    branch: body.branch || '',
    city: body.city || '',
    accountTitle: body.accountTitle || '',
    accountNumber: body.accountNumber || '',
    iban: body.iban || '',
    effectiveFrom: body.effectiveFrom || new Date(),
    status: 'pending',
    reason: body.reason || '',
    requestedBy: user._id,
  });
  return { pending: presentBank(row, true), previous: active && presentBank(active, false) };
}

async function decideBank(row, user, status, note) {
  if (row.status !== 'pending') throw ApiError.conflict('This bank change has already been decided');
  if (status === 'rejected' && !String(note || '').trim()) {
    throw ApiError.badRequest('A rejection needs a short note');
  }
  row.decidedBy = user._id;
  row.decidedAt = new Date();
  row.decisionNote = String(note || '').trim();
  if (status !== 'approved') {
    row.status = 'rejected';
    await row.save();
    return row;
  }
  await BankAccount.updateMany(
    { employee: row.employee, status: 'active', _id: { $ne: row._id } },
    { $set: { status: 'superseded', effectiveTo: row.effectiveFrom } }
  );
  row.status = 'active';
  await row.save();
  return row;
}

async function saveStatutory(employee, user, body) {
  if (!body.scheme) throw ApiError.badRequest('Scheme is required');
  const row = await StatutoryEnrollment.create({
    employee: employee._id,
    person: employee.person,
    scheme: body.scheme,
    covered: body.covered !== false,
    membershipNumber: body.membershipNumber || '',
    effectiveFrom: body.effectiveFrom || new Date(),
    effectiveTo: body.effectiveTo || null,
    status: 'pending',
    reason: body.reason || '',
    requestedBy: user._id,
  });
  return presentStatutory(row, true);
}

async function decideStatutory(row, user, status, note) {
  if (row.status !== 'pending') throw ApiError.conflict('This enrolment has already been decided');
  row.decidedBy = user._id;
  row.decidedAt = new Date();
  row.decisionNote = String(note || '').trim();
  if (status !== 'approved') {
    row.status = 'rejected';
    await row.save();
    return row;
  }
  await StatutoryEnrollment.updateMany(
    { employee: row.employee, scheme: row.scheme, status: 'active', _id: { $ne: row._id } },
    { $set: { status: 'ended', effectiveTo: row.effectiveFrom } }
  );
  row.status = 'active';
  await row.save();
  return row;
}

async function collectAlerts(scopeIds) {
  const now = new Date();
  const soon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const employeeFilter = scopeIds ? { employee: { $in: scopeIds } } : {};
  const Employee = require('../models/Employee');
  const Assignment = require('../models/Assignment');

  const [expiringDocs, probation, pendingAssign, pendingBank, missingPosition] = await Promise.all([
    EmployeeDocument.find(Object.assign({}, employeeFilter, { expiresOn: { $gte: now, $lte: soon } }))
      .populate('employee', 'firstName lastName employeeCode')
      .limit(50),
    Employee.find(
      Object.assign({}, scopeIds ? { _id: { $in: scopeIds } } : {}, {
        employmentStatus: 'probation',
        probationEndDate: { $lte: soon },
      })
    )
      .select('firstName lastName employeeCode probationEndDate')
      .limit(50),
    Assignment.find(Object.assign({}, employeeFilter, { status: 'pending' }))
      .populate('employee', 'firstName lastName employeeCode')
      .limit(50),
    BankAccount.find(Object.assign({}, employeeFilter, { status: 'pending' }))
      .populate('employee', 'firstName lastName employeeCode')
      .limit(50),
    Employee.find(
      Object.assign({}, scopeIds ? { _id: { $in: scopeIds } } : {}, {
        employmentStatus: { $in: ['probation', 'confirmed', 'notice_period'] },
        currentPosition: null,
      })
    )
      .select('firstName lastName employeeCode')
      .limit(50),
  ]);

  const items = [];
  expiringDocs.forEach((doc) => {
    items.push({
      type: 'document_expiry',
      severity: 'medium',
      employee: doc.employee,
      message: `${doc.type} expires on ${new Date(doc.expiresOn).toISOString().slice(0, 10)}`,
    });
  });
  probation.forEach((row) => {
    items.push({
      type: 'probation_due',
      severity: 'medium',
      employee: { id: String(row._id), fullName: row.fullName, employeeCode: row.employeeCode },
      message: `Probation ends ${row.probationEndDate ? row.probationEndDate.toISOString().slice(0, 10) : 'soon'}`,
    });
  });
  pendingAssign.forEach((row) => {
    items.push({
      type: 'pending_assignment',
      severity: 'high',
      employee: row.employee,
      message: `${row.event || 'Assignment'} waiting for approval`,
    });
  });
  pendingBank.forEach((row) => {
    items.push({
      type: 'pending_bank',
      severity: 'high',
      employee: row.employee,
      message: 'Bank / payment change waiting for approval',
    });
  });
  missingPosition.forEach((row) => {
    items.push({
      type: 'missing_position',
      severity: 'high',
      employee: { id: String(row._id), fullName: row.fullName, employeeCode: row.employeeCode },
      message: 'Active employee has no approved position',
    });
  });
  return items;
}

module.exports = {
  present,
  presentBank,
  presentStatutory,
  loadProfileExtras,
  saveFamily,
  saveAddress,
  saveQualification,
  saveExperience,
  saveReward,
  saveDocument,
  saveBank,
  decideBank,
  saveStatutory,
  decideStatutory,
  collectAlerts,
};
