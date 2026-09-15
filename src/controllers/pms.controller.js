'use strict';

const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const Objective = require('../models/Objective');
const Kpi = require('../models/Kpi');
const Appraisal = require('../models/Appraisal');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/roles');
const {
  SCORE_MIN,
  SCORE_MAX,
  WEIGHT_MIN,
  WEIGHT_MAX,
  COMPLETION_MIN,
  COMPLETION_MAX,
  TITLE_MIN,
  TITLE_MAX,
  DESCRIPTION_MAX,
  TARGET_MAX,
  NOTES_MAX,
  STATUSES,
  currentPeriod,
  isValidPeriod,
  metaPayload,
} = require('../config/pms');
const { resolveViewerEmployee, isSelf } = require('../services/employeeAccess');
const pms = require('../services/pms.service');

const NO_RECORD_MESSAGE =
  'Your login is not linked to an employee record yet. Ask HR to add you to Core HR.';

function parsePeriod(value, fallback = currentPeriod()) {
  const raw = value == null || value === '' ? fallback : String(value).trim();
  if (!isValidPeriod(raw)) {
    throw ApiError.badRequest('Period must be in YYYY-H1 or YYYY-H2 format');
  }
  return raw;
}

function parseObjectId(value, label) {
  if (!value || !mongoose.isValidObjectId(value)) {
    throw ApiError.badRequest(`${label} is not a valid id`);
  }
  return value;
}

function parseScore(value, label, { required = false } = {}) {
  if (value === '' || value == null) {
    if (required) throw ApiError.badRequest(`${label} is required`);
    return null;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < SCORE_MIN || number > SCORE_MAX) {
    throw ApiError.badRequest(`${label} must be a whole number from ${SCORE_MIN} to ${SCORE_MAX}`);
  }
  return number;
}

function parseWeight(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < WEIGHT_MIN || number > WEIGHT_MAX) {
    throw ApiError.badRequest(`Weight must be a whole number from ${WEIGHT_MIN} to ${WEIGHT_MAX}`);
  }
  return number;
}

function parseCompletion(value) {
  if (value === '' || value == null) return 0;
  const number = Number(value);
  if (!Number.isInteger(number) || number < COMPLETION_MIN || number > COMPLETION_MAX) {
    throw ApiError.badRequest('Completion must be a whole number from 0 to 100');
  }
  return number;
}

function parseTitle(value, label) {
  const title = String(value || '').trim();
  if (title.length < TITLE_MIN) {
    throw ApiError.badRequest(`${label} must be at least ${TITLE_MIN} characters`);
  }
  if (title.length > TITLE_MAX) {
    throw ApiError.badRequest(`${label} cannot exceed ${TITLE_MAX} characters`);
  }
  return title;
}

function parseOptionalText(value, max, label) {
  const text = String(value || '').trim();
  if (text.length > max) {
    throw ApiError.badRequest(`${label} cannot exceed ${max} characters`);
  }
  return text;
}

async function loadViewer(user) {
  return resolveViewerEmployee(user);
}

async function loadTargetEmployee(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Employee not found');
  const employee = await Employee.findById(id);
  if (!employee) throw ApiError.notFound('Employee not found');
  return employee;
}

async function assertCanView(req, employee) {
  const viewer = await loadViewer(req.user);
  if (!pms.canViewPlan(req.user, viewer, employee)) {
    throw ApiError.forbidden('You do not have access to this performance record');
  }
  return viewer;
}

async function assertCanManage(req, employee) {
  const viewer = await loadViewer(req.user);
  if (!pms.canManageEmployee(req.user, viewer, employee)) {
    throw ApiError.forbidden('You cannot assign or review this employee');
  }
  return viewer;
}

async function respondPlan(res, user, viewer, employee, period) {
  const plan = await pms.loadPlan(employee, period);
  res.json({
    success: true,
    plan,
    permissions: pms.permissions(user, viewer, employee, plan),
  });
}

/** GET /api/pms/meta */
const meta = asyncHandler(async (_req, res) => {
  res.json({ success: true, meta: metaPayload() });
});

/**
 * GET /api/pms/team
 * Roster for assignment, filtered by the Core HR `team` field when provided.
 */
