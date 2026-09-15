'use strict';

const Course = require('../models/Course');
const TrainingSession = require('../models/TrainingSession');
const Enrollment = require('../models/Enrollment');
const CertificationRecord = require('../models/CertificationRecord');
const Competency = require('../models/Competency');
const ApiError = require('../utils/ApiError');
const { ROLES } = require('../config/roles');
const {
  DELIVERY_LABELS,
  COURSE_STATUS_LABELS,
  ENROLLMENT_STATUS_LABELS,
  SOURCE_LABELS,
  SESSION_STATUS_LABELS,
  CERT_STATUS_LABELS,
  EXPIRING_WITHIN_DAYS,
} = require('../config/lms');

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

function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function certStatus(expiresAt, now = new Date()) {
  if (!expiresAt) return 'valid';
  const expiry = new Date(expiresAt);
  if (expiry < now) return 'expired';
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + EXPIRING_WITHIN_DAYS);
  if (expiry <= horizon) return 'expiring';
  return 'valid';
}

function isOverdue(enrollment, now = new Date()) {
  return Boolean(
    enrollment.status === 'enrolled' &&
      enrollment.dueDate &&
      new Date(enrollment.dueDate) < startOfDay(now)
  );
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

function presentCourse(doc) {
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  json.deliveryLabel = DELIVERY_LABELS[json.delivery] || json.delivery;
  json.statusLabel = COURSE_STATUS_LABELS[json.status] || json.status;
  json.prerequisites = (json.prerequisites || []).map((row) =>
    row && row.title
      ? { id: String(row._id || row.id), title: row.title, code: row.code }
      : { id: asId(row) }
  );
  return json;
}

function presentSession(doc) {
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  json.course = json.course && json.course.title
    ? {
        id: String(json.course._id || json.course.id),
        title: json.course.title,
        code: json.course.code,
        delivery: json.course.delivery,
      }
    : { id: asId(json.course) };
  json.statusLabel = SESSION_STATUS_LABELS[json.status] || json.status;
  json.startsAt = json.startsAt ? new Date(json.startsAt).toISOString() : '';
  json.endsAt = json.endsAt ? new Date(json.endsAt).toISOString() : '';
  json.day = json.startsAt ? new Date(json.startsAt).toISOString().slice(0, 10) : '';
  return json;
}

function presentEnrollment(doc) {
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  json.employee = asId(json.employee);
  json.courseId = json.course && json.course.title ? String(json.course._id || json.course.id) : asId(json.course);
  json.courseTitle = json.course && json.course.title ? json.course.title : '';
  json.courseCode = json.course && json.course.code ? json.course.code : '';
  json.delivery = json.course && json.course.delivery ? json.course.delivery : '';
  json.deliveryLabel = DELIVERY_LABELS[json.delivery] || json.delivery;
  json.sessionId = asId(json.session);
  json.statusLabel = ENROLLMENT_STATUS_LABELS[json.status] || json.status;
  json.sourceLabel = SOURCE_LABELS[json.source] || json.source;
  json.overdue = isOverdue(json);
  json.dueDate = json.dueDate ? new Date(json.dueDate).toISOString().slice(0, 10) : '';
  json.learner = json.snapshot && json.snapshot.fullName ? json.snapshot.fullName : '';
  return json;
}

function presentCert(doc) {
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  json.courseId = json.course && json.course.title ? String(json.course._id || json.course.id) : asId(json.course);
  json.courseTitle = json.course && json.course.title ? json.course.title : json.title;
  json.issuedAt = json.issuedAt ? new Date(json.issuedAt).toISOString().slice(0, 10) : '';
  json.expiresAt = json.expiresAt ? new Date(json.expiresAt).toISOString().slice(0, 10) : '';
  json.status = certStatus(json.expiresAt);
  json.statusLabel = CERT_STATUS_LABELS[json.status];
  if (json.employee && json.employee.firstName) {
    json.holder = `${json.employee.firstName} ${json.employee.lastName || ''}`.trim();
  } else {
    json.holder = '';
  }
  json.employee = asId(json.employee);
  return json;
}

function presentCompetency(doc) {
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  return json;
}

function canAssign(user, viewer, employee) {
  if (user.role === ROLES.HR_ADMIN) return true;
  if (user.role === ROLES.MANAGER && viewer && employee && String(employee.reportsTo) === String(viewer._id)) {
    return true;
  }
  return false;
}

async function populateEnrollment(id) {
  return Enrollment.findById(id)
    .populate('course', 'code title delivery mandatory issuesCertificate url')
    .populate('session', 'startsAt endsAt location instructorName status');
}

async function assertPrerequisites(course, employeeId) {
  const required = course.prerequisites || [];
  if (!required.length) return;
  const done = await Enrollment.find({
    employee: employeeId,
    course: { $in: required },
    status: 'completed',
  }).select('course');
  const have = new Set(done.map((row) => String(row.course)));
  const missing = required.filter((id) => !have.has(String(id._id || id)));
  if (missing.length) {
    throw ApiError.badRequest('Complete the prerequisite courses before requesting this one');
  }
}

async function createCourse(body) {
  const title = String(body.title || '').trim();
  if (title.length < 3) throw ApiError.badRequest('Course title must be at least 3 characters');
  const course = await Course.create({
    code: body.code || (await nextCode(Course, 'CRS', 'code')),
    title,
    summary: String(body.summary || '').trim(),
    delivery: body.delivery || 'elearning',
    durationHours: Number(body.durationHours) || 1,
    competencies: Array.isArray(body.competencies)
      ? body.competencies
      : String(body.competencies || '')
          .split(',')
          .map((item) => item.trim().toUpperCase())
          .filter(Boolean),
    prerequisites: body.prerequisites || [],
    mandatory: Boolean(body.mandatory),
    issuesCertificate: Boolean(body.issuesCertificate),
    validityMonths: Number(body.validityMonths) || 0,
    url: String(body.url || '').trim(),
    provider: String(body.provider || '').trim(),
    status: body.status || 'published',
  });
  return presentCourse(await Course.findById(course._id).populate('prerequisites', 'code title'));
}

async function updateCourse(course, body) {
  ['title', 'summary', 'delivery', 'url', 'provider', 'status'].forEach((field) => {
    if (body[field] !== undefined) course[field] = body[field];
  });
  if (body.durationHours !== undefined) course.durationHours = Number(body.durationHours);
  if (body.mandatory !== undefined) course.mandatory = body.mandatory === true || body.mandatory === 'true';
  if (body.issuesCertificate !== undefined) {
    course.issuesCertificate = body.issuesCertificate === true || body.issuesCertificate === 'true';
  }
  if (body.validityMonths !== undefined) course.validityMonths = Number(body.validityMonths) || 0;
  if (body.competencies !== undefined) {
    course.competencies = Array.isArray(body.competencies)
      ? body.competencies
      : String(body.competencies || '')
          .split(',')
          .map((item) => item.trim().toUpperCase())
          .filter(Boolean);
  }
  await course.save();
  return presentCourse(await Course.findById(course._id).populate('prerequisites', 'code title'));
}

async function createSession(body) {
  if (!body.course) throw ApiError.badRequest('A course is required');
  const course = await Course.findById(body.course);
  if (!course) throw ApiError.notFound('Course not found');
  if (course.delivery !== 'instructor_led') {
    throw ApiError.badRequest('Sessions can only be scheduled for instructor-led courses');
  }
  if (!body.startsAt || !body.endsAt) throw ApiError.badRequest('Start and end times are required');
  const startsAt = new Date(body.startsAt);
  const endsAt = new Date(body.endsAt);
  if (!(startsAt < endsAt)) throw ApiError.badRequest('The session must end after it starts');
  const session = await TrainingSession.create({
    course: course._id,
    startsAt,
    endsAt,
    location: String(body.location || '').trim(),
    instructorName: String(body.instructorName || '').trim(),
    capacity: Number(body.capacity) || 20,
  });
  return presentSession(await TrainingSession.findById(session._id).populate('course', 'code title delivery'));
}

async function createEnrollment(body, user, viewer, target) {
  if (!target) throw ApiError.badRequest('A learner is required');
  const course = await Course.findById(body.course);
  if (!course || course.status !== 'published') throw ApiError.notFound('That course is not open');

  const assigningOthers = String(target._id) !== String(viewer && viewer._id);
  if (assigningOthers && !canAssign(user, viewer, target)) {
    throw ApiError.forbidden('You can only nominate people who report to you');
  }
  if (!assigningOthers && user.role === ROLES.EMPLOYEE) {
    await assertPrerequisites(course, target._id);
  }

  let session = null;
  if (body.session) {
    session = await TrainingSession.findById(body.session);
    if (!session || String(session.course) !== String(course._id)) {
      throw ApiError.badRequest('That session does not belong to this course');
    }
    if (session.status !== 'scheduled') throw ApiError.conflict('That session is no longer open');
    const taken = await Enrollment.countDocuments({
      session: session._id,
      status: { $in: ['pending', 'enrolled', 'completed'] },
    });
    if (taken >= session.capacity) throw ApiError.conflict('That session is full');
  } else if (course.delivery === 'instructor_led') {
    throw ApiError.badRequest('Pick a session from the training calendar');
  }

  const autoEnroll = assigningOthers || user.role === ROLES.HR_ADMIN;
  let source = 'self';
  if (body.mandatory || course.mandatory && autoEnroll) source = 'mandatory';
  else if (user.role === ROLES.HR_ADMIN && assigningOthers) source = 'hr';
  else if (user.role === ROLES.MANAGER && assigningOthers) source = 'manager';

  let dueDate = body.dueDate ? new Date(body.dueDate) : null;
  if (!dueDate && source === 'mandatory') {
    dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);
  }

  try {
    const enrollment = await Enrollment.create({
      employee: target._id,
      snapshot: snapshotOf(target),
      course: course._id,
      session: session && session._id,
      source,
      status: autoEnroll ? 'enrolled' : 'pending',
      dueDate,
      submittedBy: user._id,
      decidedBy: autoEnroll ? user._id : null,
      decidedAt: autoEnroll ? new Date() : null,
    });
    return presentEnrollment(await populateEnrollment(enrollment._id));
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('This person already has an open enrollment on that course');
    throw err;
  }
}

