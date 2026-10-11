'use strict';

/**
 * The report for one employee: everything the system knows about them, cut
 * into sections that each carry a summary and tables. The same structure is
 * drawn on screen, printed, and written out as CSV, so the three can never
 * disagree. A section appears only if the viewer may already see that data
 * in its own module: HR sees all, the employee sees their own file, and a
 * manager sees their direct reports.
 */

const Employee = require('../../models/Employee');
const Person = require('../../models/Person');
const Assignment = require('../../models/Assignment');
const Attendance = require('../../models/Attendance');
const LeaveRequest = require('../../models/LeaveRequest');
const Payslip = require('../../models/Payslip');
const Loan = require('../../models/Loan');
const AssetAssignment = require('../../models/AssetAssignment');
const Appraisal = require('../../models/Appraisal');
const Objective = require('../../models/Objective');
const Enrollment = require('../../models/Enrollment');
const CertificationRecord = require('../../models/CertificationRecord');
const EmployeeDocument = require('../../models/EmployeeDocument');
const EmployeeReward = require('../../models/EmployeeReward');
const Qualification = require('../../models/Qualification');
const WorkExperience = require('../../models/WorkExperience');
const FamilyMember = require('../../models/FamilyMember');
const Address = require('../../models/Address');
const BankAccount = require('../../models/BankAccount');
const StatutoryEnrollment = require('../../models/StatutoryEnrollment');
const HireTask = require('../../models/HireTask');
const ExitTask = require('../../models/ExitTask');
const ErCase = require('../../models/ErCase');
const AuditLog = require('../../models/AuditLog');
require('../../models/Asset');
require('../../models/Course');
require('../../models/Position');
const ApiError = require('../../utils/ApiError');
const env = require('../../config/env');
const zoned = require('../../utils/zoned');
const leaveService = require('../leave.service');
const { ROLES } = require('../../config/roles');
const { PERSONNEL_EVENT_LABELS, EMPLOYEE_CATEGORY_LABELS, PAY_GROUP_LABELS, NATIONALITY_LABELS, DOCUMENT_TYPE_LABELS, STATUTORY_SCHEME_LABELS } = require('../../config/org');
const { EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS } = require('../../config/hr');
const { maskAccount, maskNationalId } = require('../../utils/mask');

const SECTIONS = [
  { key: 'profile', title: 'Profile & employment' },
  { key: 'compensation', title: 'Compensation' },
  { key: 'history', title: 'Career history' },
  { key: 'attendance', title: 'Attendance' },
  { key: 'leave', title: 'Leave' },
  { key: 'payroll', title: 'Payroll' },
  { key: 'loans', title: 'Loans' },
  { key: 'assets', title: 'Assets' },
  { key: 'performance', title: 'Performance' },
  { key: 'training', title: 'Training & certificates' },
  { key: 'documents', title: 'Documents' },
  { key: 'rewards', title: 'Rewards & recognition' },
  { key: 'background', title: 'Personal background' },
  { key: 'onboarding', title: 'Onboarding & offboarding' },
  { key: 'cases', title: 'Employee-relations cases' },
  { key: 'audit', title: 'Change log' },
];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const dayKey = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);
const nameOf = (e) => (e ? [e.firstName, e.lastName].filter(Boolean).join(' ') : '');
const cap = (text) => { const s = String(text || '').replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); };
const label = (map, value) => (value ? (map && map[value]) || cap(value) : null);
const today = () => zoned.dateKey(new Date(), env.timezone);
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);

const item = (name, value, type, extra) => Object.assign({ label: name, value: value === undefined || value === '' ? null : value, type: type || 'text' }, extra);
const col = (key, name, type) => ({ key, label: name, type: type || 'text' });
const table = (title, columns, rows, extra) => Object.assign({ title, columns, rows }, extra);
const section = (key, summary, tables, extra) => Object.assign({ key, title: SECTIONS.find((s) => s.key === key).title, summary: summary || [], tables: tables || [] }, extra);

/** What this viewer may see of this employee. */
function accessFor(user, viewerEmployee, employee, managerOfEmployee) {
  const isHr = user.role === ROLES.HR_ADMIN;
  const isSelf = Boolean(viewerEmployee && String(viewerEmployee._id) === String(employee._id)) || employee.email === user.email;
  const isManager = !isSelf && managerOfEmployee;
  return { isHr, isSelf, isManager, pay: isHr || isSelf || isManager, personal: isHr || isSelf };
}

