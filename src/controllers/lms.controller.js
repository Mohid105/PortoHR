'use strict';

const mongoose = require('mongoose');
const Course = require('../models/Course');
const TrainingSession = require('../models/TrainingSession');
const Enrollment = require('../models/Enrollment');
const CertificationRecord = require('../models/CertificationRecord');
const Competency = require('../models/Competency');
const Employee = require('../models/Employee');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/roles');
const { metaPayload, EXPIRING_WITHIN_DAYS } = require('../config/lms');
const { resolveViewerEmployee, canDecideFor, visibleEmployeeIds } = require('../services/employeeAccess');
const lms = require('../services/lms.service');
const webhooks = require('../services/webhooks.service');

function requireId(id, label) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound(`${label} not found`);
}

async function scopedEmployeeFilter(user) {
  const ids = await visibleEmployeeIds(user);
  if (ids === null) return {};
  if (!ids.length) return { _id: null };
  return { employee: { $in: ids } };
}

const meta = asyncHandler(async (_req, res) => {
  const competencies = await Competency.find().sort({ name: 1 });
  res.json({
    success: true,
    meta: Object.assign(metaPayload(), {
      competencies: competencies.map(lms.presentCompetency),
    }),
  });
});

const listCourses = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.user.role === ROLES.EMPLOYEE) filter.status = 'published';
  else if (req.query.status) filter.status = req.query.status;
  else filter.status = { $in: ['published', 'draft'] };

  const rows = await Course.find(filter)
    .populate('prerequisites', 'code title')
    .sort({ mandatory: -1, title: 1 });
  res.json({ success: true, courses: rows.map(lms.presentCourse) });
});

const createCourse = asyncHandler(async (req, res) => {
  if (req.user.role !== ROLES.HR_ADMIN) throw ApiError.forbidden('Only HR can maintain the catalogue');
  const course = await lms.createCourse(req.body || {});
  res.status(201).json({ success: true, message: 'Course published', course });
});

const updateCourse = asyncHandler(async (req, res) => {
  if (req.user.role !== ROLES.HR_ADMIN) throw ApiError.forbidden('Only HR can maintain the catalogue');
  requireId(req.params.id, 'Course');
  const course = await Course.findById(req.params.id);
  if (!course) throw ApiError.notFound('Course not found');
  const presented = await lms.updateCourse(course, req.body || {});
  res.json({ success: true, message: 'Course updated', course: presented });
});

const listSessions = asyncHandler(async (req, res) => {
  const filter = { status: { $ne: 'cancelled' } };
  if (req.query.course) {
    requireId(req.query.course, 'Course');
    filter.course = req.query.course;
  }
  const rows = await TrainingSession.find(filter)
    .populate('course', 'code title delivery')
    .sort({ startsAt: 1 })
    .limit(100);
  const sessionIds = rows.map((row) => row._id);
  const counts = await Enrollment.aggregate([
    { $match: { session: { $in: sessionIds }, status: { $in: ['pending', 'enrolled', 'completed'] } } },
    { $group: { _id: '$session', total: { $sum: 1 } } },
  ]);
  const bySession = {};
  counts.forEach((row) => {
    bySession[String(row._id)] = row.total;
  });
  res.json({
    success: true,
    sessions: rows.map((row) =>
      Object.assign(lms.presentSession(row), {
        enrolledCount: bySession[String(row._id)] || 0,
        seatsLeft: Math.max(0, (row.capacity || 0) - (bySession[String(row._id)] || 0)),
      })
    ),
  });
});

const createSession = asyncHandler(async (req, res) => {
  if (req.user.role !== ROLES.HR_ADMIN) throw ApiError.forbidden('Only HR can schedule sessions');
  const session = await lms.createSession(req.body || {});
  res.status(201).json({ success: true, message: 'Session scheduled', session });
});