const team = asyncHandler(async (req, res) => {
  if (req.user.role !== ROLES.MANAGER && req.user.role !== ROLES.HR_ADMIN) {
    throw ApiError.forbidden('Only managers and HR can view the PMS team roster');
  }

  const period = parsePeriod(req.query.period);
  const teamFilter = String(req.query.team || '').trim();
  const { viewer, employees } = await pms.assignableEmployees(req.user, teamFilter || undefined);
  const { teams } = await pms.distinctTeams(req.user);

  const members = viewer
    ? employees.filter((employee) => String(employee._id) !== String(viewer._id))
    : employees;

  const ids = members.map((employee) => employee._id);
  const [appraisals, kpis] = await Promise.all([
    Appraisal.find({ employee: { $in: ids }, period }),
    Kpi.find({ employee: { $in: ids }, period }).select('employee weight completion'),
  ]);

  const appraisalByEmployee = new Map(appraisals.map((item) => [String(item.employee), item]));
  const kpisByEmployee = new Map();
  for (const kpi of kpis) {
    const key = String(kpi.employee);
    if (!kpisByEmployee.has(key)) kpisByEmployee.set(key, []);
    kpisByEmployee.get(key).push(kpi);
  }

  res.json({
    success: true,
    period,
    viewerTeam: (viewer && viewer.team) || '',
    teams,
    members: members.map((employee) => {
      const key = String(employee._id);
      const appraisal = appraisalByEmployee.get(key);
      const employeeKpis = kpisByEmployee.get(key) || [];
      const lineMap = new Map();
      if (appraisal) {
        for (const line of appraisal.kpiScores || []) {
          lineMap.set(String(line.kpi), line);
        }
      }
      const completionItems = employeeKpis.map((kpi) => {
        const line = lineMap.get(String(kpi._id));
        return {
          weight: kpi.weight,
          completion: line && line.completion != null ? line.completion : kpi.completion,
        };
      });
      return {
        ...pms.presentEmployee(employee),
        appraisal: appraisal
          ? {
              id: String(appraisal._id),
              status: appraisal.status,
              selfAssessmentScore: appraisal.selfAssessmentScore,
              supervisorScore: appraisal.supervisorScore,
              finalRating: appraisal.finalRating,
            }
          : null,
        kpiCount: employeeKpis.length,
        completion: pms.weightedAverage(completionItems, 'completion'),
      };
    }),
  });
});

/** GET /api/pms/me */
const me = asyncHandler(async (req, res) => {
  const viewer = await loadViewer(req.user);
  if (!viewer) throw ApiError.badRequest(NO_RECORD_MESSAGE);
  const period = parsePeriod(req.query.period);
  return respondPlan(res, req.user, viewer, viewer, period);
});

/** GET /api/pms/employees/:id/plan */
const employeePlan = asyncHandler(async (req, res) => {
  const employee = await loadTargetEmployee(req.params.id);
  const viewer = await assertCanView(req, employee);
  const period = parsePeriod(req.query.period);
  return respondPlan(res, req.user, viewer, employee, period);
});

/** GET /api/pms/appraisals */
const listAppraisals = asyncHandler(async (req, res) => {
  const period = parsePeriod(req.query.period);
  const filter = { period };

  if (req.query.status) {
    if (STATUSES.indexOf(req.query.status) === -1) {
      throw ApiError.badRequest(`Status must be one of: ${STATUSES.join(', ')}`);
    }
    filter.status = req.query.status;
  }

  const allowed = await pms.visiblePmsEmployeeIds(req.user);
  if (allowed) filter.employee = { $in: allowed };

  if (req.query.employee) {
    const employeeId = parseObjectId(req.query.employee, 'Employee');
    if (allowed && !allowed.some((id) => String(id) === String(employeeId))) {
      throw ApiError.forbidden('You do not have access to this appraisal');
    }
    filter.employee = employeeId;
  }

  const appraisals = await Appraisal.find(filter).sort({ 'snapshot.fullName': 1 });
  res.json({
    success: true,
    period,
    total: appraisals.length,
    appraisals: appraisals.map(pms.presentDoc),
  });
});

/** GET /api/pms/appraisals/:id */
const getAppraisal = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Appraisal not found');
  const appraisal = await Appraisal.findById(req.params.id);
  if (!appraisal) throw ApiError.notFound('Appraisal not found');
  const employee = await Employee.findById(appraisal.employee);
  if (!employee) throw ApiError.notFound('Employee not found');
  const viewer = await assertCanView(req, employee);
  return respondPlan(res, req.user, viewer, employee, appraisal.period);
});