function availableSections(access) {
  return SECTIONS.filter((s) => {
    if (['compensation', 'payroll', 'loans'].includes(s.key)) return access.pay;
    if (s.key === 'background') return access.personal;
    if (['cases', 'audit'].includes(s.key)) return access.isHr;
    return true;
  });
}

/** Normalises the period the report covers: day keys, never wider than five years. */
function periodFrom(query, employee) {
  const now = today();
  const preset = String(query.preset || '');
  let from = String(query.from || '');
  let to = String(query.to || '');
  if (preset === 'this_month') { from = `${now.slice(0, 7)}-01`; to = now; }
  else if (preset === 'last_month') {
    const first = `${now.slice(0, 7)}-01`;
    to = zoned.addDays(first, -1);
    from = `${to.slice(0, 7)}-01`;
  } else if (preset === 'last_12_months') { from = zoned.addDays(now, -365); to = now; }
  else if (preset === 'since_joining') { from = dayKey(employee.dateOfJoining) || `${now.slice(0, 4)}-01-01`; to = now; }
  else if (preset === 'last_year') { from = `${Number(now.slice(0, 4)) - 1}-01-01`; to = `${Number(now.slice(0, 4)) - 1}-12-31`; }
  if (!from && !to) { from = `${now.slice(0, 4)}-01-01`; to = now; }
  if (!from) from = `${to.slice(0, 4)}-01-01`;
  if (!to) to = now;
  const valid = (k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && !Number.isNaN(new Date(`${k}T00:00:00Z`).getTime()) && new Date(`${k}T00:00:00Z`).toISOString().slice(0, 10) === k;
  if (!valid(from) || !valid(to)) throw ApiError.badRequest('Choose a valid period');
  if (from > to) throw ApiError.badRequest('The period starts after it ends');
  if (daysBetween(from, to) > 366 * 5) throw ApiError.badRequest('A report can cover at most five years');
  return { from, to, label: from === to ? from : `${from} to ${to}`, fromMonth: from.slice(0, 7), toMonth: to.slice(0, 7) };
}

/* -------------------------------------------------------------------- sections */

async function profile(ctx) {
  const { employee, person, access } = ctx;
  await employee.populate('reportsTo', 'firstName lastName employeeCode');
  const tenureEnd = employee.lastWorkingDay ? dayKey(employee.lastWorkingDay) : today();
  const tenureDays = employee.dateOfJoining ? Math.max(0, daysBetween(dayKey(employee.dateOfJoining), tenureEnd)) : null;
  const years = tenureDays === null ? null : Math.floor(tenureDays / 365.25);
  const months = tenureDays === null ? null : Math.floor((tenureDays - years * 365.25) / 30.44);
  const rows = [
    item('Employee code', employee.employeeCode),
    item('Name', nameOf(employee)),
    item('Preferred name', employee.preferredName),
    item('Designation', employee.designation),
    item('Department', employee.department),
    item('Team', employee.team),
    item('Grade', employee.grade),
    item('Reports to', employee.reportsTo ? `${nameOf(employee.reportsTo)} (${employee.reportsTo.employeeCode})` : null),
    item('Location', employee.location),
    item('Legal entity', employee.legalEntity),
    item('Category', label(EMPLOYEE_CATEGORY_LABELS, employee.employeeCategory)),
    item('Employment type', label(EMPLOYMENT_TYPE_LABELS, employee.employmentType)),
    item('Status', label(EMPLOYMENT_STATUS_LABELS, employee.employmentStatus), 'text', { tone: ['resigned', 'terminated'].includes(employee.employmentStatus) ? 'bad' : employee.employmentStatus === 'notice_period' ? 'warn' : 'ok' }),
    item('Date of joining', dayKey(employee.dateOfJoining), 'date'),
    item('Time with the company', tenureDays === null ? null : `${years} yr ${months} mo`),
    item('Probation ends', dayKey(employee.probationEndDate), 'date'),
    item('Confirmed on', dayKey(employee.confirmationDate), 'date'),
    item('Last working day', dayKey(employee.lastWorkingDay), 'date'),
    item('Pay group', label(PAY_GROUP_LABELS, employee.payGroup)),
    item('Shift', employee.shiftType ? cap(employee.shiftType) : null),
    item('Weekly rest days', (employee.restDays || []).map(cap).join(', ')),
    item('Attendance', employee.attendanceMode === 'exempt' ? 'Exempt from clocking' : 'Clocks in and out'),
    item('Annual leave entitlement', employee.annualLeaveDays, 'number'),
    item('Work email', employee.email),
    item('Phone', employee.phone),
    item('Gender', employee.gender ? cap(employee.gender) : null),
  ];
  if (person) {
    rows.push(item('Nationality', label(NATIONALITY_LABELS, person.nationality)));
    rows.push(item('Marital status', person.maritalStatus ? cap(person.maritalStatus) : null));
    if (access.personal) {
      rows.push(item('Date of birth', dayKey(person.dateOfBirth || employee.dateOfBirth), 'date'));
      rows.push(item('Blood group', person.bloodGroup));
      rows.push(item('Personal email', person.personalEmail));
      rows.push(item('Personal mobile', person.mobile));
    }
  }
  return section('profile', rows.filter((r) => r.value !== null), []);
}

async function compensation(ctx) {
  const { employee } = ctx;
  const comp = employee.compensation || {};
  const allowances = comp.fixedAllowances || [];
  const total = allowances.reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const base = Number(comp.baseSalary) || 0;
  const currency = comp.currency || 'PKR';
  return section('compensation', [
    item('Currency', currency),
    item('Basic salary', base, 'money', { currency }),
    item('Fixed allowances', total, 'money', { currency }),
    item('Gross monthly pay', base + total, 'money', { currency, strong: true }),
  ], allowances.length ? [table('Fixed allowances', [col('label', 'Allowance'), col('amount', 'Per month', 'money')], allowances.map((a) => ({ label: a.label, amount: a.amount })), { currency })] : []);
}

async function history(ctx) {
  const { employee, access } = ctx;
  const rows = await Assignment.find({ employee: employee._id, status: { $in: ['active', 'superseded', 'scheduled'] } })
    .populate('reportsTo', 'firstName lastName').sort({ effectiveFrom: -1 }).lean();
  const columns = [col('effectiveFrom', 'Effective', 'date'), col('event', 'Event'), col('designation', 'Designation'), col('department', 'Department'), col('team', 'Team'), col('grade', 'Grade'), col('location', 'Location'), col('manager', 'Manager')];
  if (access.pay) columns.push(col('baseSalary', 'Basic salary', 'money'));
  columns.push(col('reason', 'Reason'));
  return section('history', [item('Changes on record', rows.length, 'number')], [table('Assignments', columns, rows.map((a) => ({
    effectiveFrom: dayKey(a.effectiveFrom),
    event: label(PERSONNEL_EVENT_LABELS, a.event) || (a.status === 'scheduled' ? 'Scheduled change' : 'Change'),
    designation: a.designation,
    department: a.department,
    team: a.team,
    grade: a.gradeCode,
    location: a.location,
    manager: nameOf(a.reportsTo),
    baseSalary: access.pay ? getBase(a) : undefined,
    reason: a.eventReason ? cap(a.eventReason) : a.reason || '',
  })))]);
}
const getBase = (a) => (a.compensation ? a.compensation.baseSalary : null);

async function attendance(ctx) {
  const { employee, period } = ctx;
  const rows = await Attendance.find({
    employee: employee._id,
    date: { $gte: new Date(`${period.from}T00:00:00Z`), $lte: new Date(`${period.to}T00:00:00Z`) },
  }).sort({ date: 1 }).lean();
  const count = (status) => rows.filter((r) => r.shiftStatus === status).length;
  const present = count('present');
  const short = count('short_day');
  const absent = count('absent');
  const onLeave = count('on_leave');
  const worked = rows.reduce((s, r) => s + (Number(r.hoursWorked) || 0), 0);
  const late = rows.filter((r) => (Number(r.lateMinutes) || 0) > 0);
  const countable = present + short + absent;
  const byMonth = new Map();
  rows.forEach((r) => {
    const key = dayKey(r.date).slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, { month: key, present: 0, short: 0, absent: 0, leave: 0, late: 0, overtime: 0, hours: 0 });
    const m = byMonth.get(key);
    if (r.shiftStatus === 'present') m.present += 1;
    else if (r.shiftStatus === 'short_day') m.short += 1;
    else if (r.shiftStatus === 'absent') m.absent += 1;
    else if (r.shiftStatus === 'on_leave') m.leave += 1;
    if ((Number(r.lateMinutes) || 0) > 0) m.late += 1;
    m.overtime += Number(r.overtimeHours) || 0;
    m.hours += Number(r.hoursWorked) || 0;
  });
  const exceptions = rows.filter((r) => ['absent', 'short_day'].includes(r.shiftStatus) || (Number(r.lateMinutes) || 0) > 0).slice(-60).reverse();
  return section('attendance', [
    item('Days recorded', rows.length, 'number'),
    item('Present', present, 'number'),
    item('Short days', short, 'number', { tone: short ? 'warn' : undefined }),
    item('Absent', absent, 'number', { tone: absent ? 'bad' : undefined }),
    item('On leave', onLeave, 'number'),
    item('Attendance rate', countable ? round2(((present + short) / countable) * 100) : null, 'percent'),
    item('Hours worked', round2(worked), 'hours'),
    item('Average hours per day worked', present + short ? round2(worked / (present + short)) : null, 'hours'),
    item('Overtime', round2(rows.reduce((s, r) => s + (Number(r.overtimeHours) || 0), 0)), 'hours'),
    item('Late arrivals', late.length, 'number', { tone: late.length > 3 ? 'warn' : undefined }),
    item('Minutes late in total', late.reduce((s, r) => s + (Number(r.lateMinutes) || 0), 0), 'number'),
  ], [
    table('By month', [col('month', 'Month'), col('present', 'Present', 'number'), col('short', 'Short days', 'number'), col('absent', 'Absent', 'number'), col('leave', 'Leave', 'number'), col('late', 'Late', 'number'), col('overtime', 'Overtime hours', 'hours'), col('hours', 'Hours worked', 'hours')],
      [...byMonth.values()].map((m) => Object.assign(m, { overtime: round2(m.overtime), hours: round2(m.hours) }))),
    table('Absences, short days and late arrivals', [col('date', 'Date', 'date'), col('status', 'Status'), col('timeIn', 'In', 'time'), col('timeOut', 'Out', 'time'), col('hours', 'Hours', 'hours'), col('late', 'Late (min)', 'number')],
      exceptions.map((r) => ({ date: dayKey(r.date), status: cap(r.shiftStatus), timeIn: r.timeIn ? new Date(r.timeIn).toISOString() : null, timeOut: r.timeOut ? new Date(r.timeOut).toISOString() : null, hours: round2(r.hoursWorked), late: r.lateMinutes || 0 })),
      { note: exceptions.length === 60 ? 'Showing the latest 60.' : '' }),
  ], { note: 'Counts days that have an attendance record. Rest days and holidays without a record are not counted.' });
}

