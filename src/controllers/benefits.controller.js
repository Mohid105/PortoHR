'use strict';

const mongoose = require('mongoose');
const BenefitPlan = require('../models/BenefitPlan');
const PlanOption = require('../models/PlanOption');
const BenefitEnrollment = require('../models/BenefitEnrollment');
const FamilyMember = require('../models/FamilyMember');
const Employee = require('../models/Employee');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/roles');
const { metaPayload } = require('../config/benefits');
const { resolveViewerEmployee, canDecideFor, visibleEmployeeIds } = require('../services/employeeAccess');
const benefits = require('../services/benefits.service');
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
  res.json({ success: true, meta: metaPayload() });
});

const listPlans = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  const filter = req.user.role === ROLES.HR_ADMIN ? {} : { status: 'published' };
  const plans = await BenefitPlan.find(filter).sort({ category: 1, name: 1 });
  const options = await PlanOption.find({ plan: { $in: plans.map((row) => row._id) } }).sort({ isDefault: -1, name: 1 });
  const byPlan = {};
  options.forEach((row) => {
    const key = String(row.plan);
    byPlan[key] = byPlan[key] || [];
    byPlan[key].push(row);
  });
  res.json({
    success: true,
    plans: plans
      .filter((plan) => req.user.role === ROLES.HR_ADMIN || !viewer || benefits.eligibleFor(plan, viewer))
      .map((plan) => benefits.presentPlan(plan, byPlan[String(plan._id)] || [])),
  });
});

const createPlan = asyncHandler(async (req, res) => {
  if (req.user.role !== ROLES.HR_ADMIN) throw ApiError.forbidden('Only HR can maintain benefit plans');
  const plan = await benefits.createPlan(req.body || {});
  res.status(201).json({ success: true, message: 'Plan saved', plan });
});

const addOption = asyncHandler(async (req, res) => {
  if (req.user.role !== ROLES.HR_ADMIN) throw ApiError.forbidden('Only HR can maintain plan options');
  requireId(req.params.id, 'Plan');
  const plan = await BenefitPlan.findById(req.params.id);
  if (!plan) throw ApiError.notFound('Plan not found');
  const option = await benefits.addOption(plan, req.body || {});
  res.status(201).json({ success: true, message: 'Option added', option });
});

const myCoverage = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  if (!viewer) {
    return res.json({ success: true, enrollments: [], family: [], window: metaPayload().openEnrollment });
  }
  const [enrollments, family] = await Promise.all([
    BenefitEnrollment.find({ employee: viewer._id, status: { $in: ['pending', 'active'] } })
      .populate('plan')
      .populate('option')
      .populate('dependents', 'name relationship')
      .sort({ createdAt: -1 }),
    viewer.person
      ? FamilyMember.find({ person: viewer.person, status: 'active' }).sort({ isDependent: -1, name: 1 })
      : [],
  ]);
  res.json({
    success: true,
    enrollments: enrollments.map(benefits.presentEnrollment),
    family: family.map(benefits.presentFamily),
    window: metaPayload().openEnrollment,
  });
});

const listEnrollments = asyncHandler(async (req, res) => {
  const filter = await scopedEmployeeFilter(req.user);
  if (req.query.status) filter.status = req.query.status;
  const rows = await BenefitEnrollment.find(filter)
    .populate('plan')
    .populate('option')
    .populate('dependents', 'name relationship')
    .sort({ createdAt: -1 })
    .limit(200);
  res.json({ success: true, enrollments: rows.map(benefits.presentEnrollment) });
});

const elect = asyncHandler(async (req, res) => {
  const viewer = await resolveViewerEmployee(req.user);
  const body = req.body || {};
  if (typeof body.dependents === 'string' && body.dependents) body.dependents = [body.dependents];
  let target = viewer;
  if (body.employee) {
    requireId(body.employee, 'Employee');
    target = await Employee.findById(body.employee);
    if (!target) throw ApiError.notFound('Employee not found');
  }
  const presented = await benefits.elect(body, req.user, viewer, target);
  res.status(201).json({
    success: true,
    message: presented.status === 'pending' ? 'Election submitted for HR approval' : 'Coverage activated',
    enrollment: presented,
  });
});

const decideEnrollment = asyncHandler(async (req, res) => {
  requireId(req.params.id, 'Enrollment');
  const enrollment = await BenefitEnrollment.findById(req.params.id);
  if (!enrollment) throw ApiError.notFound('Enrollment not found');
  const learner = await Employee.findById(enrollment.employee);
  const viewer = await resolveViewerEmployee(req.user);
  if (!(await canDecideFor(req.user, viewer, learner || { _id: enrollment.employee, email: '' }, 'benefits'))) {
    throw ApiError.forbidden('You cannot approve your own benefits change');
  }
  let status = (req.body || {}).status;
  if (status === 'approved') status = 'active';
  const presented = await benefits.decideEnrollment(enrollment, req.user, status, (req.body || {}).decisionNote);
  webhooks.emitApprovalCompleted({
    kind: 'benefits',
    decision: (req.body || {}).status,
    objectId: enrollment._id,
    employeeCode: learner && learner.employeeCode,
    fullName: learner && learner.fullName,
  });
  res.json({ success: true, message: `Coverage ${presented.statusLabel.toLowerCase()}`, enrollment: presented });
});

const endEnrollment = asyncHandler(async (req, res) => {
  requireId(req.params.id, 'Enrollment');
  const enrollment = await BenefitEnrollment.findById(req.params.id);
  if (!enrollment) throw ApiError.notFound('Enrollment not found');
  const viewer = await resolveViewerEmployee(req.user);
  const own = viewer && String(viewer._id) === String(enrollment.employee);
  if (!own && req.user.role !== ROLES.HR_ADMIN) {
    throw ApiError.forbidden('You can only end your own coverage');
  }
  const presented = await benefits.endEnrollment(enrollment);
  res.json({ success: true, message: 'Coverage ended', enrollment: presented });
});

const summary = asyncHandler(async (req, res) => {
  if (req.user.role === ROLES.EMPLOYEE) throw ApiError.forbidden('Cost summary is a manager and HR view');
  const filter = await scopedEmployeeFilter(req.user);
  const payload = await benefits.costSummary(filter);
  res.json({ success: true, ...payload });
});

const exportEnrollments = asyncHandler(async (req, res) => {
  if (req.user.role !== ROLES.HR_ADMIN) throw ApiError.forbidden('Only HR can export the provider file');
  const rows = await BenefitEnrollment.find({ status: 'active' })
    .populate('plan')
    .populate('option')
    .populate('dependents', 'name relationship')
    .sort({ createdAt: 1 });
  res.json({
    success: true,
    generatedAt: new Date().toISOString(),
    providerFile: rows.map((row) => {
      const presented = benefits.presentEnrollment(row);
      return {
        membershipNumber: presented.code,
        employeeCode: row.snapshot && row.snapshot.employeeCode,
        fullName: row.snapshot && row.snapshot.fullName,
        plan: presented.planCode,
        option: presented.optionName,
        provider: presented.provider,
        employerAmount: presented.employerAmount,
        employeeAmount: presented.employeeAmount,
        currency: presented.currency,
        dependents: presented.dependents.map((item) => item.name),
        effectiveFrom: presented.effectiveFrom,
      };
    }),
  });
});

module.exports = {
  meta,
  listPlans,
  createPlan,
  addOption,
  myCoverage,
  listEnrollments,
  elect,
  decideEnrollment,
  endEnrollment,
  summary,
  exportEnrollments,
};
