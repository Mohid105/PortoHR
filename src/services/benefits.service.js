'use strict';

const BenefitPlan = require('../models/BenefitPlan');
const PlanOption = require('../models/PlanOption');
const BenefitEnrollment = require('../models/BenefitEnrollment');
const FamilyMember = require('../models/FamilyMember');
const ApiError = require('../utils/ApiError');
const { ROLES } = require('../config/roles');
const {
  CATEGORY_LABELS,
  PLAN_STATUS_LABELS,
  ENROLLMENT_STATUS_LABELS,
  SOURCE_LABELS,
  LIFE_EVENT_LABELS,
  inOpenEnrollment,
} = require('../config/benefits');

function asId(value) {
  return String((value && (value._id || value.id || value)) || '');
}

function snapshotOf(employee) {
  if (!employee) return { employeeCode: '', fullName: '', designation: '', department: '', grade: '' };
  return {
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    designation: employee.designation,
    department: employee.department,
    grade: employee.grade || '',
  };
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

function eligibleFor(plan, employee) {
  const grades = plan.eligibleGrades || [];
  if (!grades.length) return true;
  if (!employee.grade) return true;
  return grades.indexOf(employee.grade) !== -1;
}

function presentOption(doc) {
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  json.plan = asId(json.plan);
  json.totalAmount = Number(json.employerAmount || 0) + Number(json.employeeAmount || 0);
  return json;
}

function presentPlan(doc, options = []) {
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  json.categoryLabel = CATEGORY_LABELS[json.category] || json.category;
  json.statusLabel = PLAN_STATUS_LABELS[json.status] || json.status;
  json.options = options.map(presentOption);
  return json;
}

function presentFamily(doc) {
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  json.dateOfBirth = json.dateOfBirth ? new Date(json.dateOfBirth).toISOString().slice(0, 10) : '';
  return json;
}

function presentEnrollment(doc) {
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  json.employee = asId(json.employee);
  json.planId = json.plan && json.plan.name ? String(json.plan._id || json.plan.id) : asId(json.plan);
  json.planName = json.plan && json.plan.name ? json.plan.name : '';
  json.planCode = json.plan && json.plan.code ? json.plan.code : '';
  json.category = json.plan && json.plan.category ? json.plan.category : '';
  json.categoryLabel = CATEGORY_LABELS[json.category] || json.category;
  json.provider = json.plan && json.plan.provider ? json.plan.provider : '';
  json.optionId = json.option && json.option.name ? String(json.option._id || json.option.id) : asId(json.option);
  json.optionName = json.option && json.option.name ? json.option.name : '';
  json.statusLabel = ENROLLMENT_STATUS_LABELS[json.status] || json.status;
  json.sourceLabel = SOURCE_LABELS[json.source] || json.source;
  json.lifeEventLabel = json.lifeEvent ? LIFE_EVENT_LABELS[json.lifeEvent] || json.lifeEvent : '';
  json.effectiveFrom = json.effectiveFrom ? new Date(json.effectiveFrom).toISOString().slice(0, 10) : '';
  json.effectiveTo = json.effectiveTo ? new Date(json.effectiveTo).toISOString().slice(0, 10) : '';
  json.learner = json.snapshot && json.snapshot.fullName ? json.snapshot.fullName : '';
  json.dependents = (json.dependents || []).map((row) =>
    row && row.name ? { id: String(row._id || row.id), name: row.name, relationship: row.relationship } : { id: asId(row) }
  );
  json.totalAmount = Number(json.employerAmount || 0) + Number(json.employeeAmount || 0);
  return json;
}

async function populateEnrollment(id) {
  return BenefitEnrollment.findById(id)
    .populate('plan')
    .populate('option')
    .populate('dependents', 'name relationship');
}

async function createPlan(body) {
  const name = String(body.name || '').trim();
  if (name.length < 3) throw ApiError.badRequest('Plan name must be at least 3 characters');
  if (!body.category) throw ApiError.badRequest('A category is required');
  const plan = await BenefitPlan.create({
    code: body.code || (await nextCode(BenefitPlan, 'PLN', 'code')),
    name,
    summary: String(body.summary || '').trim(),
    category: body.category,
    provider: String(body.provider || '').trim(),
    currency: body.currency || 'USD',
    eligibleGrades: Array.isArray(body.eligibleGrades)
      ? body.eligibleGrades
      : String(body.eligibleGrades || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
    status: body.status || 'published',
  });
  return presentPlan(plan, []);
}

async function addOption(plan, body) {
  const name = String(body.name || '').trim();
  if (name.length < 2) throw ApiError.badRequest('Option name is required');
  if (body.isDefault || body.isDefault === 'true') {
    await PlanOption.updateMany({ plan: plan._id }, { $set: { isDefault: false } });
  }
  const option = await PlanOption.create({
    plan: plan._id,
    code: body.code || `OPT-${Date.now().toString().slice(-4)}`,
    name,
    summary: String(body.summary || '').trim(),
    employerAmount: Number(body.employerAmount) || 0,
    employeeAmount: Number(body.employeeAmount) || 0,
    maxDependents: Number(body.maxDependents) || 0,
    isDefault: body.isDefault === true || body.isDefault === 'true',
  });
  return presentOption(option);
}

async function assertDependents(employee, option, dependentIds) {
  const ids = (dependentIds || []).filter(Boolean);
  if (ids.length > (option.maxDependents || 0)) {
    throw ApiError.badRequest(`This option covers at most ${option.maxDependents} dependent(s)`);
  }
  if (!ids.length) return [];
  if (!employee.person) throw ApiError.badRequest('Add family members in Core HR before covering dependents');
  const rows = await FamilyMember.find({ _id: { $in: ids }, person: employee.person, status: 'active' });
  if (rows.length !== ids.length) {
    throw ApiError.badRequest('Dependents must be active family records on this employee');
  }
  return rows.map((row) => row._id);
}

async function elect(body, user, viewer, target) {
  if (!target) throw ApiError.badRequest('An employee is required');
  const option = await PlanOption.findById(body.option);
  if (!option) throw ApiError.notFound('Plan option not found');
  const plan = await BenefitPlan.findById(option.plan);
  if (!plan || plan.status !== 'published') throw ApiError.notFound('That plan is not open');
  if (!eligibleFor(plan, target)) {
    throw ApiError.forbidden('This plan is not available for the employee grade');
  }

  const assigningOthers = String(target._id) !== String(viewer && viewer._id);
  if (assigningOthers && user.role !== ROLES.HR_ADMIN) {
    throw ApiError.forbidden('Only HR can enroll someone else');
  }

  const hrDirect = user.role === ROLES.HR_ADMIN;
  let source = 'open_enrollment';
  if (hrDirect && assigningOthers) source = 'hr';
  else if (body.lifeEvent) source = 'life_event';
  else if (body.source === 'auto') source = 'auto';

  if (!hrDirect && source === 'open_enrollment' && !inOpenEnrollment()) {
    throw ApiError.badRequest('Open enrollment is closed. Submit a life-event change instead');
  }
  if (source === 'life_event') {
    if (!body.lifeEvent) throw ApiError.badRequest('A life event is required');
    if (!String(body.evidenceUrl || '').trim() && !String(body.reason || '').trim()) {
      throw ApiError.badRequest('Attach evidence or a short note for a life-event change');
    }
  }

  const existingPending = await BenefitEnrollment.findOne({
    employee: target._id,
    plan: plan._id,
    status: 'pending',
  });
  if (existingPending) throw ApiError.conflict('A change on this plan is already waiting for approval');

  const current = await BenefitEnrollment.findOne({ employee: target._id, plan: plan._id, status: 'active' });
  const dependents = await assertDependents(target, option, body.dependents || body.dependentIds);

  const autoActive = hrDirect || source === 'auto';
  const enrollment = await BenefitEnrollment.create({
    code: await nextCode(BenefitEnrollment, 'BEN', 'code'),
    employee: target._id,
    snapshot: snapshotOf(target),
    plan: plan._id,
    option: option._id,
    dependents,
    source,
    lifeEvent: body.lifeEvent || '',
    evidenceUrl: String(body.evidenceUrl || '').trim(),
    reason: String(body.reason || '').trim(),
    currency: plan.currency,
    employerAmount: option.employerAmount,
    employeeAmount: option.employeeAmount,
    status: autoActive ? 'active' : 'pending',
    replaces: current && !autoActive ? current._id : null,
    submittedBy: user._id,
    decidedBy: autoActive ? user._id : null,
    decidedAt: autoActive ? new Date() : null,
    effectiveFrom: new Date(),
  });

  if (autoActive && current) {
    current.status = 'ended';
    current.effectiveTo = new Date();
    await current.save();
  }

  return presentEnrollment(await populateEnrollment(enrollment._id));
}

async function decideEnrollment(enrollment, user, status, note) {
  if (enrollment.status !== 'pending') {
    throw ApiError.conflict('This election is no longer waiting for a decision');
  }
  if (['approved', 'active', 'rejected'].indexOf(status) === -1) {
    throw ApiError.badRequest('A benefits decision must be approved or rejected');
  }
  const decisionNote = String(note || '').trim();
  if (status === 'rejected' && !decisionNote) {
    throw ApiError.badRequest('Please give a reason when rejecting a benefits change');
  }
  enrollment.decisionNote = decisionNote;
  enrollment.decidedBy = user._id;
  enrollment.decidedAt = new Date();

  if (status === 'rejected') {
    enrollment.status = 'rejected';
    await enrollment.save();
    return presentEnrollment(await populateEnrollment(enrollment._id));
  }

  if (enrollment.replaces) {
    const previous = await BenefitEnrollment.findById(enrollment.replaces);
    if (previous && previous.status === 'active') {
      previous.status = 'ended';
      previous.effectiveTo = new Date();
      await previous.save();
    }
  }
  enrollment.status = 'active';
  enrollment.effectiveFrom = new Date();
  await enrollment.save();
  return presentEnrollment(await populateEnrollment(enrollment._id));
}

async function endEnrollment(enrollment) {
  if (enrollment.status !== 'active') throw ApiError.conflict('Only active coverage can be ended');
  enrollment.status = 'ended';
  enrollment.effectiveTo = new Date();
  await enrollment.save();
  return presentEnrollment(await populateEnrollment(enrollment._id));
}

async function autoEnroll(employee, userId) {
  const plans = await BenefitPlan.find({ status: 'published' });
  const created = [];
  for (const plan of plans) {
    if (!eligibleFor(plan, employee)) continue;
    const existing = await BenefitEnrollment.findOne({
      employee: employee._id,
      plan: plan._id,
      status: { $in: ['pending', 'active'] },
    });
    if (existing) continue;
    const option = await PlanOption.findOne({ plan: plan._id, isDefault: true });
    if (!option) continue;
    const enrollment = await BenefitEnrollment.create({
      code: await nextCode(BenefitEnrollment, 'BEN', 'code'),
      employee: employee._id,
      snapshot: snapshotOf(employee),
      plan: plan._id,
      option: option._id,
      source: 'auto',
      currency: plan.currency,
      employerAmount: option.employerAmount,
      employeeAmount: option.employeeAmount,
      status: 'active',
      submittedBy: userId || null,
      decidedBy: userId || null,
      decidedAt: new Date(),
      effectiveFrom: employee.dateOfJoining || new Date(),
    });
    created.push(await populateEnrollment(enrollment._id));
  }
  return created.map(presentEnrollment);
}

async function costSummary(filter = {}) {
  const rows = await BenefitEnrollment.find(Object.assign({ status: 'active' }, filter))
    .populate('plan', 'name code category provider currency')
    .populate('option', 'name');
  const byPlan = {};
  rows.forEach((row) => {
    const key = String(row.plan && (row.plan._id || row.plan));
    if (!byPlan[key]) {
      byPlan[key] = {
        planId: key,
        planName: row.plan && row.plan.name ? row.plan.name : 'Plan',
        category: row.plan && row.plan.category,
        categoryLabel: CATEGORY_LABELS[row.plan && row.plan.category] || '',
        provider: row.plan && row.plan.provider ? row.plan.provider : '',
        currency: row.currency,
        heads: 0,
        employerAmount: 0,
        employeeAmount: 0,
      };
    }
    byPlan[key].heads += 1;
    byPlan[key].employerAmount += Number(row.employerAmount || 0);
    byPlan[key].employeeAmount += Number(row.employeeAmount || 0);
  });
  const plans = Object.keys(byPlan).map((key) => {
    const item = byPlan[key];
    item.totalAmount = item.employerAmount + item.employeeAmount;
    return item;
  });
  const totals = plans.reduce(
    (acc, item) => {
      acc.heads += item.heads;
      acc.employerAmount += item.employerAmount;
      acc.employeeAmount += item.employeeAmount;
      acc.totalAmount += item.totalAmount;
      return acc;
    },
    { heads: 0, employerAmount: 0, employeeAmount: 0, totalAmount: 0 }
  );
  return { plans, totals, enrollments: rows.map(presentEnrollment) };
}

module.exports = {
  asId,
  snapshotOf,
  eligibleFor,
  presentOption,
  presentPlan,
  presentFamily,
  presentEnrollment,
  populateEnrollment,
  createPlan,
  addOption,
  elect,
  decideEnrollment,
  endEnrollment,
  autoEnroll,
  costSummary,
};