async function leave(ctx) {
  const { employee, period } = ctx;
  const fromYear = Number(period.from.slice(0, 4));
  const toYear = Number(period.to.slice(0, 4));
  const balanceRows = [];
  for (let year = fromYear; year <= toYear && year - fromYear < 5; year += 1) {
    // eslint-disable-next-line no-await-in-loop
    const balances = await leaveService.balancesFor(employee, year);
    balances.forEach((b) => balanceRows.push({ year, type: b.label, entitled: b.entitlementDays, carried: b.carriedDays, adjusted: b.adjustedDays, taken: b.takenDays, pending: b.pendingDays, balance: b.balanceDays }));
  }
  const requests = await LeaveRequest.find({
    employee: employee._id,
    fromDate: { $lte: new Date(`${period.to}T00:00:00Z`) },
    toDate: { $gte: new Date(`${period.from}T00:00:00Z`) },
  }).sort({ fromDate: -1 }).lean();
  const approved = requests.filter((r) => r.status === 'approved');
  return section('leave', [
    item('Requests in this period', requests.length, 'number'),
    item('Approved days taken', round2(approved.reduce((s, r) => s + (Number(r.days) || 0), 0)), 'number'),
    item('Waiting for a decision', requests.filter((r) => r.status === 'pending').length, 'number'),
    item('Declined', requests.filter((r) => r.status === 'rejected').length, 'number'),
  ], [
    table('Balances by year', [col('year', 'Year'), col('type', 'Leave type'), col('entitled', 'Entitled', 'number'), col('carried', 'Carried over', 'number'), col('adjusted', 'Adjusted', 'number'), col('taken', 'Taken', 'number'), col('pending', 'Pending', 'number'), col('balance', 'Balance', 'number')], balanceRows),
    table('Requests', [col('type', 'Leave type'), col('from', 'From', 'date'), col('to', 'To', 'date'), col('days', 'Days', 'number'), col('status', 'Status'), col('reason', 'Reason')],
      requests.map((r) => ({ type: cap(r.leaveType), from: dayKey(r.fromDate), to: dayKey(r.toDate), days: r.days, status: cap(r.status), reason: r.reason || '' }))),
  ]);
}