async function assignmentTarget(req) {
  const body = req.body || {};
  const employee = await loadTargetEmployee(body.employee);
  await assertCanManage(req, employee);
  const period = parsePeriod(body.period);
  const appraisal = await Appraisal.findOne({ employee: employee._id, period });
  if (pms.planLocked(appraisal)) {
    throw ApiError.conflict('This review is already in progress — assignment can no longer change');
  }
  await pms.ensureAppraisal(employee, period, req.user._id);
  return { employee, period };
}

/** POST /api/pms/objectives */
const createObjective = asyncHandler(async (req, res) => {
  const { employee, period } = await assignmentTarget(req);
  const body = req.body || {};
  const objective = await Objective.create({
    employee: employee._id,
    period,
    title: parseTitle(body.title, 'Objective title'),
    description: parseOptionalText(body.description, DESCRIPTION_MAX, 'Description'),
    weight: parseWeight(body.weight),
    snapshot: pms.snapshotOf(employee),
    assignedBy: req.user._id,
  });
  res.status(201).json({ success: true, objective: pms.presentDoc(objective) });
});

async function loadObjectiveForManage(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Objective not found');
  const objective = await Objective.findById(req.params.id);
  if (!objective) throw ApiError.notFound('Objective not found');
  const employee = await Employee.findById(objective.employee);
  if (!employee) throw ApiError.notFound('Employee not found');
  await assertCanManage(req, employee);
  const appraisal = await Appraisal.findOne({ employee: employee._id, period: objective.period });
  if (pms.planLocked(appraisal)) {
    throw ApiError.conflict('This review is already in progress — assignment can no longer change');
  }
  return { objective, employee };
}

/** PATCH /api/pms/objectives/:id */
const updateObjective = asyncHandler(async (req, res) => {
  const { objective } = await loadObjectiveForManage(req);
  const body = req.body || {};
  if (body.title !== undefined) objective.title = parseTitle(body.title, 'Objective title');
  if (body.description !== undefined) {
    objective.description = parseOptionalText(body.description, DESCRIPTION_MAX, 'Description');
  }
  if (body.weight !== undefined) objective.weight = parseWeight(body.weight);
  await objective.save();
  res.json({ success: true, objective: pms.presentDoc(objective) });
});

/** DELETE /api/pms/objectives/:id */
const deleteObjective = asyncHandler(async (req, res) => {
  const { objective } = await loadObjectiveForManage(req);
  await Kpi.updateMany({ objective: objective._id }, { $set: { objective: null } });
  await objective.deleteOne();
  res.json({ success: true });
});

/** POST /api/pms/kpis */
const createKpi = asyncHandler(async (req, res) => {
  const { employee, period } = await assignmentTarget(req);
  const body = req.body || {};

  let objectiveId = null;
  if (body.objective) {
    objectiveId = parseObjectId(body.objective, 'Objective');
    const objective = await Objective.findById(objectiveId);
    if (!objective) throw ApiError.badRequest('The selected objective does not exist');
    if (String(objective.employee) !== String(employee._id) || objective.period !== period) {
      throw ApiError.badRequest('The objective does not belong to this employee and period');
    }
  }

  const kpi = await Kpi.create({
    employee: employee._id,
    period,
    objective: objectiveId,
    title: parseTitle(body.title, 'KPI title'),
    description: parseOptionalText(body.description, DESCRIPTION_MAX, 'Description'),
    target: parseOptionalText(body.target, TARGET_MAX, 'Target'),
    weight: parseWeight(body.weight),
    completion: 0,
    snapshot: pms.snapshotOf(employee),
    assignedBy: req.user._id,
  });
  res.status(201).json({ success: true, kpi: pms.presentDoc(kpi) });
});

async function loadKpiForManage(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('KPI not found');
  const kpi = await Kpi.findById(req.params.id);
  if (!kpi) throw ApiError.notFound('KPI not found');
  const employee = await Employee.findById(kpi.employee);
  if (!employee) throw ApiError.notFound('Employee not found');
  await assertCanManage(req, employee);
  const appraisal = await Appraisal.findOne({ employee: employee._id, period: kpi.period });
  if (pms.planLocked(appraisal)) {
    throw ApiError.conflict('This review is already in progress — assignment can no longer change');
  }
  return { kpi, employee };
}