const listEnrollments = asyncHandler(async (req, res) => {
  const filter = await scopedEmployeeFilter(req.user);
  if (req.query.status) filter.status = req.query.status;
  if (req.query.course) {
    requireId(req.query.course, 'Course');
    filter.course = req.query.course;
  }
  const rows = await Enrollment.find(filter)
    .populate('course', 'code title delivery mandatory issuesCertificate url')
    .populate('session', 'startsAt endsAt location instructorName status')
    .sort({ updatedAt: -1 })
    .limit(200);
  res.json({ success: true, enrollments: rows.map(lms.presentEnrollment) });
});

const createEnrollment = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  if (!viewer && req.user.role === ROLES.EMPLOYEE) {
    throw ApiError.badRequest('Your login is not linked to an employee record yet');
  }
  const body = req.body || {};
  let target = viewer;
  if (body.employee) {
    requireId(body.employee, 'Employee');
    target = await Employee.findById(body.employee);
    if (!target) throw ApiError.notFound('Employee not found');
  }
  const presented = await lms.createEnrollment(body, req.user, viewer, target);
  res.status(201).json({
    success: true,
    message: presented.status === 'pending' ? 'Request submitted for approval' : 'Learner enrolled',
    enrollment: presented,
  });
});

const decideEnrollment = asyncHandler(async (req, res) => {
  requireId(req.params.id, 'Enrollment');
  const enrollment = await Enrollment.findById(req.params.id);
  if (!enrollment) throw ApiError.notFound('Enrollment not found');
  const learner = await Employee.findById(enrollment.employee);
  const viewer = await resolveViewerEmployee(req.user);
  if (!(await canDecideFor(req.user, viewer, learner || { _id: enrollment.employee, email: '' }, 'lms'))) {
    throw ApiError.forbidden('You are not the approver for this request');
  }
  let status = (req.body || {}).status;
  if (status === 'approved') status = 'enrolled';
  const presented = await lms.decideEnrollment(enrollment, req.user, status, (req.body || {}).decisionNote);
  webhooks.emitApprovalCompleted({
    kind: 'lms',
    decision: (req.body || {}).status,
    objectId: enrollment._id,
    employeeCode: learner && learner.employeeCode,
    fullName: learner && learner.fullName,
  });
  res.json({ success: true, message: `Enrollment ${presented.statusLabel.toLowerCase()}`, enrollment: presented });
});

const markAttendance = asyncHandler(async (req, res) => {
  if (req.user.role === ROLES.EMPLOYEE) throw ApiError.forbidden('Employees cannot mark classroom attendance');
  requireId(req.params.id, 'Enrollment');
  const enrollment = await Enrollment.findById(req.params.id);
  if (!enrollment) throw ApiError.notFound('Enrollment not found');
  const presented = await lms.markAttendance(enrollment, (req.body || {}).present !== false);
  res.json({ success: true, message: presented.attended ? 'Marked present' : 'Marked no-show', enrollment: presented });
});

const completeEnrollment = asyncHandler(async (req, res) => {
  requireId(req.params.id, 'Enrollment');
  const enrollment = await Enrollment.findById(req.params.id);
  if (!enrollment) throw ApiError.notFound('Enrollment not found');
  const viewer = await resolveViewerEmployee(req.user);
  const learner = await Employee.findById(enrollment.employee);
  const own = viewer && String(viewer._id) === String(enrollment.employee);
  if (!own && !lms.canAssign(req.user, viewer, learner)) {
    throw ApiError.forbidden('You cannot complete this enrollment');
  }
  const result = await lms.completeEnrollment(enrollment, req.body || {});
  res.json({
    success: true,
    message: result.certification ? 'Completed — certificate issued' : 'Course marked complete',
    ...result,
  });
});