async function payroll(ctx) {
  const { employee, period, access } = ctx;
  const filter = { employee: employee._id, month: { $gte: period.fromMonth, $lte: period.toMonth } };
  if (!access.isHr) filter.status = { $in: ['finalised', 'paid'] };
  const slips = await Payslip.find(filter).sort({ month: 1 }).lean();
  const currencies = [...new Set(slips.map((s) => s.currency))];
  const single = currencies.length === 1 ? currencies[0] : null;
  const sum = (fn) => round2(slips.reduce((s, p) => s + (Number(fn(p)) || 0), 0));
  const summary = [item('Payslips in this period', slips.length, 'number')];
  if (single) {
    summary.push(item('Gross paid', sum((p) => p.earnings && p.earnings.gross), 'money', { currency: single }));
    summary.push(item('Total deductions', sum((p) => p.deductions && p.deductions.total), 'money', { currency: single }));
    summary.push(item('Income tax withheld', sum((p) => p.deductions && p.deductions.incomeTax), 'money', { currency: single }));
    summary.push(item('Net pay', sum((p) => p.netPay), 'money', { currency: single, strong: true }));
    summary.push(item('Average net pay', slips.length ? round2(sum((p) => p.netPay) / slips.length) : null, 'money', { currency: single }));
  }
  return section('payroll', summary, [table('Payslips', [col('month', 'Month'), col('currency', 'Currency'), col('gross', 'Gross', 'money'), col('deductions', 'Deductions', 'money'), col('tax', 'Income tax', 'money'), col('net', 'Net pay', 'money'), col('daysPaid', 'Payment days', 'number'), col('overtime', 'Overtime hrs', 'hours'), col('status', 'Status')],
    slips.map((p) => ({ month: p.month, currency: p.currency, gross: p.earnings && p.earnings.gross, deductions: p.deductions && p.deductions.total, tax: p.deductions && p.deductions.incomeTax, net: p.netPay, daysPaid: p.attendance && p.attendance.paymentDays, overtime: p.attendance && p.attendance.overtimeHours, status: cap(p.status) })))],
  { note: !single && slips.length ? 'The payslips are in more than one currency, so totals are not shown.' : '' });
}

