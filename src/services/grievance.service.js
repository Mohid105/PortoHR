'use strict';

const ErCase = require('../models/ErCase');
const ApiError = require('../utils/ApiError');
const { ROLES } = require('../config/roles');
const {
  CASE_TYPE_LABELS,
  CASE_STATUS_LABELS,
  ACTION_TYPE_LABELS,
  DECISION_OUTCOME_LABELS,
  PARTY_ROLE_LABELS,
} = require('../config/grievance');

function asId(value) {
  return String((value && (value._id || value.id || value)) || '');
}

function actorName(user) {
  if (!user) return '';
  return `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || 'User';
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

function isoDay(value) {
  if (!value) return '';
  const day = new Date(value);
  const y = day.getFullYear();
  const m = String(day.getMonth() + 1).padStart(2, '0');
  const d = String(day.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function nextCode() {
  const rows = await ErCase.find({ code: /^ER-/ }).select('code').lean();
  let max = 1000;
  rows.forEach((row) => {
    const n = Number(String(row.code).replace(/\D/g, ''));
    if (n > max) max = n;
  });
  return `ER-${max + 1}`;
}

function isParty(viewer, doc) {
  if (!viewer) return false;
  const id = String(viewer._id);
  if (String(doc.subject) === id || String(doc.complainant) === id) return true;
  return (doc.parties || []).some((row) => String(row.employee) === id);
}

function accessFor(user, viewer, doc) {
  if (user.role === ROLES.HR_ADMIN) return 'full';
  if (isParty(viewer, doc)) return 'party';
  return null;
}

function pushEvent(doc, user, action, note, visibility) {
  doc.timeline.push({
    at: new Date(),
    actorName: actorName(user),
    action,
    note: String(note || '').trim(),
    visibility: visibility || 'parties',
  });
}

function presentParty(row) {
  return {
    employee: asId(row.employee),
    role: row.role,
    roleLabel: PARTY_ROLE_LABELS[row.role] || row.role,
    fullName: row.snapshot && row.snapshot.fullName,
    employeeCode: row.snapshot && row.snapshot.employeeCode,
    designation: row.snapshot && row.snapshot.designation,
  };
}

function presentCase(doc, access) {
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  json.subject = asId(json.subject);
  json.complainant = asId(json.complainant);
  json.typeLabel = CASE_TYPE_LABELS[json.type] || json.type;
  json.statusLabel = CASE_STATUS_LABELS[json.status] || json.status;
  json.holder = json.snapshot && json.snapshot.fullName ? json.snapshot.fullName : '';
  json.openedOn = isoDay(json.createdAt);
  json.closedAt = isoDay(json.closedAt);
  json.parties = (json.parties || []).map(presentParty);
  json.hearing = {
    scheduledOn: isoDay(json.hearing && json.hearing.scheduledOn),
    location: (json.hearing && json.hearing.location) || '',
    outcome: (json.hearing && json.hearing.outcome) || '',
  };
  json.decision = {
    outcome: json.decision && json.decision.outcome,
    outcomeLabel: json.decision && json.decision.outcome
      ? DECISION_OUTCOME_LABELS[json.decision.outcome] || json.decision.outcome
      : '',
    actionType: json.decision && json.decision.actionType,
    actionLabel: json.decision && json.decision.actionType
      ? ACTION_TYPE_LABELS[json.decision.actionType] || json.decision.actionType
      : '',
    note: (json.decision && json.decision.note) || '',
    coreHrNote: (json.decision && json.decision.coreHrNote) || '',
    decidedAt: json.decision && json.decision.decidedAt ? isoDay(json.decision.decidedAt) : '',
  };
  json.documents = (json.documents || []).map((row) => ({
    title: row.title,
    url: row.url,
    classification: row.classification,
    addedAt: isoDay(row.addedAt),
  }));
  json.timeline = (json.timeline || []).map((row) => ({
    at: row.at,
    actorName: row.actorName,
    action: row.action,
    note: row.note,
    visibility: row.visibility,
  }));
  json.investigationNotes = (json.investigationNotes || []).map((row) => ({
    at: row.at,
    authorName: row.authorName,
    body: row.body,
  }));

  if (access !== 'full') {
    json.investigationNotes = [];
    json.timeline = json.timeline.filter((row) => row.visibility === 'parties');
    json.documents = json.documents.filter((row) => row.classification === 'general');
    json.decision.coreHrNote = '';
  }
  json.access = access;
  return json;
}

async function openCase(body, user, complainant, subject) {
  if (!subject) throw ApiError.badRequest('A subject employee is required');
  const summary = String(body.summary || '').trim();
  if (summary.length < 8) throw ApiError.badRequest('Give a short case summary (8+ characters)');
  const type = body.type || 'grievance';
  const parties = [
    { employee: subject._id, role: 'subject', snapshot: snapshotOf(subject) },
  ];
  if (complainant && String(complainant._id) !== String(subject._id)) {
    parties.unshift({ employee: complainant._id, role: 'complainant', snapshot: snapshotOf(complainant) });
  } else if (complainant) {
    parties[0].role = 'subject';
    parties.unshift({ employee: complainant._id, role: 'complainant', snapshot: snapshotOf(complainant) });
  }

  const doc = await ErCase.create({
    code: await nextCode(),
    type,
    status: 'intake',
    summary,
    description: String(body.description || '').trim(),
    department: subject.department || '',
    subject: subject._id,
    complainant: complainant ? complainant._id : null,
    snapshot: snapshotOf(subject),
    parties,
    submittedBy: user._id,
    timeline: [
      {
        at: new Date(),
        actorName: actorName(user),
        action: 'intake',
        note: summary,
        visibility: 'parties',
      },
    ],
  });
  return presentCase(doc, 'full');
}

async function triage(doc, user, body) {
  if (doc.status !== 'intake') throw ApiError.conflict('Only an intake case can be triaged');
  const next = body.status === 'rejected' ? 'rejected' : 'investigation';
  const note = String(body.note || '').trim();
  if (next === 'rejected' && !note) throw ApiError.badRequest('Give a reason when rejecting a case');
  doc.status = next;
  if (next === 'rejected') doc.closedAt = new Date();
  pushEvent(doc, user, next === 'rejected' ? 'rejected' : 'triaged', note, 'parties');
  await doc.save();
  return presentCase(doc, 'full');
}

async function addNote(doc, user, body) {
  if (['closed', 'rejected'].indexOf(doc.status) !== -1) {
    throw ApiError.conflict('A closed case cannot take investigation notes');
  }
  const text = String(body.body || '').trim();
  if (text.length < 4) throw ApiError.badRequest('Investigation notes need a few words');
  if (doc.status === 'intake') doc.status = 'investigation';
  doc.investigationNotes.push({ at: new Date(), authorName: actorName(user), body: text });
  pushEvent(doc, user, 'investigation_updated', '', 'hr');
  await doc.save();
  return presentCase(doc, 'full');
}

async function scheduleHearing(doc, user, body) {
  if (['intake', 'closed', 'rejected'].indexOf(doc.status) !== -1) {
    throw ApiError.conflict('Schedule a hearing after intake has been triaged');
  }
  if (!body.scheduledOn) throw ApiError.badRequest('A hearing date is required');
  doc.hearing = {
    scheduledOn: new Date(body.scheduledOn),
    location: String(body.location || '').trim(),
    outcome: String(body.outcome || '').trim(),
  };
  doc.status = 'hearing';
  pushEvent(doc, user, 'hearing_scheduled', doc.hearing.location, 'parties');
  await doc.save();
  return presentCase(doc, 'full');
}

async function recordDecision(doc, user, body) {
  if (['closed', 'rejected'].indexOf(doc.status) !== -1) {
    throw ApiError.conflict('A closed case cannot take a new decision');
  }
  const outcome = body.outcome || 'informal_resolution';
  const actionType = body.actionType || 'none';
  const note = String(body.note || '').trim();
  if (!note) throw ApiError.badRequest('Record a decision note for the case file');
  let coreHrNote = '';
  if (actionType === 'termination' || actionType === 'suspension') {
    coreHrNote = 'Process the employment change in Core HR — this case file does not alter the personnel record.';
  }
  doc.decision = {
    outcome,
    actionType,
    note,
    coreHrNote,
    decidedAt: new Date(),
    decidedBy: user._id,
  };
  doc.status = 'decision';
  pushEvent(doc, user, 'decision', `${ACTION_TYPE_LABELS[actionType] || actionType}: ${note}`, 'parties');
  await doc.save();
  return presentCase(doc, 'full');
}

async function appeal(doc, user, body) {
  if (doc.status !== 'decision') throw ApiError.conflict('Only a decided case can be appealed');
  const reason = String(body.reason || '').trim();
  if (reason.length < 8) throw ApiError.badRequest('Give a short appeal reason');
  doc.status = 'appeal';
  doc.appealReason = reason;
  pushEvent(doc, user, 'appeal', reason, 'parties');
  await doc.save();
  return presentCase(doc, 'full');
}

async function closeCase(doc, user, body) {
  if (['closed', 'rejected'].indexOf(doc.status) !== -1) {
    throw ApiError.conflict('This case is already closed');
  }
  if (['decision', 'appeal', 'investigation', 'hearing'].indexOf(doc.status) === -1) {
    throw ApiError.badRequest('Close a case after investigation or a decision');
  }
  doc.status = 'closed';
  doc.closedAt = new Date();
  pushEvent(doc, user, 'closed', body && body.note, 'parties');
  await doc.save();
  return presentCase(doc, 'full');
}

async function addDocument(doc, user, body) {
  const title = String(body.title || '').trim();
  if (title.length < 3) throw ApiError.badRequest('Document title is required');
  doc.documents.push({
    title,
    url: String(body.url || '').trim(),
    classification: body.classification || 'restricted',
    addedAt: new Date(),
  });
  pushEvent(doc, user, 'document_added', title, body.classification === 'general' ? 'parties' : 'hr');
  await doc.save();
  return presentCase(doc, 'full');
}

async function analytics() {
  const rows = await ErCase.find().select('type status department').lean();
  const tally = (field) => {
    const map = {};
    rows.forEach((row) => {
      const key = row[field] || 'unspecified';
      map[key] = (map[key] || 0) + 1;
    });
    return Object.keys(map).map((key) => ({ key, count: map[key] }));
  };
  return {
    total: rows.length,
    open: rows.filter((row) => ['closed', 'rejected'].indexOf(row.status) === -1).length,
    closed: rows.filter((row) => row.status === 'closed' || row.status === 'rejected').length,
    byType: tally('type').map((row) => ({ type: row.key, label: CASE_TYPE_LABELS[row.key] || row.key, count: row.count })),
    byStatus: tally('status').map((row) => ({ status: row.key, label: CASE_STATUS_LABELS[row.key] || row.key, count: row.count })),
    byDepartment: tally('department').map((row) => ({ department: row.key, count: row.count })),
  };
}

module.exports = {
  asId,
  snapshotOf,
  accessFor,
  isParty,
  presentCase,
  openCase,
  triage,
  addNote,
  scheduleHearing,
  recordDecision,
  appeal,
  closeCase,
  addDocument,
  analytics,
};
