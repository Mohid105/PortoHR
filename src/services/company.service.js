'use strict';

/**
 * Company hub: announcements, people moments, the org chart and offboarding.
 * Only directory-grade facts leave this file — never pay, never a birth year.
 */

const Announcement = require('../models/Announcement');
const Employee = require('../models/Employee');
const ExitTask = require('../models/ExitTask');
const ApiError = require('../utils/ApiError');
const access = require('./access.service');
const { CATEGORIES } = Announcement;

const ACTIVE_STATUSES = ['probation', 'confirmed', 'notice_period'];

function present(doc) {
  const json = doc.toJSON();
  json.id = String(json.id || json._id);
  return json;
}

/* ---------------- Announcements ---------------- */

async function listAnnouncements({ includeExpired } = {}) {
  const now = new Date();
  const filter = includeExpired
    ? {}
    : { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }], publishedAt: { $lte: now } };
  const rows = await Announcement.find(filter).sort({ pinned: -1, publishedAt: -1 }).limit(50);
  return rows.map(present);
}

function readAnnouncementBody(body) {
  const title = String(body.title || '').trim();
  const text = String(body.body || '').trim();
  if (!title) throw ApiError.badRequest('A headline is required');
  if (!text) throw ApiError.badRequest('The announcement needs some text');
  if (body.category && !CATEGORIES.includes(body.category)) throw ApiError.badRequest('Unknown category');
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw ApiError.badRequest('Expiry date is not valid');
  return { title, body: text, category: body.category || 'general', pinned: Boolean(body.pinned), expiresAt };
}

async function createAnnouncement(body, user) {
  const row = await Announcement.create({
    ...readAnnouncementBody(body),
    author: user._id,
    authorName: `${user.firstName} ${user.lastName}`.trim(),
  });
  return present(row);
}

async function updateAnnouncement(id, body) {
  const row = await Announcement.findById(id);
  if (!row) throw ApiError.notFound('Announcement not found');
  Object.assign(row, readAnnouncementBody({ ...row.toObject(), ...body }));
  await row.save();
  return present(row);
}

async function deleteAnnouncement(id) {
  const row = await Announcement.findByIdAndDelete(id);
  if (!row) throw ApiError.notFound('Announcement not found');
}

/* ---------------- People moments ---------------- */

/** Days from `from` until the next occurrence of month/day (0 = today). */
function daysUntilAnniversary(date, from) {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let next = new Date(today.getFullYear(), date.getMonth(), date.getDate());
  if (next < today) next = new Date(today.getFullYear() + 1, date.getMonth(), date.getDate());
  return Math.round((next - today) / 86400000);
}

async function moments(windowDays = 30) {
  const now = new Date();
  const rows = await Employee.find({ employmentStatus: { $in: ACTIVE_STATUSES } }).select(
    'firstName lastName designation department dateOfBirth dateOfJoining'
  );

  const birthdays = [];
  const anniversaries = [];
  const newJoiners = [];

  rows.forEach((row) => {
    const base = { id: String(row._id), fullName: row.fullName, designation: row.designation, department: row.department };
    if (row.dateOfBirth) {
      const days = daysUntilAnniversary(row.dateOfBirth, now);
      if (days <= windowDays) birthdays.push({ ...base, inDays: days, month: row.dateOfBirth.getMonth(), day: row.dateOfBirth.getDate() });
    }
    if (row.dateOfJoining) {
      const joined = row.dateOfJoining;
      const years = now.getFullYear() - joined.getFullYear();
      const days = daysUntilAnniversary(joined, now);
      const turning = days === 0 ? years : years + (new Date(now.getFullYear(), joined.getMonth(), joined.getDate()) < now ? 1 : 0);
      if (turning >= 1 && days <= windowDays) anniversaries.push({ ...base, inDays: days, years: turning });
      const ageDays = Math.round((now - joined) / 86400000);
      if (ageDays >= 0 && ageDays <= windowDays) newJoiners.push({ ...base, joinedOn: joined });
    }
  });

  const byDays = (a, b) => a.inDays - b.inDays || a.fullName.localeCompare(b.fullName);
  birthdays.sort(byDays);
  anniversaries.sort(byDays);
  newJoiners.sort((a, b) => b.joinedOn - a.joinedOn);
  return { windowDays, birthdays, anniversaries, newJoiners };
}