async function loans(ctx) {
  const rows = await Loan.find({ employee: ctx.employee._id }).sort({ createdAt: -1 }).lean();
  const approved = rows.filter((l) => l.status === 'approved');
  return section('loans', [
    item('Loans on record', rows.length, 'number'),
    item('Approved', approved.length, 'number'),
    item('Total approved', round2(approved.reduce((s, l) => s + (Number(l.amount) || 0), 0)), 'money', { currency: approved[0] && approved[0].currency }),
  ], [table('Loans', [col('requested', 'Requested', 'date'), col('amount', 'Amount', 'money'), col('currency', 'Currency'), col('months', 'Months', 'number'), col('instalment', 'Monthly instalment', 'money'), col('status', 'Status'), col('reason', 'Reason')],
    rows.map((l) => ({ requested: dayKey(l.createdAt), amount: l.amount, currency: l.currency, months: l.repaymentMonths, instalment: l.monthlyInstalment, status: cap(l.status), reason: l.reason || '' })))]);
}

async function assets(ctx) {
  const rows = await AssetAssignment.find({ employee: ctx.employee._id }).populate('asset', 'code name category serial').sort({ issuedOn: -1 }).lean();
  const holding = rows.filter((r) => !r.returnedOn && ['issued', 'acknowledged', 'recovery'].includes(r.status));
  const overdue = holding.filter((r) => r.dueOn && dayKey(r.dueOn) < today());
  return section('assets', [
    item('Currently holding', holding.length, 'number'),
    item('Overdue for return', overdue.length, 'number', { tone: overdue.length ? 'bad' : undefined }),
    item('Issued in total', rows.length, 'number'),
  ], [table('Assets', [col('code', 'Code'), col('name', 'Asset'), col('category', 'Category'), col('status', 'Status'), col('issuedOn', 'Issued', 'date'), col('dueOn', 'Due back', 'date'), col('returnedOn', 'Returned', 'date'), col('condition', 'Condition out')],
    rows.map((r) => ({ code: r.asset && r.asset.code, name: r.asset && r.asset.name, category: cap(r.asset && r.asset.category), status: cap(r.status), issuedOn: dayKey(r.issuedOn), dueOn: dayKey(r.dueOn), returnedOn: dayKey(r.returnedOn), condition: cap(r.conditionOut) })))]);
}

