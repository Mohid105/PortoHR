'use strict';

const Assignment = require('../models/Assignment');
const LeaveRequest = require('../models/LeaveRequest');
const Loan = require('../models/Loan');
const CompensationRequest = require('../models/CompensationRequest');
const BankAccount = require('../models/BankAccount');
const StatutoryEnrollment = require('../models/StatutoryEnrollment');
const Requisition = require('../models/Requisition');
const Offer = require('../models/Offer');
const Enrollment = require('../models/Enrollment');
const BenefitEnrollment = require('../models/BenefitEnrollment');
const asyncHandler = require('../utils/asyncHandler');
const { approvalScope, resolveViewerEmployee } = require('../services/employeeAccess');
const { typeOf } = require('../config/leave');
const { COMPENSATION_TYPES } = require('../config/finance');

function asId(value) {
  return String(value && (value._id || value) || '');
}

function snapshotFrom(row) {
  if (row.snapshot && row.snapshot.fullName) return row.snapshot;
  const employee = row.employee && row.employee.toJSON ? row.employee.toJSON() : row.employee;
  if (!employee) return { fullName: 'Unknown', employeeCode: '', designation: '', department: '' };
  return {
    fullName: `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || employee.fullName,
    employeeCode: employee.employeeCode,
    designation: employee.designation,
    department: employee.department,
  };
}

function compensationLabel(type) {
  const match = COMPENSATION_TYPES.filter((item) => item.value === type)[0];
  return match ? match.label : type;
}

/**
 * One inbox across modules so a manager does not have to visit six screens to
 * clear the same day's work. Each item keeps the decide URL of its own module.
 */
const inbox = asyncHandler(async (req, res) => {
  const queue = await approvalScope(req.user);
  if (!queue) {
    return res.json({ success: true, total: 0, items: [] });
  }
  const viewer = await resolveViewerEmployee(req.user);

  const [assignments, leave, loans, claims, banks, statutory, requisitions, offers, enrollments, benefitChanges] = await Promise.all([
    Assignment.find(Object.assign({ status: 'pending' }, queue))
      .populate('employee', 'firstName lastName employeeCode designation department')
      .sort({ createdAt: 1 })
      .limit(50),
    LeaveRequest.find(Object.assign({ status: 'pending' }, queue)).sort({ createdAt: 1 }).limit(50),
    Loan.find(Object.assign({ status: 'pending' }, queue)).sort({ createdAt: 1 }).limit(50),
    CompensationRequest.find(Object.assign({ status: 'pending' }, queue)).sort({ createdAt: 1 }).limit(50),
    BankAccount.find(Object.assign({ status: 'pending' }, queue))
      .populate('employee', 'firstName lastName employeeCode designation department')
      .sort({ createdAt: 1 })
      .limit(50),
    StatutoryEnrollment.find(Object.assign({ status: 'pending' }, queue))
      .populate('employee', 'firstName lastName employeeCode designation department')
      .sort({ createdAt: 1 })
      .limit(50),
    Requisition.find(Object.assign({ status: 'pending' }, queue)).sort({ createdAt: 1 }).limit(50),
    Offer.find(
      req.user.role === 'hr_admin'
        ? { status: 'pending', submittedBy: { $ne: req.user._id } }
        : viewer
          ? { status: 'pending', employee: viewer._id, submittedBy: { $ne: req.user._id } }
          : { _id: null }
    )
      .sort({ createdAt: 1 })
      .limit(50),
    Enrollment.find(Object.assign({ status: 'pending' }, queue))
      .populate('course', 'title code')
      .sort({ createdAt: 1 })
      .limit(50),
    BenefitEnrollment.find(
      req.user.role === 'hr_admin'
        ? { status: 'pending', submittedBy: { $ne: req.user._id } }
        : { _id: null }
    )
      .populate('plan', 'name code')
      .populate('option', 'name')
      .sort({ createdAt: 1 })
      .limit(50),
  ]);

  const items = [];

  assignments.forEach((row) => {
    const snap = snapshotFrom(row);
    items.push({
      id: asId(row),
      module: 'core_hr',
      kind: 'assignment',
      title: `${snap.fullName} · ${row.event || 'Assignment change'}`,
      detail: [row.designation, row.department, row.team].filter(Boolean).join(' · '),
      href: '/core-hr.html',
      decidePath: `/employees/assignments/${asId(row)}/status`,
      submittedAt: row.createdAt,
      snapshot: snap,
    });
  });

  leave.forEach((row) => {
    const type = typeOf(row.leaveType);
    const from = row.fromDate && row.fromDate.toISOString().slice(0, 10);
    const to = row.toDate && row.toDate.toISOString().slice(0, 10);
    items.push({
      id: asId(row),
      module: 'leave',
      kind: 'leave',
      title: `${row.snapshot.fullName} · ${type ? type.label : row.leaveType}`,
      detail: `${from} → ${to} · ${row.days} day(s)`,
      href: '/leave.html',
      decidePath: `/leave/${asId(row)}/status`,
      submittedAt: row.createdAt,
      snapshot: row.snapshot,
    });
  });

  loans.forEach((row) => {
    items.push({
      id: asId(row),
      module: 'loans',
      kind: 'loan',
      title: `${row.snapshot.fullName} · Salary loan`,
      detail: `${row.repaymentMonths} month(s) repayment`,
      href: '/finance.html#loans',
      decidePath: `/loans/${asId(row)}/status`,
      submittedAt: row.createdAt,
      snapshot: row.snapshot,
    });
  });

  claims.forEach((row) => {
    items.push({
      id: asId(row),
      module: 'compensation',
      kind: 'claim',
      title: `${row.snapshot.fullName} · ${compensationLabel(row.type)}`,
      detail: row.note || 'Compensation claim',
      href: '/finance.html#compensation',
      decidePath: `/compensation/${asId(row)}/status`,
      submittedAt: row.createdAt,
      snapshot: row.snapshot,
    });
  });

  banks.forEach((row) => {
    const snap = snapshotFrom(row);
    items.push({
      id: asId(row),
      module: 'core_hr',
      kind: 'bank',
      title: `${snap.fullName} · Bank account`,
      detail: row.bankName || 'Payment method change',
      href: '/core-hr.html',
      decidePath: `/employees/bank/${asId(row)}/status`,
      submittedAt: row.createdAt,
      snapshot: snap,
    });
  });

  statutory.forEach((row) => {
    const snap = snapshotFrom(row);
    items.push({
      id: asId(row),
      module: 'core_hr',
      kind: 'statutory',
      title: `${snap.fullName} · ${row.scheme}`,
      detail: 'Statutory enrolment change',
      href: '/core-hr.html',
      decidePath: `/employees/statutory/${asId(row)}/status`,
      submittedAt: row.createdAt,
      snapshot: snap,
    });
  });

  requisitions.forEach((row) => {
    items.push({
      id: asId(row),
      module: 'recruitment',
      kind: 'requisition',
      title: `${row.title} · Requisition`,
      detail: row.reason,
      href: '/recruitment.html',
      decidePath: `/recruitment/requisitions/${asId(row)}/status`,
      submittedAt: row.createdAt,
      snapshot: row.snapshot,
    });
  });

  offers.forEach((row) => {
    items.push({
      id: asId(row),
      module: 'recruitment',
      kind: 'offer',
      title: `${(row.snapshot && row.snapshot.candidateName) || 'Candidate'} · Offer`,
      detail: row.snapshot && row.snapshot.title ? row.snapshot.title : 'Offer approval',
      href: '/recruitment.html',
      decidePath: `/recruitment/offers/${asId(row)}/status`,
      submittedAt: row.createdAt,
      snapshot: row.snapshot,
    });
  });

  enrollments.forEach((row) => {
    const courseTitle = row.course && row.course.title ? row.course.title : 'Course';
    items.push({
      id: asId(row),
      module: 'lms',
      kind: 'enrollment',
      title: `${(row.snapshot && row.snapshot.fullName) || 'Learner'} · Learning`,
      detail: courseTitle,
      href: '/lms.html',
      decidePath: `/lms/enrollments/${asId(row)}/status`,
      submittedAt: row.createdAt,
      snapshot: row.snapshot,
    });
  });

  benefitChanges.forEach((row) => {
    const planName = row.plan && row.plan.name ? row.plan.name : 'Benefit plan';
    items.push({
      id: asId(row),
      module: 'benefits',
      kind: 'benefit',
      title: `${(row.snapshot && row.snapshot.fullName) || 'Employee'} · Benefits`,
      detail: row.option && row.option.name ? `${planName} · ${row.option.name}` : planName,
      href: '/benefits.html',
      decidePath: `/benefits/enrollments/${asId(row)}/status`,
      submittedAt: row.createdAt,
      snapshot: row.snapshot,
    });
  });

  items.sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));

  res.json({ success: true, total: items.length, items });
});

module.exports = { inbox };