const cancelEnrollment = asyncHandler(async (req, res) => {
  requireId(req.params.id, 'Enrollment');
  const enrollment = await Enrollment.findById(req.params.id);
  if (!enrollment) throw ApiError.notFound('Enrollment not found');
  const viewer = await resolveViewerEmployee(req.user);
  const own = viewer && String(viewer._id) === String(enrollment.employee);
  if (!own && req.user.role !== ROLES.HR_ADMIN) {
    throw ApiError.forbidden('You can only cancel your own request');
  }
  const presented = await lms.cancelEnrollment(enrollment);
  res.json({ success: true, message: 'Enrollment cancelled', enrollment: presented });
});

const myLearning = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  if (!viewer) {
    return res.json({ success: true, enrollments: [], certifications: [], overdueCount: 0, gap: [] });
  }
  const [enrollments, certifications, gap] = await Promise.all([
    Enrollment.find({ employee: viewer._id })
      .populate('course', 'code title delivery mandatory issuesCertificate url')
      .populate('session', 'startsAt endsAt location instructorName status')
      .sort({ updatedAt: -1 }),
    CertificationRecord.find({ employee: viewer._id }).populate('course', 'title code').sort({ issuedAt: -1 }),
    lms.competencyGap(viewer._id),
  ]);
  const presented = enrollments.map(lms.presentEnrollment);
  res.json({
    success: true,
    enrollments: presented,
    certifications: certifications.map(lms.presentCert),
    overdueCount: presented.filter((row) => row.overdue).length,
    gap,
  });
});

const compliance = asyncHandler(async (req, res) => {
  if (req.user.role === ROLES.EMPLOYEE) throw ApiError.forbidden('Compliance is a manager and HR view');
  const filter = await scopedEmployeeFilter(req.user);
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + EXPIRING_WITHIN_DAYS);

  const [mandatory, expiring, pending] = await Promise.all([
    Enrollment.find(Object.assign({ status: 'enrolled', source: 'mandatory' }, filter))
      .populate('course', 'code title delivery mandatory issuesCertificate url')
      .populate('session', 'startsAt endsAt location instructorName status')
      .sort({ dueDate: 1 }),
    CertificationRecord.find(
      Object.assign({ expiresAt: { $ne: null, $lte: horizon } }, filter)
    )
      .populate('course', 'title code')
      .populate('employee', 'firstName lastName employeeCode')
      .sort({ expiresAt: 1 }),
    Enrollment.find(Object.assign({ status: 'pending' }, filter))
      .populate('course', 'code title delivery')
      .sort({ createdAt: 1 }),
  ]);

  res.json({
    success: true,
    mandatory: mandatory.map(lms.presentEnrollment),
    expiring: expiring.map(lms.presentCert),
    pending: pending.map(lms.presentEnrollment),
  });
});

const teamLearners = asyncHandler(async (req, res) => {
  if (req.user.role === ROLES.EMPLOYEE) throw ApiError.forbidden('Team view is for managers and HR');
  const viewer = await resolveViewerEmployee(req.user);
  const people =
    req.user.role === ROLES.HR_ADMIN
      ? await Employee.find({ employmentStatus: { $in: ['confirmed', 'probation'] } })
          .select('firstName lastName employeeCode designation department reportsTo')
          .sort({ firstName: 1 })
          .limit(80)
      : viewer
        ? await Employee.find({
            $or: [{ _id: viewer._id }, { reportsTo: viewer._id }],
            employmentStatus: { $in: ['confirmed', 'probation'] },
          }).select('firstName lastName employeeCode designation department reportsTo')
        : [];
  res.json({
    success: true,
    people: people.map((row) => ({
      id: String(row._id),
      fullName: row.fullName,
      employeeCode: row.employeeCode,
      designation: row.designation,
      department: row.department,
    })),
  });
});

module.exports = {
  meta,
  listCourses,
  createCourse,
  updateCourse,
  listSessions,
  createSession,
  listEnrollments,
  createEnrollment,
  decideEnrollment,
  markAttendance,
  completeEnrollment,
  cancelEnrollment,
  myLearning,
  compliance,
  teamLearners,
};