async function performance(ctx) {
  const [appraisals, objectives] = await Promise.all([
    Appraisal.find({ employee: ctx.employee._id }).sort({ period: -1 }).lean(),
    Objective.find({ employee: ctx.employee._id }).sort({ period: -1, createdAt: 1 }).lean(),
  ]);
  const rated = appraisals.filter((a) => a.finalRating !== undefined && a.finalRating !== null);
  return section('performance', [
    item('Appraisals on record', appraisals.length, 'number'),
    item('Latest final rating', rated.length ? rated[0].finalRating : null, 'number'),
    item('Average final rating', rated.length ? round2(rated.reduce((s, a) => s + a.finalRating, 0) / rated.length) : null, 'number'),
    item('Objectives set', objectives.length, 'number'),
  ], [
    table('Appraisals', [col('period', 'Period'), col('status', 'Status'), col('self', 'Self score', 'number'), col('supervisor', 'Supervisor score', 'number'), col('final', 'Final rating', 'number'), col('reviewedOn', 'Reviewed', 'date')],
      appraisals.map((a) => ({ period: a.period, status: cap(a.status), self: a.selfAssessmentScore, supervisor: a.supervisorScore, final: a.finalRating, reviewedOn: dayKey(a.reviewedAt) }))),
    table('Objectives', [col('period', 'Period'), col('title', 'Objective'), col('weight', 'Weight', 'number')], objectives.map((o) => ({ period: o.period, title: o.title, weight: o.weight }))),
  ]);
}

async function training(ctx) {
  const [enrolments, certificates] = await Promise.all([
    Enrollment.find({ employee: ctx.employee._id }).populate('course', 'code title mandatory durationHours').sort({ createdAt: -1 }).lean(),
    CertificationRecord.find({ employee: ctx.employee._id }).sort({ issuedAt: -1 }).lean(),
  ]);
  const done = enrolments.filter((e) => e.status === 'completed');
  const overdue = enrolments.filter((e) => e.dueDate && !['completed', 'cancelled', 'rejected', 'no_show'].includes(e.status) && dayKey(e.dueDate) < today());
  return section('training', [
    item('Courses completed', done.length, 'number'),
    item('Learning hours completed', round2(done.reduce((s, e) => s + (Number(e.course && e.course.durationHours) || 0), 0)), 'hours'),
    item('Overdue', overdue.length, 'number', { tone: overdue.length ? 'bad' : undefined }),
    item('Certificates held', certificates.length, 'number'),
  ], [
    table('Courses', [col('course', 'Course'), col('mandatory', 'Mandatory', 'bool'), col('status', 'Status'), col('due', 'Due', 'date'), col('completed', 'Completed', 'date'), col('score', 'Feedback', 'number')],
      enrolments.map((e) => ({ course: e.course && e.course.title, mandatory: Boolean(e.course && e.course.mandatory), status: cap(e.status), due: dayKey(e.dueDate), completed: dayKey(e.completedAt), score: e.feedbackScore }))),
    table('Certificates', [col('title', 'Certificate'), col('issued', 'Issued', 'date'), col('expires', 'Expires', 'date'), col('state', 'State')],
      certificates.map((c) => ({ title: c.title, issued: dayKey(c.issuedAt), expires: dayKey(c.expiresAt), state: !c.expiresAt ? 'No expiry' : dayKey(c.expiresAt) < today() ? 'Expired' : 'Valid' }))),
  ]);
}

async function documents(ctx) {
  const { access } = ctx;
  const filter = { employee: ctx.employee._id };
  if (!access.isHr) filter.confidentiality = access.isSelf ? { $in: ['general', 'sensitive'] } : 'general';
  const rows = await EmployeeDocument.find(filter).sort({ type: 1, version: -1 }).lean();
  const expired = rows.filter((d) => d.expiresOn && dayKey(d.expiresOn) < today());
  const soon = rows.filter((d) => d.expiresOn && dayKey(d.expiresOn) >= today() && daysBetween(today(), dayKey(d.expiresOn)) <= 90);
  return section('documents', [
    item('Documents on file', rows.length, 'number'),
    item('Expired', expired.length, 'number', { tone: expired.length ? 'bad' : undefined }),
    item('Expiring within 90 days', soon.length, 'number', { tone: soon.length ? 'warn' : undefined }),
    item('Without a file attached', rows.filter((d) => !(d.file && d.file.id)).length, 'number'),
  ], [table('Documents', [col('type', 'Type'), col('title', 'Title'), col('reference', 'Reference'), col('issued', 'Issued', 'date'), col('expires', 'Expires', 'date'), col('verification', 'Verification'), col('file', 'File attached', 'bool')],
    rows.map((d) => ({ type: label(DOCUMENT_TYPE_LABELS, d.type), title: d.title, reference: d.reference, issued: dayKey(d.issuedOn), expires: dayKey(d.expiresOn), verification: cap(d.verificationStatus), file: Boolean(d.file && d.file.id) })))],
  { note: access.isHr ? '' : 'Restricted documents are not shown.' });
}

