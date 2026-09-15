'use strict';

const OrgUnit = require('../models/OrgUnit');
const Grade = require('../models/Grade');
const Job = require('../models/Job');
const Position = require('../models/Position');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const org = require('../services/org.service');
const audit = require('../services/audit.service');

const listUnits = asyncHandler(async (req, res) => {
  await org.ensureOrganization();
  const filter = {};
  if (req.query.type) filter.type = req.query.type;
  if (req.query.status) filter.status = req.query.status;
  const units = await OrgUnit.find(filter).sort({ type: 1, name: 1 });
  res.json({ success: true, units: units.map(org.presentUnit) });
});

const createUnit = asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!body.name || !body.type) throw ApiError.badRequest('Name and type are required');
  const count = await OrgUnit.countDocuments({ type: body.type });
  const unit = await OrgUnit.create({
    type: body.type,
    code: body.code || `${String(body.type).slice(0, 3).toUpperCase()}-${String(count + 1).padStart(5, '0')}`,
    hierarchyCode: body.hierarchyCode || '',
    name: body.name,
    teamType: body.teamType || '',
    parent: body.parent || null,
    location: body.location || '',
    defaultCostCenter: body.defaultCostCenter || '',
    status: body.status || 'active',
  });
  await audit.record(req, { action: 'org_unit_create', objectType: 'OrgUnit', objectId: String(unit._id), summary: unit.name });
  res.status(201).json({ success: true, unit: org.presentUnit(unit) });
});

const listGrades = asyncHandler(async (_req, res) => {
  await org.ensureGrades();
  const grades = await Grade.find().sort({ rank: -1 });
  res.json({ success: true, grades: grades.map(org.presentGrade) });
});

const createGrade = asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!body.code || !body.name) throw ApiError.badRequest('Grade code and name are required');
  const grade = await Grade.create(body);
  res.status(201).json({ success: true, grade: org.presentGrade(grade) });
});

const listJobs = asyncHandler(async (_req, res) => {
  const jobs = await Job.find({ status: 'active' }).sort({ title: 1 });
  res.json({ success: true, jobs: jobs.map(org.presentJob) });
});

const createJob = asyncHandler(async (req, res) => {
  const job = await org.findOrCreateJob(req.body && req.body.title);
  res.status(201).json({ success: true, job: org.presentJob(job) });
});

const listPositions = asyncHandler(async (req, res) => {
  await org.ensureOrganization();
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.team) filter.team = req.query.team;
  const positions = await Position.find(filter)
    .populate('job', 'title code')
    .populate('grade', 'code name')
    .populate('team', 'name code')
    .populate('incumbent', 'firstName lastName employeeCode')
    .sort({ positionCode: 1 });
  res.json({ success: true, positions: positions.map(org.presentPosition) });
});

const createPosition = asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!body.title) throw ApiError.badRequest('Position title is required');
  if (!body.team) throw ApiError.badRequest('A position must belong to a team');
  if (!body.grade) throw ApiError.badRequest('A position must be linked to a grade');
  const job = body.job ? body.job : (await org.findOrCreateJob(body.title))._id;
  const seat = await org.createSeat({
    title: body.title,
    job,
    grade: body.grade,
    team: body.team,
    orgRole: body.orgRole || 'worker',
    reportsToPosition: body.reportsToPosition || null,
    location: body.location || '',
    costCenter: body.costCenter || '',
    fte: body.fte || 1,
    status: body.status || 'vacant',
  });
  await audit.record(req, { action: 'position_create', objectType: 'Position', objectId: String(seat._id), summary: seat.positionCode });
  res.status(201).json({ success: true, position: org.presentPosition(seat) });
});

module.exports = {
  listUnits,
  createUnit,
  listGrades,
  createGrade,
  listJobs,
  createJob,
  listPositions,
  createPosition,
};