/* ---------------- Org chart ---------------- */

async function orgChart() {
  const rows = await Employee.find({ employmentStatus: { $in: ACTIVE_STATUSES } })
    .select('employeeCode firstName lastName designation department reportsTo')
    .sort({ firstName: 1 });

  const nodes = new Map();
  rows.forEach((row) => {
    nodes.set(String(row._id), {
      id: String(row._id),
      code: row.employeeCode,
      fullName: row.fullName,
      designation: row.designation,
      department: row.department,
      reports: [],
      _parent: row.reportsTo ? String(row.reportsTo) : null,
    });
  });

  const roots = [];
  nodes.forEach((node) => {
    const parent = node._parent && node._parent !== node.id ? nodes.get(node._parent) : null;
    if (parent) parent.reports.push(node);
    else roots.push(node);
  });

  // A reporting loop would never reach a root; surface those rows rather than hide people.
  const seen = new Set();
  const walk = (node) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    node.reports.forEach(walk);
  };
  roots.forEach(walk);
  nodes.forEach((node) => {
    if (!seen.has(node.id)) {
      roots.push(node);
      walk(node);
    }
  });

  const size = (node) => {
    node.teamSize = node.reports.reduce((sum, child) => sum + 1 + size(child), 0);
    delete node._parent;
    return node.teamSize;
  };
  roots.forEach(size);
  roots.sort((a, b) => b.teamSize - a.teamSize);
  return { total: rows.length, roots };
}

/* ---------------- Offboarding ---------------- */

const EXIT_CHECKLIST = [
  { key: 'resignation_accepted', title: 'Record and accept resignation / termination notice', owner: 'hr', offset: -7 },
  { key: 'handover', title: 'Hand over work, files and responsibilities', owner: 'manager', offset: -3 },
  { key: 'knowledge_transfer', title: 'Knowledge-transfer sessions held', owner: 'manager', offset: -3 },
  { key: 'assets_returned', title: 'Return laptop, ID card and company assets', owner: 'it', offset: 0 },
  { key: 'access_revoked', title: 'Revoke system and email access (deactivates the PortoHR login)', owner: 'it', offset: 0 },
  { key: 'exit_interview', title: 'Conduct exit interview', owner: 'hr', offset: -2 },
  { key: 'dues_cleared', title: 'Clear loans, advances and other dues', owner: 'finance', offset: 0 },
  { key: 'final_settlement', title: 'Process final settlement and last payslip', owner: 'finance', offset: 5 },
  { key: 'experience_letter', title: 'Issue experience / relieving letter', owner: 'hr', offset: 5 },
];

function shiftDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Idempotent: safe to call again if the checklist already exists. */
async function startOffboarding(employee) {
  const lastDay = (employee.lastWorkingDay && new Date(employee.lastWorkingDay)) || new Date();
  const existing = await ExitTask.find({ employee: employee._id }).select('key');
  const have = new Set(existing.map((row) => row.key));
  const missing = EXIT_CHECKLIST.filter((item) => !have.has(item.key));
  if (missing.length) {
    await ExitTask.insertMany(
      missing.map((item) => ({
        employee: employee._id,
        key: item.key,
        title: item.title,
        owner: item.owner,
        dueOn: shiftDays(lastDay, item.offset),
      }))
    );
  }
  return ExitTask.countDocuments({ employee: employee._id });
}