async function rewards(ctx) {
  const rows = await EmployeeReward.find({ employee: ctx.employee._id }).sort({ awardedOn: -1 }).lean();
  return section('rewards', [item('Recognitions', rows.length, 'number')], [table('Rewards', [col('awardedOn', 'Date', 'date'), col('reward', 'Reward'), col('authority', 'Awarded by'), col('description', 'Notes')],
    rows.map((r) => ({ awardedOn: dayKey(r.awardedOn), reward: r.reward, authority: r.authority, description: r.description || '' })))]);
}

async function background(ctx) {
  const { employee, person, access } = ctx;
  const personId = employee.person;
  const [quals, experience, family, addresses, banks, statutory] = await Promise.all([
    Qualification.find({ person: personId }).sort({ issuedOn: -1 }).lean(),
    WorkExperience.find({ person: personId }).sort({ toYear: -1, fromYear: -1 }).lean(),
    FamilyMember.find({ person: personId, status: { $ne: 'ended' } }).sort({ isEmergency: -1, name: 1 }).lean(),
    Address.find({ person: personId, status: 'active' }).sort({ type: 1 }).lean(),
    BankAccount.find({ employee: employee._id, status: 'active' }).lean(),
    StatutoryEnrollment.find({ employee: employee._id, status: 'active' }).lean(),
  ]);
  const reveal = access.isHr;
  const ids = ((person && person.nationalIds) || []).map((n) => ({ type: cap(n.type), number: reveal ? n.number : maskNationalId(n.number) }));
  return section('background', [
    item('Qualifications', quals.length, 'number'),
    item('Previous employers', experience.length, 'number'),
    item('Emergency contacts', family.filter((f) => f.isEmergency).length, 'number'),
  ], [
    table('Identity numbers', [col('type', 'Type'), col('number', 'Number')], ids),
    table('Addresses', [col('type', 'Type'), col('address', 'Address')], addresses.map((a) => ({ type: cap(a.type), address: [a.line1, a.line2, a.city, a.postalCode, a.country].filter(Boolean).join(', ') }))),
    table('Qualifications', [col('title', 'Qualification'), col('level', 'Level'), col('institution', 'Institution'), col('result', 'Result'), col('issued', 'Awarded', 'date')], quals.map((q) => ({ title: q.title, level: q.level, institution: q.institution, result: q.result, issued: dayKey(q.issuedOn) }))),
    table('Previous experience', [col('organization', 'Organisation'), col('designation', 'Designation'), col('from', 'From'), col('to', 'To')], experience.map((x) => ({ organization: x.organization, designation: x.designation, from: x.fromYear, to: x.toYear }))),
    table('Family and emergency contacts', [col('name', 'Name'), col('relationship', 'Relationship'), col('phone', 'Phone'), col('emergency', 'Emergency', 'bool'), col('dependent', 'Dependent', 'bool'), col('nominee', 'Nominee', 'bool')],
      family.map((f) => ({ name: f.name, relationship: cap(f.relationship), phone: f.phone, emergency: f.isEmergency, dependent: f.isDependent, nominee: f.isNominee }))),
    table('Pay account', [col('method', 'Method'), col('bank', 'Bank'), col('account', 'Account'), col('iban', 'IBAN')],
      banks.map((b) => ({ method: cap(b.method), bank: b.bankName, account: reveal ? b.accountNumber : maskAccount(b.accountNumber), iban: reveal ? b.iban : maskAccount(b.iban) }))),
    table('Statutory enrolments', [col('scheme', 'Scheme'), col('number', 'Membership number'), col('from', 'From', 'date')],
      statutory.map((s) => ({ scheme: label(STATUTORY_SCHEME_LABELS, s.scheme), number: reveal ? s.membershipNumber : maskNationalId(s.membershipNumber), from: dayKey(s.effectiveFrom) }))),
  ], { note: reveal ? '' : 'Account and identity numbers are partly hidden.' });
}