/** PATCH /api/pms/kpis/:id */
const updateKpi = asyncHandler(async (req, res) => {
  const { kpi, employee } = await loadKpiForManage(req);
  const body = req.body || {};
  if (body.title !== undefined) kpi.title = parseTitle(body.title, 'KPI title');
  if (body.description !== undefined) {
    kpi.description = parseOptionalText(body.description, DESCRIPTION_MAX, 'Description');
  }
  if (body.target !== undefined) kpi.target = parseOptionalText(body.target, TARGET_MAX, 'Target');
  if (body.weight !== undefined) kpi.weight = parseWeight(body.weight);
  if (body.objective !== undefined) {
    if (!body.objective) {
      kpi.objective = null;
    } else {
      const objectiveId = parseObjectId(body.objective, 'Objective');
      const objective = await Objective.findById(objectiveId);
      if (!objective) throw ApiError.badRequest('The selected objective does not exist');
      if (String(objective.employee) !== String(employee._id) || objective.period !== kpi.period) {
        throw ApiError.badRequest('The objective does not belong to this employee and period');
      }
      kpi.objective = objectiveId;
    }
  }
  await kpi.save();
  res.json({ success: true, kpi: pms.presentDoc(kpi) });
});

/** DELETE /api/pms/kpis/:id */
const deleteKpi = asyncHandler(async (req, res) => {
  const { kpi } = await loadKpiForManage(req);
  await Appraisal.updateOne(
    { employee: kpi.employee, period: kpi.period },
    { $pull: { kpiScores: { kpi: kpi._id } } }
  );
  await kpi.deleteOne();
  res.json({ success: true });
});

function parseKpiEntries(raw, kpis, { requireScore = true } = {}) {
  if (!Array.isArray(raw) || raw.length !== kpis.length) {
    throw ApiError.badRequest('Rate every assigned KPI');
  }

  const byId = new Map(kpis.map((kpi) => [String(kpi._id), kpi]));
  const seen = new Set();
  return raw.map((entry, index) => {
    const id = entry && (entry.id || entry.kpi);
    if (!id || !byId.has(String(id))) {
      throw ApiError.badRequest(`KPI entry ${index + 1} does not match an assigned KPI`);
    }
    if (seen.has(String(id))) {
      throw ApiError.badRequest('Each KPI can only be rated once');
    }
    seen.add(String(id));
    const kpi = byId.get(String(id));
    return {
      kpi,
      selfScore: requireScore ? parseScore(entry.score ?? entry.selfScore, `${kpi.title} score`, { required: true }) : parseScore(entry.score ?? entry.selfScore, `${kpi.title} score`),
      selfNotes: parseOptionalText(entry.notes ?? entry.selfNotes, NOTES_MAX, `${kpi.title} notes`),
      supervisorScore: parseScore(entry.supervisorScore, `${kpi.title} supervisor score`),
      supervisorNotes: parseOptionalText(entry.supervisorNotes, NOTES_MAX, `${kpi.title} supervisor notes`),
      completion: parseCompletion(entry.completion),
    };
  });
}

/** POST /api/pms/appraisals/:id/self */
const submitSelf = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Appraisal not found');
  const appraisal = await Appraisal.findById(req.params.id);
  if (!appraisal) throw ApiError.notFound('Appraisal not found');

  const employee = await Employee.findById(appraisal.employee);
  const viewer = await loadViewer(req.user);
  if (!employee || !isSelf(req.user, viewer, employee)) {
    throw ApiError.forbidden('Only the employee can submit this self-assessment');
  }
  if (appraisal.status !== 'assigned') {
    throw ApiError.conflict('Self-assessment has already been submitted');
  }

  const kpis = await Kpi.find({ employee: employee._id, period: appraisal.period }).sort({ createdAt: 1 });
  if (!kpis.length) throw ApiError.badRequest('No KPIs have been assigned for this period yet');

  const body = req.body || {};
  const entries = parseKpiEntries(body.kpis, kpis, { requireScore: true });

  appraisal.kpiScores = entries.map((entry) => ({
    kpi: entry.kpi._id,
    selfScore: entry.selfScore,
    selfNotes: entry.selfNotes,
    supervisorScore: null,
    supervisorNotes: '',
    completion: entry.completion,
  }));
  appraisal.selfAssessmentNotes = parseOptionalText(body.notes ?? body.selfAssessmentNotes, NOTES_MAX, 'Notes');
  appraisal.selfAssessmentScore = pms.weightedAverage(
    entries.map((entry) => ({ score: entry.selfScore, weight: entry.kpi.weight })),
    'score'
  );
  appraisal.selfSubmittedAt = new Date();
  appraisal.status = 'self_submitted';
  await appraisal.save();

  for (const entry of entries) {
    entry.kpi.completion = entry.completion;
    await entry.kpi.save();
  }

  const plan = await pms.loadPlan(employee, appraisal.period);
  res.json({
    success: true,
    plan,
    permissions: pms.permissions(req.user, viewer, employee, plan),
  });
});

