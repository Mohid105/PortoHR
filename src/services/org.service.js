'use strict';

const OrgUnit = require('../models/OrgUnit');
const Grade = require('../models/Grade');
const Job = require('../models/Job');
const Position = require('../models/Position');
const Employee = require('../models/Employee');
const ApiError = require('../utils/ApiError');
const { DEPARTMENTS } = require('../config/hr');

const CLUSTER_FOR_DEPARTMENT = {
  Engineering: 'Product & Technology',
  'Human Resources': 'Corporate Services',
  Finance: 'Corporate Services',
  Legal: 'Corporate Services',
  Operations: 'Operations Group',
  'Customer Support': 'Operations Group',
  Sales: 'Commercial',
  Marketing: 'Commercial',
};

const GRADE_SEED = [
  { code: 'M6', name: 'Management Grade 6', category: 'management', rank: 6, salaryMin: 15000, salaryMid: 20000, salaryMax: 28000, probationDays: 90, noticeDays: 90 },
  { code: 'M5', name: 'Management Grade 5', category: 'management', rank: 5, salaryMin: 11000, salaryMid: 15000, salaryMax: 20000, probationDays: 90, noticeDays: 60 },
  { code: 'M4', name: 'Management Grade 4', category: 'management', rank: 4, salaryMin: 8000, salaryMid: 11000, salaryMax: 15000, probationDays: 90, noticeDays: 30 },
  { code: 'M3', name: 'Management Grade 3', category: 'management', rank: 3, salaryMin: 5500, salaryMid: 7500, salaryMax: 10000, probationDays: 90, noticeDays: 30 },
  { code: 'M2', name: 'Management Grade 2', category: 'management', rank: 2, salaryMin: 3500, salaryMid: 5000, salaryMax: 7000, probationDays: 90, noticeDays: 30 },
  { code: 'N2', name: 'Non-management Grade 2', category: 'non_management', rank: 12, salaryMin: 2500, salaryMid: 3500, salaryMax: 5000, probationDays: 60, noticeDays: 30 },
  { code: 'N1', name: 'Non-management Grade 1', category: 'non_management', rank: 11, salaryMin: 1800, salaryMid: 2500, salaryMax: 3500, probationDays: 60, noticeDays: 15 },
];

function slugCode(prefix, name, sequence) {
  const body = String(sequence).padStart(5, '0');
  return `${prefix}-${body}`;
}

function gradeForDesignation(title, department) {
  const text = `${title} ${department}`.toLowerCase();
  if (/head|director|chief/.test(text)) return 'M6';
  if (/manager/.test(text) && /senior/.test(text)) return 'M5';
  if (/manager/.test(text)) return 'M5';
  if (/senior/.test(text)) return 'M4';
  if (/analyst|executive|engineer|officer/.test(text)) return 'M3';
  if (/coordinator|assistant/.test(text)) return 'N2';
  return 'M3';
}

function orgRoleForDesignation(title) {
  const text = String(title || '').toLowerCase();
  if (/head of|director|hod/.test(text)) return 'hod';
  if (/manager/.test(text)) return 'functional_head';
  if (/lead|senior/.test(text)) return 'team_lead';
  return 'worker';
}

async function ensureGrades() {
  for (const row of GRADE_SEED) {
    await Grade.updateOne({ code: row.code }, { $setOnInsert: row }, { upsert: true });
  }
}