async function listOffboarding() {
  const tasks = await ExitTask.find({}).sort({ dueOn: 1 });
  const ids = Array.from(new Set(tasks.map((task) => String(task.employee))));
  const employees = await Employee.find({ _id: { $in: ids } }).select(
    'employeeCode firstName lastName designation department employmentStatus lastWorkingDay'
  );
  const order = new Map(EXIT_CHECKLIST.map((item, i) => [item.key, i]));

  return employees
    .map((employee) => {
      const mine = tasks
        .filter((task) => String(task.employee) === String(employee._id))
        .sort((a, b) => (order.get(a.key) || 0) - (order.get(b.key) || 0))
        .map(present);
      const done = mine.filter((task) => task.status === 'done').length;
      return {
        id: String(employee._id),
        code: employee.employeeCode,
        fullName: employee.fullName,
        designation: employee.designation,
        department: employee.department,
        status: employee.employmentStatus,
        lastWorkingDay: employee.lastWorkingDay,
        done,
        total: mine.length,
        complete: done === mine.length,
        tasks: mine,
      };
    })
    .sort((a, b) => Number(a.complete) - Number(b.complete) || new Date(a.lastWorkingDay || 0) - new Date(b.lastWorkingDay || 0));
}

async function setExitTask(id, body, user) {
  const task = await ExitTask.findById(id);
  if (!task) throw ApiError.notFound('Checklist item not found');
  const done = body.done !== undefined ? Boolean(body.done) : task.status !== 'done';

  task.status = done ? 'done' : 'pending';
  task.doneAt = done ? new Date() : null;
  task.doneBy = done ? user._id : null;
  if (body.note !== undefined) task.note = String(body.note).slice(0, 300);
  await task.save();

  let loginDeactivated = false;
  if (done && task.key === 'access_revoked') {
    const employee = await Employee.findById(task.employee);
    if (employee) loginDeactivated = await access.deactivateForEmployee(employee);
  }
  return { task: present(task), loginDeactivated };
}

/* ---------------- Workforce pulse (HR and managers) ---------------- */

const DAY = 86400000;

/**
 * Attrition over the last 12 months: leavers divided by the average headcount
 * across the period. Returns null while there is no history to speak of.
 */
function attritionRate(leavers, headcountNow, headcountYearAgo) {
  const average = (headcountNow + headcountYearAgo) / 2;
  if (!average) return null;
  return Math.round((leavers / average) * 1000) / 10;
}

