'use strict';

const Employee = require('../models/Employee');
const Objective = require('../models/Objective');
const Kpi = require('../models/Kpi');
const Appraisal = require('../models/Appraisal');
const ApiError = require('../utils/ApiError');
const { ROLES } = require('../config/roles');
const { SCORE_MAX, STATUS_LABELS } = require('../config/pms');
const { resolveViewerEmployee, isSelf, managesDirectly } = require('./employeeAccess');

const LEFT_DIRECTORY = ['terminated', 'resigned'];

function snapshotOf(employee) {
  return {
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    designation: employee.designation,
    department: employee.department,
    team: employee.team || '',
  };
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

/**
 * Weighted mean, ignoring items that have no score yet. Weights are whatever
 * the manager set — they do not have to sum to 100; we normalise here.
 */
function weightedAverage(items, scoreKey, weightKey = 'weight') {
  let weighted = 0;
  let total = 0;
  for (const item of items) {
    const score = item[scoreKey];
    const weight = Number(item[weightKey]) || 0;
    if (score == null || score === '' || !weight) continue;
    weighted += Number(score) * weight;
    total += weight;
  }
  if (!total) return null;
  return round1(weighted / total);
}

function scoreToPercent(score) {
  if (score == null) return null;
  return round1((Number(score) / SCORE_MAX) * 100);
}

function stringifyId(value) {
  if (value == null) return null;
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
}

function presentDoc(doc) {
  if (!doc) return null;
  const json = typeof doc.toJSON === 'function' ? doc.toJSON() : { ...doc };
  json.id = String(json.id || json._id);
  if (json.employee) json.employee = stringifyId(json.employee);
  if (json.objective) json.objective = stringifyId(json.objective);
  if (json.assignedBy) json.assignedBy = stringifyId(json.assignedBy);
  if (json.reviewedBy) json.reviewedBy = stringifyId(json.reviewedBy);
  if (Array.isArray(json.kpiScores)) {
    json.kpiScores = json.kpiScores.map((line) => ({
      kpi: stringifyId(line.kpi),
      selfScore: line.selfScore == null ? null : line.selfScore,
      selfNotes: line.selfNotes || '',
      supervisorScore: line.supervisorScore == null ? null : line.supervisorScore,
      supervisorNotes: line.supervisorNotes || '',
      completion: line.completion || 0,
    }));
  }
  return json;
}

function presentEmployee(employee) {
  return {
    id: String(employee._id),
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    firstName: employee.firstName,
    lastName: employee.lastName,
    designation: employee.designation,
    department: employee.department,
    team: employee.team || '',
  };
}

/**
 * A manager's PMS roster is the Core HR `team` they belong to, plus anyone who
 * reports to them even if that person sits on a different team (Sofia is on
 * Product, Daniel on Platform). HR sees the whole directory.
 *
 * Payroll/loans keep using `reportsTo` only — this helper is PMS-specific so a
 * shared-team colleague without a reporting line cannot see salaries.
 */
function rosterFilter(user, viewer, teamFilter) {
  const base = { employmentStatus: { $nin: LEFT_DIRECTORY } };

  if (user.role === ROLES.HR_ADMIN) {
    return teamFilter ? { ...base, team: teamFilter } : base;
  }

  if (user.role !== ROLES.MANAGER || !viewer) return null;

  const or = [{ reportsTo: viewer._id }];
  if (viewer.team) {
    or.push({ team: viewer.team, _id: { $ne: viewer._id } });
  }

  const filter = { ...base, $or: or };
  if (!teamFilter) return filter;
  return { $and: [filter, { team: teamFilter }] };
}

async function assignableEmployees(user, teamFilter) {
  const viewer = await resolveViewerEmployee(user);
  const filter = rosterFilter(user, viewer, teamFilter);
  if (!filter) return { viewer, employees: [] };
  const employees = await Employee.find(filter).sort({ firstName: 1, lastName: 1 });
  return { viewer, employees };
}

function canManageEmployee(user, viewer, employee) {
  if (!employee) return false;
  if (isSelf(user, viewer, employee)) return false;
  if (user.role === ROLES.HR_ADMIN) return true;
  if (user.role !== ROLES.MANAGER || !viewer) return false;
  if (managesDirectly(viewer, employee)) return true;
  return Boolean(viewer.team && employee.team && viewer.team === employee.team);
}

function canViewPlan(user, viewer, employee) {
  if (!employee) return false;
  if (user.role === ROLES.HR_ADMIN) return true;
  if (isSelf(user, viewer, employee)) return true;
  return canManageEmployee(user, viewer, employee);
}

async function visiblePmsEmployeeIds(user) {
  if (user.role === ROLES.HR_ADMIN) return null;
  const { viewer, employees } = await assignableEmployees(user);
  const ids = [];
  if (viewer) ids.push(viewer._id);
  employees.forEach((employee) => ids.push(employee._id));
  return ids;
}

async function distinctTeams(user) {
  const { viewer, employees } = await assignableEmployees(user);
  const names = new Set();
  if (user.role === ROLES.HR_ADMIN) {
    const all = await Employee.find({
      employmentStatus: { $nin: LEFT_DIRECTORY },
      team: { $nin: [null, ''] },
    }).select('team');
    all.forEach((employee) => names.add(employee.team));
  } else {
    employees.forEach((employee) => {
      if (employee.team) names.add(employee.team);
    });
  }
  return { viewer, teams: Array.from(names).sort() };
}

async function ensureAppraisal(employee, period, assignedBy) {
  const existing = await Appraisal.findOne({ employee: employee._id, period });
  if (existing) return existing;
  return Appraisal.create({
    employee: employee._id,
    period,
    snapshot: snapshotOf(employee),
    assignedBy: assignedBy || null,
    status: 'assigned',
  });
}

function kpiLineMap(appraisal) {
  const map = new Map();
  if (!appraisal) return map;
  for (const line of appraisal.kpiScores || []) {
    map.set(String(line.kpi), line);
  }
  return map;
}

function assemblePlan(employee, period, objectives, kpis, appraisal) {
  const lines = kpiLineMap(appraisal);
  const presentedKpis = kpis.map((kpi) => {
    const json = presentDoc(kpi);
    const line = lines.get(String(kpi._id));
    json.selfScore = line && line.selfScore != null ? line.selfScore : null;
    json.selfNotes = (line && line.selfNotes) || '';
    json.supervisorScore = line && line.supervisorScore != null ? line.supervisorScore : null;
    json.supervisorNotes = (line && line.supervisorNotes) || '';
    if (line && line.completion != null) json.completion = line.completion;
    return json;
  });

  const completion = weightedAverage(presentedKpis, 'completion');
  const selfWeighted = weightedAverage(presentedKpis, 'selfScore');
  const supervisorWeighted = weightedAverage(presentedKpis, 'supervisorScore');

  const appraisalJson = presentDoc(appraisal);
  if (appraisalJson) {
    appraisalJson.statusLabel = STATUS_LABELS[appraisalJson.status] || appraisalJson.status;
  }

  return {
    employee: presentEmployee(employee),
    period,
    appraisal: appraisalJson,
    objectives: objectives.map(presentDoc),
    kpis: presentedKpis,
    scores: {
      completion,
      selfWeighted,
      supervisorWeighted,
      selfPercent: scoreToPercent(appraisalJson && appraisalJson.selfAssessmentScore != null
        ? appraisalJson.selfAssessmentScore
        : selfWeighted),
      supervisorPercent: scoreToPercent(appraisalJson && appraisalJson.supervisorScore != null
        ? appraisalJson.supervisorScore
        : supervisorWeighted),
      finalPercent: scoreToPercent(appraisalJson && appraisalJson.finalRating),
    },
  };
}

async function loadPlan(employee, period) {
  const [objectives, kpis, appraisal] = await Promise.all([
    Objective.find({ employee: employee._id, period }).sort({ createdAt: 1 }),
    Kpi.find({ employee: employee._id, period }).sort({ createdAt: 1 }),
    Appraisal.findOne({ employee: employee._id, period }),
  ]);
  return assemblePlan(employee, period, objectives, kpis, appraisal);
}

function planLocked(appraisal) {
  return Boolean(appraisal && (appraisal.status === 'self_submitted' || appraisal.status === 'reviewed'));
}

function planReviewed(appraisal) {
  return Boolean(appraisal && appraisal.status === 'reviewed');
}

async function requireEmployee(id) {
  const employee = await Employee.findById(id);
  if (!employee) throw ApiError.notFound('Employee not found');
  return employee;
}

function permissions(user, viewer, employee, plan) {
  const manage = canManageEmployee(user, viewer, employee);
  const self = isSelf(user, viewer, employee);
  const status = plan.appraisal && plan.appraisal.status;
  return {
    canAssign: manage && status !== 'self_submitted' && status !== 'reviewed',
    canSelfAssess: self && status === 'assigned' && plan.kpis.length > 0,
    canReview: manage && status === 'self_submitted',
    isSelf: self,
  };
}

module.exports = {
  snapshotOf,
  round1,
  weightedAverage,
  scoreToPercent,
  presentDoc,
  presentEmployee,
  assignableEmployees,
  canManageEmployee,
  canViewPlan,
  visiblePmsEmployeeIds,
  distinctTeams,
  ensureAppraisal,
  assemblePlan,
  loadPlan,
  planLocked,
  planReviewed,
  requireEmployee,
  permissions,
  stringifyId,
};