async function ensureDepartmentTree() {
  const clusters = {};
  let clusterSeq = 1;
  let deptSeq = 1;
  let teamSeq = 1;

  for (const department of DEPARTMENTS) {
    const clusterName = CLUSTER_FOR_DEPARTMENT[department] || 'Corporate Services';
    if (!clusters[clusterName]) {
      const existing = await OrgUnit.findOne({ type: 'cluster', name: clusterName });
      clusters[clusterName] =
        existing ||
        (await OrgUnit.create({
          type: 'cluster',
          code: slugCode('CLS', clusterName, clusterSeq),
          hierarchyCode: `C${clusterSeq}`,
          name: clusterName,
          status: 'active',
        }));
      clusterSeq += 1;
    }

    let dept = await OrgUnit.findOne({ type: 'department', name: department });
    if (!dept) {
      dept = await OrgUnit.create({
        type: 'department',
        code: slugCode('DEP', department, deptSeq),
        hierarchyCode: `${clusters[clusterName].hierarchyCode}${deptSeq}`,
        name: department,
        parent: clusters[clusterName]._id,
        status: 'active',
      });
    }
    deptSeq += 1;

    const generalName = `${department} General`;
    let general = await OrgUnit.findOne({ type: 'team', name: generalName, parent: dept._id });
    if (!general) {
      general = await OrgUnit.create({
        type: 'team',
        code: slugCode('TEAM', generalName, teamSeq),
        hierarchyCode: `${dept.hierarchyCode}1`,
        name: generalName,
        teamType: 'general',
        parent: dept._id,
        status: 'active',
      });
    }
    teamSeq += 1;
  }
}

async function findDepartmentUnit(departmentName) {
  return OrgUnit.findOne({ type: 'department', name: departmentName, status: 'active' });
}

async function findOrCreateTeam(departmentName, teamName) {
  const dept = await findDepartmentUnit(departmentName);
  if (!dept) throw ApiError.badRequest('Department is not in the organization tree');

  const name = String(teamName || '').trim() || `${departmentName} General`;
  let team = await OrgUnit.findOne({ type: 'team', name, status: { $in: ['active', 'draft'] } });
  if (team) return team;

  const count = await OrgUnit.countDocuments({ type: 'team' });
  team = await OrgUnit.create({
    type: 'team',
    code: slugCode('TEAM', name, count + 1),
    hierarchyCode: `${dept.hierarchyCode}${count + 1}`,
    name,
    teamType: name.endsWith('General') ? 'general' : 'operational',
    parent: dept._id,
    status: 'active',
  });
  return team;
}

async function findOrCreateJob(title) {
  const trimmed = String(title || '').trim();
  if (!trimmed) throw ApiError.badRequest('Job title is required');
  const titleKey = trimmed.toLowerCase();
  const existing = await Job.findOne({ titleKey });
  if (existing) return existing;
  const count = await Job.countDocuments();
  return Job.create({
    code: slugCode('JOB', trimmed, count + 1),
    title: trimmed,
    titleKey,
    status: 'active',
  });
}

async function createSeat(payload) {
  const count = await Position.countDocuments();
  const positionCode = payload.positionCode || slugCode('POS', payload.title, count + 1);
  return Position.create({
    positionCode,
    title: payload.title,
    job: payload.job,
    grade: payload.grade,
    team: payload.team,
    orgRole: payload.orgRole || 'worker',
    reportsToPosition: payload.reportsToPosition || null,
    location: payload.location || '',
    costCenter: payload.costCenter || '',
    fte: payload.fte || 1,
    status: payload.status || 'approved',
    incumbent: payload.incumbent || null,
    effectiveFrom: payload.effectiveFrom || new Date(),
  });
}

async function findOrCreateSeatForEmployee(employee) {
  if (employee.currentPosition) {
    const existing = await Position.findById(employee.currentPosition);
    if (existing && existing.positionCode) return existing;
  }

  const occupied = await Position.findOne({ incumbent: employee._id, status: { $in: ['filled', 'approved'] } });
  if (occupied && occupied.positionCode) return occupied;

  const job = await findOrCreateJob(employee.designation);
  const grade = await Grade.findOne({ code: gradeForDesignation(employee.designation, employee.department) });
  const team = await findOrCreateTeam(employee.department, employee.team);
  const code = `POS-${String(employee.employeeCode || '').replace(/[^0-9]/g, '') || Date.now().toString().slice(-5)}`;

  let seat = await Position.findOne({ positionCode: code });
  if (!seat) {
    seat = await createSeat({
      positionCode: code,
      title: employee.designation,
      job: job._id,
      grade: grade && grade._id,
      team: team._id,
      orgRole: orgRoleForDesignation(employee.designation),
      location: employee.location || 'Karachi HQ',
      status: 'filled',
      incumbent: employee._id,
    });
  } else {
    seat.incumbent = employee._id;
    seat.status = 'filled';
    await seat.save();
  }
  return seat;
}