async function decideEnrollment(enrollment, user, status, note) {
  if (enrollment.status !== 'pending') {
    throw ApiError.conflict('This request is no longer waiting for a decision');
  }
  if (['approved', 'enrolled', 'rejected'].indexOf(status) === -1) {
    throw ApiError.badRequest('A learning decision must be enrolled or rejected');
  }
  const decisionNote = String(note || '').trim();
  if (status === 'rejected' && !decisionNote) {
    throw ApiError.badRequest('Please give a reason when rejecting a nomination');
  }
  enrollment.status = status === 'rejected' ? 'rejected' : 'enrolled';
  enrollment.decisionNote = decisionNote;
  enrollment.decidedBy = user._id;
  enrollment.decidedAt = new Date();
  await enrollment.save();
  return presentEnrollment(await populateEnrollment(enrollment._id));
}

async function markAttendance(enrollment, present) {
  if (enrollment.status !== 'enrolled' && enrollment.status !== 'no_show') {
    throw ApiError.conflict('Attendance can only be captured on an active enrollment');
  }
  if (!enrollment.session) throw ApiError.badRequest('This enrollment is not tied to a classroom session');
  enrollment.attended = Boolean(present);
  enrollment.status = enrollment.attended ? 'enrolled' : 'no_show';
  await enrollment.save();
  return presentEnrollment(await populateEnrollment(enrollment._id));
}