async function onboarding(ctx) {
  const [hire, exit] = await Promise.all([
    HireTask.find({ employee: ctx.employee._id }).sort({ dueOn: 1 }).lean(),
    ExitTask.find({ employee: ctx.employee._id }).sort({ dueOn: 1 }).lean(),
  ]);
  const toRow = (t) => ({ title: t.title, owner: cap(t.owner), status: cap(t.status), due: dayKey(t.dueOn), done: dayKey(t.doneAt) });
  const columns = [col('title', 'Task'), col('owner', 'Owner'), col('status', 'Status'), col('due', 'Due', 'date'), col('done', 'Done', 'date')];
  const open = (list) => list.filter((t) => t.status !== 'done').length;
  return section('onboarding', [
    item('Onboarding tasks open', hire.length ? open(hire) : null, 'number'),
    item('Offboarding tasks open', exit.length ? open(exit) : null, 'number'),
  ].filter((r) => r.value !== null), [
    table('Onboarding', columns, hire.map(toRow)),
    table('Offboarding', columns, exit.map(toRow)),
  ]);
}

async function cases(ctx) {
  const rows = await ErCase.find({ $or: [{ subject: ctx.employee._id }, { complainant: ctx.employee._id }] }).sort({ createdAt: -1 }).lean();
  return section('cases', [item('Cases', rows.length, 'number'), item('Open', rows.filter((c) => !['closed', 'rejected'].includes(c.status)).length, 'number')], [
    table('Cases', [col('code', 'Case'), col('type', 'Type'), col('role', 'Their part'), col('status', 'Status'), col('outcome', 'Outcome'), col('action', 'Action'), col('opened', 'Opened', 'date')],
      rows.map((c) => ({ code: c.code, type: cap(c.type), role: String(c.subject) === String(ctx.employee._id) ? 'Subject' : 'Complainant', status: cap(c.status), outcome: cap(c.decision && c.decision.outcome), action: cap(c.decision && c.decision.actionType), opened: dayKey(c.createdAt) }))),
  ], { note: 'Visible to HR only.' });
}

async function audit(ctx) {
  const rows = await AuditLog.find({ employee: ctx.employee._id }).sort({ createdAt: -1 }).limit(60).lean();
  return section('audit', [item('Recent changes shown', rows.length, 'number')], [table('Change log', [col('when', 'When', 'datetime'), col('who', 'Done by'), col('action', 'Action'), col('summary', 'Summary')],
    rows.map((a) => ({ when: new Date(a.createdAt).toISOString(), who: a.actorName, action: a.action, summary: a.summary })))], { note: 'Visible to HR only. Latest 60 entries.' });
}

const BUILDERS = { profile, compensation, history, attendance, leave, payroll, loans, assets, performance, training, documents, rewards, background, onboarding, cases, audit };

/**
 * Builds the report. `managerOfEmployee` says whether the caller is in the
 * employee's reporting line (the controller works that out from the same
 * scope every other module uses).
 */
async function build(employeeId, query, user, viewerEmployee, managerOfEmployee) {
  const employee = await Employee.findById(employeeId);
  if (!employee) throw ApiError.notFound('Employee not found');
  const access = accessFor(user, viewerEmployee, employee, managerOfEmployee);
  if (!access.isHr && !access.isSelf && !access.isManager) throw ApiError.forbidden('You cannot view a report for this employee');

  const period = periodFrom(query || {}, employee);
  const allowed = availableSections(access);
  const wanted = String((query && query.sections) || '').split(',').map((s) => s.trim()).filter(Boolean);
  const chosen = wanted.length ? allowed.filter((s) => wanted.includes(s.key)) : allowed;
  if (!chosen.length) throw ApiError.badRequest('Choose at least one section');

  const person = employee.person ? await Person.findById(employee.person) : null;
  const ctx = { employee, person, period, access, user };
  const built = await Promise.all(chosen.map((s) => BUILDERS[s.key](ctx)));

  return {
    generatedAt: new Date().toISOString(),
    timezone: env.timezone,
    period,
    employee: {
      id: String(employee._id),
      code: employee.employeeCode,
      name: nameOf(employee),
      designation: employee.designation,
      department: employee.department,
      status: label(EMPLOYMENT_STATUS_LABELS, employee.employmentStatus),
    },
    viewer: { role: user.role, scope: access.isHr ? 'HR' : access.isSelf ? 'Own record' : 'Direct report' },
    available: allowed.map((s) => ({ key: s.key, title: s.title })),
    sections: built,
  };
}

module.exports = { SECTIONS, build, availableSections, accessFor, periodFrom };