async function assertPositionAvailable(positionId, employeeId) {
  if (!positionId) return null;
  const position = await Position.findById(positionId).populate('job grade team');
  if (!position) throw ApiError.badRequest('The selected position does not exist');
  if (['closed', 'frozen', 'draft'].indexOf(position.status) !== -1) {
    throw ApiError.badRequest('That position is not available for assignment');
  }
  if (position.incumbent && String(position.incumbent) !== String(employeeId)) {
    throw ApiError.conflict('This position already has an active incumbent');
  }
  return position;
}

async function occupyPosition(position, employee) {
  if (!position) return;
  position.incumbent = employee._id;
  position.status = 'filled';
  await position.save();
  employee.currentPosition = position._id;
}

async function vacatePosition(positionId, employeeId) {
  if (!positionId) return;
  const position = await Position.findById(positionId);
  if (!position) return;
  if (employeeId && position.incumbent && String(position.incumbent) !== String(employeeId)) return;
  position.incumbent = null;
  if (position.status === 'filled') position.status = 'vacant';
  await position.save();
}

function presentUnit(doc) {
  if (!doc) return null;
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  if (json.parent) json.parent = String(json.parent._id || json.parent);
  return json;
}

function presentGrade(doc) {
  if (!doc) return null;
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  return json;
}

function presentJob(doc) {
  if (!doc) return null;
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  return json;
}

function presentPosition(doc) {
  if (!doc) return null;
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  ['job', 'grade', 'team', 'reportsToPosition', 'incumbent'].forEach((field) => {
    if (json[field] && json[field]._id) {
      const nested = json[field].toJSON ? json[field].toJSON() : json[field];
      json[field] = {
        id: String(nested.id || nested._id),
        name: nested.name || nested.title || nested.fullName || nested.code,
        code: nested.code || nested.positionCode,
        title: nested.title,
      };
    } else if (json[field]) {
      json[field] = String(json[field]);
    }
  });
  return json;
}

async function headcountByTeam() {
  const teams = await OrgUnit.find({ type: 'team', status: 'active' }).lean();
  const positions = await Position.find({ status: { $in: ['approved', 'vacant', 'filled'] } }).lean();
  return teams.map((team) => {
    const seats = positions.filter((row) => String(row.team) === String(team._id));
    const approved = seats.reduce((sum, row) => sum + (row.fte || 1), 0);
    const filled = seats.filter((row) => row.status === 'filled').reduce((sum, row) => sum + (row.fte || 1), 0);
    return {
      id: String(team._id),
      name: team.name,
      code: team.code,
      approved,
      filled,
      vacant: Math.max(0, approved - filled),
    };
  });
}

async function dropLegacyPositionIndex() {
  try {
    await Position.collection.dropIndex('titleKey_1');
  } catch (err) {
    /* index may already be gone */
  }
  try {
    await Employee.db.collection('employments').dropIndex('employeeCode_1');
  } catch (err) {
    /* unique code now allows historical employment rows */
  }
  try {
    await Employee.db.collection('employments').dropIndex('employee_1');
  } catch (err) {
    /* unique current employment is enforced in code via isCurrent */
  }
}

async function ensureOrganization() {
  await dropLegacyPositionIndex();
  await ensureGrades();
  await ensureDepartmentTree();
}

module.exports = {
  gradeForDesignation,
  orgRoleForDesignation,
  ensureOrganization,
  ensureGrades,
  findOrCreateTeam,
  findOrCreateJob,
  findDepartmentUnit,
  createSeat,
  findOrCreateSeatForEmployee,
  assertPositionAvailable,
  occupyPosition,
  vacatePosition,
  presentUnit,
  presentGrade,
  presentJob,
  presentPosition,
  headcountByTeam,
};
