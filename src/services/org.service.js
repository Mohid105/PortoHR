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

/** Departments are whatever the org tree says they are; HR can add more at any time. */
async function departmentNames() {
  const units = await OrgUnit.find({ type: 'department', status: 'active' }).select('name').sort({ name: 1 });
  const names = units.map((unit) => unit.name);
  return names.length ? names : DEPARTMENTS.slice();
}

/** Locations HR has configured, plus any already in use, plus the starter set. */
async function locationNames() {
  const LookupValue = require('../models/LookupValue');
  const { LOCATIONS } = require('../config/hr');
  const [configured, used] = await Promise.all([
    LookupValue.find({ category: 'location', active: true }).select('label'),
    Employee.distinct('location'),
  ]);
  const names = new Set(LOCATIONS);
  configured.forEach((row) => names.add(row.label));
  used.filter(Boolean).forEach((name) => names.add(name));
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

async function assertDepartment(name) {
  if (name === undefined || name === null || name === '') return;
  const names = await departmentNames();
  if (!names.includes(String(name))) {
    throw ApiError.badRequest(`"${name}" is not a department in the organization tree. Add it under Admin → Departments first.`);
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
  // A grade chosen by HR wins; the title-based guess is only for records that have none.
  const chosen = employee.grade ? await Grade.findOne({ code: String(employee.grade).toUpperCase() }) : null;
  const grade = chosen || (await Grade.findOne({ code: gradeForDesignation(employee.designation, employee.department) }));
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

/* ---------------- Department management ---------------- */

const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function nextCode(type, prefix) {
  const rows = await OrgUnit.find({ type }).select('code');
  const max = rows.reduce((top, row) => {
    const match = /(\d+)$/.exec(row.code || '');
    return match ? Math.max(top, Number(match[1])) : top;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(5, '0')}`;
}

async function listDepartments() {
  await ensureOrganization();
  const [departments, clusters, employees] = await Promise.all([
    OrgUnit.find({ type: 'department' }).sort({ name: 1 }),
    OrgUnit.find({ type: 'cluster' }).sort({ name: 1 }),
    Employee.aggregate([
      { $match: { employmentStatus: { $in: ['probation', 'confirmed', 'notice_period'] } } },
      { $group: { _id: '$department', count: { $sum: 1 } } },
    ]),
  ]);
  const headcount = new Map(employees.map((row) => [row._id, row.count]));
  const clusterName = new Map(clusters.map((row) => [String(row._id), row.name]));
  return {
    clusters: clusters.map(presentUnit),
    departments: departments.map((unit) => ({
      ...presentUnit(unit),
      clusterName: clusterName.get(String(unit.parent)) || '',
      headcount: headcount.get(unit.name) || 0,
    })),
  };
}

async function createDepartment(body) {
  const name = String(body.name || '').trim();
  if (!name) throw ApiError.badRequest('Department name is required');
  if (await OrgUnit.findOne({ type: 'department', name: new RegExp(`^${escapeRegex(name)}$`, 'i') })) {
    throw ApiError.conflict('A department with this name already exists');
  }

  let cluster = null;
  if (body.cluster) {
    cluster = await OrgUnit.findOne({ type: 'cluster', _id: body.cluster });
    if (!cluster) throw ApiError.badRequest('Choose an existing cluster');
  } else {
    const clusterLabel = String(body.clusterName || '').trim() || 'Corporate Services';
    cluster = await OrgUnit.findOne({ type: 'cluster', name: clusterLabel });
    if (!cluster) {
      cluster = await OrgUnit.create({
        type: 'cluster',
        code: await nextCode('cluster', 'CLS'),
        hierarchyCode: `C${(await OrgUnit.countDocuments({ type: 'cluster' })) + 1}`,
        name: clusterLabel,
        status: 'active',
      });
    }
  }

  const siblings = await OrgUnit.countDocuments({ type: 'department', parent: cluster._id });
  const department = await OrgUnit.create({
    type: 'department',
    code: await nextCode('department', 'DEP'),
    hierarchyCode: `${cluster.hierarchyCode}${siblings + 1}`,
    name,
    parent: cluster._id,
    status: 'active',
  });
  await OrgUnit.create({
    type: 'team',
    code: await nextCode('team', 'TEAM'),
    hierarchyCode: `${department.hierarchyCode}1`,
    name: `${name} General`,
    teamType: 'general',
    parent: department._id,
    status: 'active',
  });
  return department;
}

/** Names are copied onto people and assignments, so a rename must follow them. */
async function updateDepartment(id, body) {
  const unit = await OrgUnit.findOne({ _id: id, type: 'department' });
  if (!unit) throw ApiError.notFound('Department not found');
  const Assignment = require('../models/Assignment');
  const Requisition = require('../models/Requisition');
  const oldName = unit.name;

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) throw ApiError.badRequest('Department name is required');
    const clash = await OrgUnit.findOne({
      type: 'department',
      _id: { $ne: unit._id },
      name: new RegExp(`^${escapeRegex(name)}$`, 'i'),
    });
    if (clash) throw ApiError.conflict('A department with this name already exists');
    unit.name = name;
  }

  if (body.status !== undefined) {
    if (!['active', 'inactive'].includes(body.status)) throw ApiError.badRequest('Status must be active or inactive');
    if (body.status === 'inactive') {
      const staff = await Employee.countDocuments({
        department: oldName,
        employmentStatus: { $in: ['probation', 'confirmed', 'notice_period'] },
      });
      if (staff) throw ApiError.badRequest(`Move the ${staff} active employee(s) out of ${oldName} before closing it`);
    }
    unit.status = body.status;
  }

  await unit.save();
  if (unit.name !== oldName) {
    await Promise.all([
      Employee.updateMany({ department: oldName }, { $set: { department: unit.name } }),
      Assignment.updateMany({ department: oldName }, { $set: { department: unit.name } }),
      Requisition.updateMany({ department: oldName }, { $set: { department: unit.name } }),
      OrgUnit.updateMany({ type: 'team', parent: unit._id, name: `${oldName} General` }, { $set: { name: `${unit.name} General` } }),
    ]);
  }
  return unit;
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
  locationNames,
  listDepartments,
  createDepartment,
  updateDepartment,
  departmentNames,
  assertDepartment,
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