async function completeEnrollment(enrollment, body) {
  if (enrollment.status !== 'enrolled') {
    throw ApiError.conflict('Only an enrolled learner can be marked complete');
  }
  if (enrollment.session && enrollment.attended !== true) {
    throw ApiError.badRequest('Mark attendance present before completing a classroom course');
  }
  const course = await Course.findById(enrollment.course);
  enrollment.status = 'completed';
  enrollment.completedAt = new Date();
  if (body.feedbackScore) enrollment.feedbackScore = Number(body.feedbackScore);
  if (body.feedbackNote) enrollment.feedbackNote = String(body.feedbackNote).trim();
  await enrollment.save();

  let cert = null;
  if (course && course.issuesCertificate) {
    const issuedAt = enrollment.completedAt;
    const expiresAt = course.validityMonths ? addMonths(issuedAt, course.validityMonths) : null;
    cert = await CertificationRecord.create({
      employee: enrollment.employee,
      course: course._id,
      enrollment: enrollment._id,
      title: `${course.title} certificate`,
      issuedAt,
      expiresAt,
    });
  }

  return {
    enrollment: presentEnrollment(await populateEnrollment(enrollment._id)),
    certification: cert ? presentCert(cert) : null,
  };
}

async function cancelEnrollment(enrollment) {
  if (['completed', 'cancelled', 'rejected'].indexOf(enrollment.status) !== -1) {
    throw ApiError.conflict('This enrollment cannot be cancelled');
  }
  enrollment.status = 'cancelled';
  await enrollment.save();
  return presentEnrollment(await populateEnrollment(enrollment._id));
}

async function competencyGap(employeeId) {
  const [catalogue, completed] = await Promise.all([
    Course.find({ status: 'published' }).select('code title competencies mandatory'),
    Enrollment.find({ employee: employeeId, status: 'completed' }).populate('course', 'competencies title'),
  ]);
  const held = new Set();
  completed.forEach((row) => {
    ((row.course && row.course.competencies) || []).forEach((code) => held.add(code));
  });
  const required = new Set();
  catalogue.forEach((course) => {
    if (course.mandatory) (course.competencies || []).forEach((code) => required.add(code));
  });
  const all = await Competency.find().sort({ name: 1 });
  return all.map((row) => ({
    id: String(row._id),
    code: row.code,
    name: row.name,
    category: row.category,
    held: held.has(row.code),
    required: required.has(row.code),
    gap: required.has(row.code) && !held.has(row.code),
  }));
}

module.exports = {
  asId,
  snapshotOf,
  certStatus,
  isOverdue,
  presentCourse,
  presentSession,
  presentEnrollment,
  presentCert,
  presentCompetency,
  canAssign,
  populateEnrollment,
  createCourse,
  updateCourse,
  createSession,
  createEnrollment,
  decideEnrollment,
  markAttendance,
  completeEnrollment,
  cancelEnrollment,
  competencyGap,
};