/** POST /api/pms/appraisals/:id/review */
const submitReview = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Appraisal not found');
  const appraisal = await Appraisal.findById(req.params.id);
  if (!appraisal) throw ApiError.notFound('Appraisal not found');

  const employee = await Employee.findById(appraisal.employee);
  const viewer = await assertCanManage(req, employee);

  if (appraisal.status === 'assigned') {
    throw ApiError.conflict('The employee has not submitted a self-assessment yet');
  }
  if (appraisal.status === 'reviewed') {
    throw ApiError.conflict('This appraisal has already been reviewed');
  }

  const kpis = await Kpi.find({ employee: employee._id, period: appraisal.period }).sort({ createdAt: 1 });
  if (!kpis.length) throw ApiError.badRequest('No KPIs have been assigned for this period yet');

  const body = req.body || {};
  if (!Array.isArray(body.kpis) || body.kpis.length !== kpis.length) {
    throw ApiError.badRequest('Rate every assigned KPI');
  }

  const existing = new Map((appraisal.kpiScores || []).map((line) => [String(line.kpi), line]));
  const byId = new Map(kpis.map((kpi) => [String(kpi._id), kpi]));
  const seen = new Set();
  const nextLines = [];

  for (const [index, entry] of body.kpis.entries()) {
    const id = entry && (entry.id || entry.kpi);
    if (!id || !byId.has(String(id))) {
      throw ApiError.badRequest(`KPI entry ${index + 1} does not match an assigned KPI`);
    }
    if (seen.has(String(id))) {
      throw ApiError.badRequest('Each KPI can only be rated once');
    }
    seen.add(String(id));
    const kpi = byId.get(String(id));
    const prev = existing.get(String(id)) || {};
    nextLines.push({
      kpi: kpi._id,
      selfScore: prev.selfScore == null ? null : prev.selfScore,
      selfNotes: prev.selfNotes || '',
      supervisorScore: parseScore(entry.score ?? entry.supervisorScore, `${kpi.title} score`, { required: true }),
      supervisorNotes: parseOptionalText(entry.notes ?? entry.supervisorNotes, NOTES_MAX, `${kpi.title} notes`),
      completion: prev.completion != null ? prev.completion : kpi.completion,
    });
  }

  appraisal.kpiScores = nextLines;
  appraisal.supervisorNotes = parseOptionalText(body.notes ?? body.supervisorNotes, NOTES_MAX, 'Notes');
  appraisal.supervisorScore = pms.weightedAverage(
    nextLines.map((line) => ({
      score: line.supervisorScore,
      weight: byId.get(String(line.kpi)).weight,
    })),
    'score'
  );
  appraisal.finalRating = parseScore(body.finalRating, 'Final rating', { required: true });
  appraisal.reviewedBy = req.user._id;
  appraisal.reviewedAt = new Date();
  appraisal.status = 'reviewed';
  await appraisal.save();

  const plan = await pms.loadPlan(employee, appraisal.period);
  res.json({
    success: true,
    plan,
    permissions: pms.permissions(req.user, viewer, employee, plan),
  });
});

module.exports = {
  meta,
  team,
  me,
  employeePlan,
  listAppraisals,
  getAppraisal,
  createObjective,
  updateObjective,
  deleteObjective,
  createKpi,
  updateKpi,
  deleteKpi,
  submitSelf,
  submitReview,
};