async function pulse(user, scopeIds) {
  const LeaveRequest = require('../models/LeaveRequest');
  const Requisition = require('../models/Requisition');
  const Payslip = require('../models/Payslip');
  const FinalSettlement = require('../models/FinalSettlement');
  const User = require('../models/User');
  const profile = require('./profile.service');
  const isHr = user.role === 'hr_admin';
  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const yearAgo = new Date(today.getTime() - 365 * DAY);
  const in30 = new Date(today.getTime() + 30 * DAY);
  const in60 = new Date(today.getTime() + 60 * DAY);
  const scope = scopeIds ? { _id: { $in: scopeIds } } : {};

  const [active, newHires, leavers, headcountYearAgo, byDepartment, onNotice, probation, onLeave] = await Promise.all([
    Employee.countDocuments({ ...scope, employmentStatus: { $in: ACTIVE_STATUSES } }),
    Employee.countDocuments({ ...scope, employmentStatus: { $in: ACTIVE_STATUSES }, dateOfJoining: { $gte: new Date(today.getTime() - 30 * DAY) } }),
    Employee.countDocuments({ ...scope, employmentStatus: { $in: ['resigned', 'terminated'] }, lastWorkingDay: { $gte: yearAgo, $lte: today } }),
    Employee.countDocuments({
      ...scope,
      dateOfJoining: { $lte: yearAgo },
      $or: [{ lastWorkingDay: null }, { lastWorkingDay: { $gt: yearAgo } }],
    }),
    Employee.aggregate([
      { $match: { ...scope, employmentStatus: { $in: ACTIVE_STATUSES } } },
      { $group: { _id: '$department', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 6 },
    ]),
    Employee.countDocuments({ ...scope, employmentStatus: 'notice_period' }),
    Employee.find({ ...scope, employmentStatus: 'probation', probationEndDate: { $lte: in30 } })
      .select('firstName lastName probationEndDate')
      .sort({ probationEndDate: 1 })
      .limit(8),
    LeaveRequest.find({ status: 'approved', fromDate: { $lte: today }, toDate: { $gte: today }, ...(scopeIds ? { employee: { $in: scopeIds } } : {}) }).limit(40),
  ]);

  const awayNames = onLeave.slice(0, 6).map((row) => ({ name: row.snapshot && row.snapshot.fullName, type: row.leaveType }));

  const attention = [];
  const add = (type, severity, message, href) => attention.push({ type, severity, message, href });

  if (probation.length) add('probation', 'medium', `${probation.length} probation period(s) end within 30 days`, '/core-hr.html');
  const alerts = await profile.collectAlerts(scopeIds);
  const countOf = (type) => alerts.filter((a) => a.type === type).length;
  if (countOf('document_expiry')) add('documents', 'medium', `${countOf('document_expiry')} document(s) expire within 30 days`, '/core-hr.html');
  if (countOf('pending_assignment')) add('changes', 'high', `${countOf('pending_assignment')} employment change(s) waiting for a checker`, '/core-hr.html');
  if (countOf('pending_bank')) add('bank', 'high', `${countOf('pending_bank')} bank detail change(s) waiting for approval`, '/core-hr.html');

  let openRequisitions = null;
  if (isHr) {
    const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const previousMonth = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`;
    const [reqs, slips, pendingSettlements, openExit, noLogin, locked] = await Promise.all([
      Requisition.countDocuments({ status: 'open' }),
      Payslip.countDocuments({ month: previousMonth }),
      Employee.countDocuments({ employmentStatus: { $in: ['resigned', 'terminated'] }, lastWorkingDay: { $ne: null } }).then(async (leaversTotal) => {
        if (!leaversTotal) return 0;
        const settled = await FinalSettlement.distinct('employee');
        return Employee.countDocuments({ employmentStatus: { $in: ['resigned', 'terminated'] }, lastWorkingDay: { $ne: null }, _id: { $nin: settled } });
      }),
      ExitTask.countDocuments({ status: 'pending' }),
      Employee.countDocuments({ employmentStatus: { $in: ACTIVE_STATUSES }, $or: [{ userAccount: null }, { userAccount: { $exists: false } }] }),
      User.countDocuments({ lockedUntil: { $gt: now } }),
    ]);
    openRequisitions = reqs;
    if (!slips && active) add('payroll', 'high', `Payroll for ${previousMonth} has not been generated`, '/payroll.html');
    if (pendingSettlements) add('settlements', 'high', `${pendingSettlements} leaver(s) awaiting a final settlement`, '/payroll.html');
    if (openExit) add('offboarding', 'medium', `${openExit} offboarding checklist item(s) still open`, '/company.html#exit');
    if (noLogin) add('logins', 'low', `${noLogin} active employee(s) cannot sign in yet`, '/admin.html');
    if (locked) add('locked', 'medium', `${locked} account(s) locked after failed sign-ins`, '/admin.html');
  }

  const order = { high: 0, medium: 1, low: 2 };
  attention.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    scope: isHr ? 'company' : 'team',
    headcount: active,
    newHires,
    leavers,
    attritionPct: attritionRate(leavers, active, headcountYearAgo),
    onNotice,
    onLeaveToday: onLeave.length,
    awayToday: awayNames,
    openRequisitions,
    byDepartment: byDepartment.map((row) => ({ department: row._id || 'Unassigned', count: row.count })),
    probationEnding: probation.map((row) => ({ id: String(row._id), fullName: row.fullName, date: row.probationEndDate })),
    attention,
    asOf: now,
  };
}

module.exports = {
  attritionRate,
  pulse,
  daysUntilAnniversary,
  listAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  moments,
  orgChart,
  startOffboarding,
  listOffboarding,
  setExitTask,
};
