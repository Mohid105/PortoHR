'use strict';

/**
 * Every dataset a report can be built from. A dataset is a whitelist: the
 * columns listed here are the only things the engine will read, and `scope`
 * decides which rows a caller may see — the same people they can already see
 * in the module the data came from (HR: everyone, managers: their team and
 * themselves, employees: themselves). Columns marked `hr` are for HR only.
 */

const zoned = require('../../utils/zoned');
const env = require('../../config/env');
const { ROLES } = require('../../config/roles');
const hr = require('../../config/hr');
const orgConfig = require('../../config/org');
const leaveConfig = require('../../config/leave');
const { getPath } = require('./engine');

const lazy = (name) => () => require(`../../models/${name}`);
// Populate looks models up by name, so make sure every one a dataset refers to is registered.
['Employee', 'Person', 'Attendance', 'LeaveRequest', 'Payslip', 'Loan', 'Asset', 'AssetAssignment', 'EmployeeDocument', 'Appraisal', 'Objective',
  'Enrollment', 'Course', 'CertificationRecord', 'BenefitEnrollment', 'BenefitPlan', 'HireTask', 'ExitTask', 'EmployeeReward', 'Requisition',
  'Application', 'Candidate', 'ErCase', 'FinalSettlement', 'AuditLog'].forEach((name) => lazy(name)());
const cap = (text) => { const s = String(text).replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); };
const opts = (values, labels) => values.map((value) => ({ value, label: (labels && labels[value]) || cap(value) }));
const isHrUser = (user) => Boolean(user && user.role === ROLES.HR_ADMIN);
const nameOf = (e) => (e ? [e.firstName, e.lastName].filter(Boolean).join(' ') : '');
const YEAR = 365.25 * 86400000;
const today = () => zoned.dateKey(new Date(), env.timezone);
const dayKey = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);
const daysBetween = (fromKey, toKey) => Math.round((new Date(`${toKey}T00:00:00Z`) - new Date(`${fromKey}T00:00:00Z`)) / 86400000);

/* ------------------------------------------------------------- column builders */

const C = (key, label, type, o) => Object.assign({ key, label, type, filterable: true }, o);
const T = (key, label, path, o) => C(key, label, 'text', Object.assign({ path, groupable: true }, o));
const E = (key, label, path, options, o) => C(key, label, 'enum', Object.assign({ path, options, groupable: true }, o));
const N = (key, label, path, o) => C(key, label, 'number', Object.assign({ path, summable: true }, o));
const M = (key, label, path, o) => C(key, label, 'money', Object.assign({ path, summable: true }, o));
const H = (key, label, path, o) => C(key, label, 'hours', Object.assign({ path, summable: true }, o));
const D = (key, label, path, o) => C(key, label, 'date', Object.assign({ path, groupable: true }, o));
const DT = (key, label, path, o) => C(key, label, 'datetime', Object.assign({ path, groupable: true }, o));
const B = (key, label, get, o) => C(key, label, 'bool', Object.assign({ get, computed: true, groupable: true }, o));
const X = (key, label, type, get, o) => C(key, label, type, Object.assign({ get, computed: true }, o));

const STATUS_OPTIONS = opts(['probation', 'confirmed', 'notice_period', 'resigned', 'terminated'], hr.EMPLOYMENT_STATUS_LABELS);
const TYPE_OPTIONS = opts(hr.EMPLOYMENT_TYPES, hr.EMPLOYMENT_TYPE_LABELS);
const CATEGORY_OPTIONS = opts(orgConfig.EMPLOYEE_CATEGORIES, orgConfig.EMPLOYEE_CATEGORY_LABELS);
const GENDER_OPTIONS = opts(hr.GENDERS);
const CURRENCY_OPTIONS = opts(hr.CURRENCIES);
const LEAVE_OPTIONS = (leaveConfig.LEAVE_TYPES || []).map((t) => ({ value: t.code, label: t.label }));

const EMP_SELECT = 'employeeCode firstName lastName department team designation grade location employmentStatus reportsTo';
const EMP_POPULATE = { path: 'employee', select: EMP_SELECT, populate: { path: 'reportsTo', select: 'firstName lastName employeeCode' } };

/** Who the row belongs to, read from the live employee record. */
function employeeColumns() {
  const g = (path) => (doc) => getPath(doc.employee, path);
  return [
    T('employeeCode', 'Employee code', 'employeeCode', { via: 'employee', get: g('employeeCode') }),
    T('employee', 'Employee', null, { via: 'employee', computed: true, get: (doc) => nameOf(doc.employee), path: undefined }),
    T('department', 'Department', 'department', { via: 'employee', get: g('department'), suggest: true }),
    T('team', 'Team', 'team', { via: 'employee', get: g('team'), suggest: true }),
    T('designation', 'Designation', 'designation', { via: 'employee', get: g('designation'), suggest: true }),
    T('grade', 'Grade', 'grade', { via: 'employee', get: g('grade'), suggest: true }),
    T('location', 'Location', 'location', { via: 'employee', get: g('location'), suggest: true }),
    E('employmentStatus', 'Employment status', 'employmentStatus', STATUS_OPTIONS, { via: 'employee', get: g('employmentStatus') }),
    T('manager', 'Manager', null, { via: 'employee', computed: true, get: (doc) => nameOf(doc.employee && doc.employee.reportsTo) }),
  ];
}
const EMPLOYEE_DEFAULTS = ['employeeCode', 'employee', 'department'];

/** Who the row belongs to, as frozen on the record when it was made. */
function snapshotColumns() {
  return [
    T('employeeCode', 'Employee code', 'snapshot.employeeCode'),
    T('employee', 'Employee', 'snapshot.fullName'),
    T('department', 'Department', 'snapshot.department', { suggest: true }),
    T('designation', 'Designation', 'snapshot.designation', { suggest: true }),
  ];
}

const forEmployees = (field = 'employee') => (ids) => (ids === null ? {} : { [field]: { $in: ids } });

/* ------------------------------------------------------------------- datasets */

const employees = {
  key: 'employees',
  label: 'Employees',
  group: 'People',
  description: 'Everyone on the books: job, pay, tenure, manager, dates. The base for headcount, joiners, leavers and workforce mix.',
  access: 'all',
  model: lazy('Employee'),
  scope: (ids) => (ids === null ? {} : { _id: { $in: ids } }),
  populate: [{ path: 'reportsTo', select: 'firstName lastName employeeCode' }, { path: 'person', select: 'maritalStatus nationality bloodGroup' }],
  employeeField: '_id',
  columns: [
    T('employeeCode', 'Employee code', 'employeeCode'),
    X('fullName', 'Name', 'text', (e) => nameOf(e), { groupable: true }),
    T('email', 'Work email', 'email', { groupable: false }),
    T('phone', 'Phone', 'phone', { groupable: false }),
    T('department', 'Department', 'department', { suggest: true }),
    T('team', 'Team', 'team', { suggest: true }),
    T('designation', 'Designation', 'designation', { suggest: true }),
    T('grade', 'Grade', 'grade', { suggest: true }),
    T('location', 'Location', 'location', { suggest: true }),
    T('costCenter', 'Cost centre', 'costCenter', { suggest: true }),
    T('legalEntity', 'Legal entity', 'legalEntity', { suggest: true }),
    E('employmentStatus', 'Employment status', 'employmentStatus', STATUS_OPTIONS),
    E('employmentType', 'Employment type', 'employmentType', TYPE_OPTIONS),
    E('employeeCategory', 'Category', 'employeeCategory', CATEGORY_OPTIONS),
    T('payGroup', 'Pay group', 'payGroup'),
    T('shiftType', 'Shift', 'shiftType'),
    E('attendanceMode', 'Attendance mode', 'attendanceMode', opts(['punch', 'exempt'])),
    E('gender', 'Gender', 'gender', GENDER_OPTIONS),
    X('maritalStatus', 'Marital status', 'enum', (e) => getPath(e, 'person.maritalStatus') || null, { groupable: true, options: opts(orgConfig.MARITAL_STATUSES) }),
    X('nationality', 'Nationality', 'text', (e) => getPath(e, 'person.nationality') || null, { groupable: true }),
    X('bloodGroup', 'Blood group', 'text', (e) => getPath(e, 'person.bloodGroup') || null, { groupable: true, hr: true }),
    D('dateOfBirth', 'Date of birth', 'dateOfBirth', { hr: true, groupable: false }),
    X('age', 'Age', 'number', (e) => (e.dateOfBirth ? Math.floor((Date.now() - new Date(e.dateOfBirth).getTime()) / YEAR) : null)),
    X('ageBand', 'Age band', 'text', (e) => {
      if (!e.dateOfBirth) return null;
      const age = Math.floor((Date.now() - new Date(e.dateOfBirth).getTime()) / YEAR);
      return age < 25 ? '18-24' : age < 35 ? '25-34' : age < 45 ? '35-44' : age < 55 ? '45-54' : '55+';
    }, { groupable: true }),
    D('dateOfJoining', 'Date of joining', 'dateOfJoining'),
    X('joiningMonth', 'Joining month', 'text', (e) => (e.dateOfJoining ? dayKey(e.dateOfJoining).slice(0, 7) : null), { groupable: true }),
    X('joiningYear', 'Joining year', 'text', (e) => (e.dateOfJoining ? dayKey(e.dateOfJoining).slice(0, 4) : null), { groupable: true }),
    D('probationEndDate', 'Probation ends', 'probationEndDate', { groupable: false }),
    D('confirmationDate', 'Confirmed on', 'confirmationDate', { groupable: false }),
    D('lastWorkingDay', 'Last working day', 'lastWorkingDay', { groupable: false }),
    X('tenureYears', 'Tenure (years)', 'number', (e) => {
      if (!e.dateOfJoining) return null;
      const end = e.lastWorkingDay ? new Date(e.lastWorkingDay).getTime() : Date.now();
      return Math.max(0, Math.round(((end - new Date(e.dateOfJoining).getTime()) / YEAR) * 10) / 10);
    }),
    X('tenureBand', 'Tenure band', 'text', (e) => {
      if (!e.dateOfJoining) return null;
      const end = e.lastWorkingDay ? new Date(e.lastWorkingDay).getTime() : Date.now();
      const years = (end - new Date(e.dateOfJoining).getTime()) / YEAR;
      return years < 1 ? '0-1 yr' : years < 3 ? '1-3 yrs' : years < 5 ? '3-5 yrs' : years < 10 ? '5-10 yrs' : '10+ yrs';
    }, { groupable: true }),
    X('manager', 'Manager', 'text', (e) => nameOf(e.reportsTo), { groupable: true }),
    N('annualLeaveDays', 'Annual leave days', 'annualLeaveDays', { groupable: false }),
    E('currency', 'Salary currency', 'compensation.currency', CURRENCY_OPTIONS),
    M('baseSalary', 'Basic salary', 'compensation.baseSalary'),
    X('allowances', 'Fixed allowances', 'money', (e) => ((e.compensation && e.compensation.fixedAllowances) || []).reduce((s, a) => s + (Number(a.amount) || 0), 0), { summable: true }),
    X('grossSalary', 'Gross salary', 'money', (e) => (Number(getPath(e, 'compensation.baseSalary')) || 0) + ((e.compensation && e.compensation.fixedAllowances) || []).reduce((s, a) => s + (Number(a.amount) || 0), 0), { summable: true }),
    B('hasLogin', 'Has a login', (e) => Boolean(e.userAccount)),
  ],
  defaultColumns: ['employeeCode', 'fullName', 'department', 'designation', 'employmentStatus', 'dateOfJoining'],
  defaultSort: { key: 'employeeCode', dir: 'asc' },
  currencyOf: (e) => getPath(e, 'compensation.currency'),
  note: 'Salary columns show only for people you may already see pay for.',
};

const attendance = {
  key: 'attendance',
  label: 'Attendance',
  group: 'Time',
  description: 'One row per employee per day: status, clock times, hours, lateness and overtime.',
  access: 'all',
  model: lazy('Attendance'),
  scope: forEmployees(),
  populate: [EMP_POPULATE],
  columns: [
    D('date', 'Date', 'date'),
    X('month', 'Month', 'text', (d) => dayKey(d.date).slice(0, 7), { groupable: true }),
    X('weekday', 'Weekday', 'text', (d) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][zoned.weekdayOf(dayKey(d.date))], { groupable: true }),
    ...employeeColumns(),
    E('shiftStatus', 'Status', 'shiftStatus', opts(['present', 'short_day', 'absent', 'on_leave'])),
    T('shiftType', 'Shift', 'shiftType'),
    DT('timeIn', 'Clock in', 'timeIn', { groupable: false }),
    DT('timeOut', 'Clock out', 'timeOut', { groupable: false }),
    H('expectedHours', 'Expected hours', 'expectedHours'),
    H('hoursWorked', 'Hours worked', 'hoursWorked'),
    H('overtimeHours', 'Overtime hours', 'overtimeHours'),
    H('shortfallHours', 'Shortfall hours', 'shortfallHours'),
    N('lateMinutes', 'Late (minutes)', 'lateMinutes'),
    N('earlyExitMinutes', 'Left early (minutes)', 'earlyExitMinutes'),
    N('punchCount', 'Punches', 'punchCount'),
    B('isLate', 'Late', (d) => (Number(d.lateMinutes) || 0) > 0),
    E('source', 'Recorded by', 'source', opts(['legacy', 'punch', 'manual', 'leave'])),
    C('locked', 'Month locked', 'bool', { path: 'locked', groupable: true }),
    T('notes', 'Notes', 'notes', { groupable: false }),
  ],
  defaultColumns: ['date', 'employeeCode', 'employee', 'shiftStatus', 'timeIn', 'timeOut', 'hoursWorked', 'lateMinutes'],
  defaultSort: { key: 'date', dir: 'desc' },
  note: 'Dates are company-local days.',
};

const leave = {
  key: 'leave',
  label: 'Leave requests',
  group: 'Time',
  description: 'Every leave request with its type, dates, days and decision.',
  access: 'all',
  model: lazy('LeaveRequest'),
  scope: forEmployees(),
  populate: [],
  columns: [
    ...snapshotColumns(),
    T('team', 'Team', 'snapshot.team', { suggest: true }),
    E('leaveType', 'Leave type', 'leaveType', LEAVE_OPTIONS),
    D('fromDate', 'From', 'fromDate'),
    D('toDate', 'To', 'toDate', { groupable: false }),
    X('year', 'Year', 'text', (r) => dayKey(r.fromDate).slice(0, 4), { groupable: true }),
    E('halfDay', 'Half day', 'halfDay', opts(['morning', 'afternoon'])),
    N('days', 'Days', 'days'),
    H('hours', 'Hours', 'hours'),
    E('status', 'Status', 'status', opts(['pending', 'approved', 'rejected', 'cancelled'])),
    T('reason', 'Reason', 'reason', { groupable: false }),
    DT('submittedAt', 'Requested on', 'createdAt', { groupable: false }),
    DT('decidedAt', 'Decided on', 'decidedAt', { groupable: false }),
    T('decisionNote', 'Decision note', 'decisionNote', { groupable: false }),
  ],
  defaultColumns: ['employeeCode', 'employee', 'leaveType', 'fromDate', 'toDate', 'days', 'status'],
  defaultSort: { key: 'fromDate', dir: 'desc' },
};

const payslips = {
  key: 'payslips',
  label: 'Payslips',
  group: 'Money',
  description: 'Monthly payslips: earnings, deductions, tax and net pay. Drafts are visible to HR only.',
  access: 'all',
  model: lazy('Payslip'),
  scope: (ids, user) => Object.assign(forEmployees()(ids), isHrUser(user) ? {} : { status: { $in: ['finalised', 'paid'] } }),
  populate: [],
  columns: [
    T('month', 'Month', 'month'),
    ...snapshotColumns(),
    T('team', 'Team', 'snapshot.team', { suggest: true }),
    E('status', 'Status', 'status', opts(['draft', 'finalised', 'paid'])),
    E('currency', 'Currency', 'currency', CURRENCY_OPTIONS),
    M('basic', 'Basic', 'earnings.basic'),
    M('allowances', 'Allowances', 'earnings.totalAllowances'),
    M('overtimePay', 'Overtime pay', 'earnings.overtimePay'),
    M('holidayPay', 'Gazetted holiday pay', 'earnings.gazettedHolidayPay'),
    M('incentive', 'Incentive', 'earnings.incentive'),
    M('otherEarnings', 'Other earnings', 'earnings.otherEarnings'),
    M('gross', 'Gross pay', 'earnings.gross'),
    M('attendanceDeductions', 'Attendance deductions', 'deductions.attendanceTotal'),
    M('eobi', 'EOBI / social security', 'deductions.socialSecurity'),
    M('providentFund', 'Provident fund', 'deductions.providentFund'),
    M('incomeTax', 'Income tax', 'deductions.incomeTax'),
    M('loanRecovery', 'Loan recovery', 'deductions.loanRecovery'),
    M('otherDeductions', 'Other deductions', 'deductions.otherDeductions'),
    M('totalDeductions', 'Total deductions', 'deductions.total'),
    M('taxableGross', 'Taxable gross', 'taxableGross'),
    M('netPay', 'Net pay', 'netPay'),
    N('presentDays', 'Days present', 'attendance.presentDays'),
    N('absentDays', 'Days absent', 'attendance.absentDays'),
    N('leaveDays', 'Leave days', 'attendance.leaveDays'),
    N('lwpDays', 'Unpaid leave days', 'attendance.lwpDays'),
    N('paymentDays', 'Payment days', 'attendance.paymentDays'),
    N('lateCount', 'Late arrivals', 'attendance.lateCount'),
    H('overtimeHours', 'Overtime hours', 'attendance.overtimeHours'),
    H('hoursWorked', 'Hours worked', 'attendance.hoursWorked'),
    DT('paidAt', 'Paid on', 'paidAt', { groupable: false }),
  ],
  defaultColumns: ['month', 'employeeCode', 'employee', 'department', 'gross', 'totalDeductions', 'netPay', 'status'],
  defaultSort: { key: 'month', dir: 'desc' },
  currencyOf: (p) => p.currency,
  note: 'Amounts are in each payslip’s own currency. Totals across mixed currencies are not meaningful.',
};

const loans = {
  key: 'loans',
  label: 'Loans',
  group: 'Money',
  description: 'Loan and advance requests, amounts and repayment terms.',
  access: 'all',
  model: lazy('Loan'),
  scope: forEmployees(),
  populate: [],
  columns: [
    ...snapshotColumns(),
    E('status', 'Status', 'status', opts(['pending', 'approved', 'rejected'])),
    E('currency', 'Currency', 'currency', CURRENCY_OPTIONS),
    M('amount', 'Amount', 'amount'),
    N('repaymentMonths', 'Months to repay', 'repaymentMonths', { summable: false }),
    M('monthlyInstalment', 'Monthly instalment', 'monthlyInstalment'),
    T('reason', 'Reason', 'reason', { groupable: false }),
    DT('submittedAt', 'Requested on', 'createdAt'),
    DT('decidedAt', 'Decided on', 'decidedAt', { groupable: false }),
  ],
  defaultColumns: ['employeeCode', 'employee', 'amount', 'currency', 'repaymentMonths', 'monthlyInstalment', 'status', 'submittedAt'],
  defaultSort: { key: 'submittedAt', dir: 'desc' },
  currencyOf: (l) => l.currency,
};

const ASSET_CATEGORIES = opts(['it', 'id_card', 'access_card', 'uniform', 'ppe', 'vehicle', 'furniture', 'other']);

const assets = {
  key: 'assets',
  label: 'Assets issued',
  group: 'Assets',
  description: 'Who holds which company asset, since when, in what condition, and what is overdue for return.',
  access: 'all',
  model: lazy('AssetAssignment'),
  scope: forEmployees(),
  populate: [{ path: 'asset', select: 'code name category serial purchaseValue currency' }],
  columns: [
    ...snapshotColumns(),
    X('assetCode', 'Asset code', 'text', (a) => getPath(a, 'asset.code'), { groupable: true }),
    X('assetName', 'Asset', 'text', (a) => getPath(a, 'asset.name'), { groupable: true }),
    X('category', 'Category', 'enum', (a) => getPath(a, 'asset.category'), { groupable: true, options: ASSET_CATEGORIES }),
    X('serial', 'Serial number', 'text', (a) => getPath(a, 'asset.serial')),
    X('value', 'Purchase value', 'money', (a) => getPath(a, 'asset.purchaseValue'), { summable: true }),
    E('status', 'Status', 'status', opts(['requested', 'issued', 'acknowledged', 'recovery', 'returned', 'lost'])),
    E('conditionOut', 'Condition when issued', 'conditionOut', opts(['new', 'good', 'fair', 'poor'])),
    E('conditionIn', 'Condition when returned', 'conditionIn', opts(['new', 'good', 'fair', 'poor'])),
    D('issuedOn', 'Issued on', 'issuedOn'),
    D('dueOn', 'Due back', 'dueOn', { groupable: false }),
    D('returnedOn', 'Returned on', 'returnedOn', { groupable: false }),
    X('daysHeld', 'Days held', 'number', (a) => (a.issuedOn ? daysBetween(dayKey(a.issuedOn), a.returnedOn ? dayKey(a.returnedOn) : today()) : null)),
    B('overdue', 'Overdue for return', (a) => !a.returnedOn && ['issued', 'acknowledged', 'recovery'].includes(a.status) && Boolean(a.dueOn) && dayKey(a.dueOn) < today()),
  ],
  defaultColumns: ['employeeCode', 'employee', 'assetName', 'category', 'status', 'issuedOn', 'returnedOn'],
  defaultSort: { key: 'issuedOn', dir: 'desc' },
};

const assetRegister = {
  key: 'asset_register',
  label: 'Asset register',
  group: 'Assets',
  description: 'The company asset inventory: what exists, where, what it cost and whether it is in use.',
  access: 'hr',
  model: lazy('Asset'),
  scope: () => ({}),
  populate: [],
  employeeField: '_id',
  columns: [
    T('code', 'Asset code', 'code'),
    T('name', 'Name', 'name'),
    E('category', 'Category', 'category', ASSET_CATEGORIES),
    E('status', 'Status', 'status', opts(['available', 'issued', 'maintenance', 'retired'])),
    T('serial', 'Serial number', 'serial', { groupable: false }),
    T('location', 'Location', 'location', { suggest: true }),
    D('purchaseDate', 'Purchased on', 'purchaseDate'),
    M('purchaseValue', 'Purchase value', 'purchaseValue'),
    M('residualValue', 'Residual value', 'residualValue'),
    N('usefulLifeMonths', 'Useful life (months)', 'usefulLifeMonths', { summable: false }),
    E('currency', 'Currency', 'currency', CURRENCY_OPTIONS),
  ],
  defaultColumns: ['code', 'name', 'category', 'status', 'location', 'purchaseValue'],
  defaultSort: { key: 'code', dir: 'asc' },
  currencyOf: (a) => a.currency,
};

const DOC_TYPES = opts(orgConfig.DOCUMENT_TYPES, orgConfig.DOCUMENT_TYPE_LABELS);

const documents = {
  key: 'documents',
  label: 'Employee documents',
  group: 'Compliance',
  description: 'Personnel-file documents, who has what, and what is expiring or unverified.',
  access: 'all',
  model: lazy('EmployeeDocument'),
  scope: (ids, user) => Object.assign(forEmployees()(ids), isHrUser(user) ? {} : { confidentiality: 'general' }),
  populate: [EMP_POPULATE],
  columns: [
    ...employeeColumns(),
    E('type', 'Type', 'type', DOC_TYPES),
    T('title', 'Title', 'title', { groupable: false }),
    T('reference', 'Reference', 'reference', { groupable: false }),
    D('issuedOn', 'Issued on', 'issuedOn'),
    D('expiresOn', 'Expires on', 'expiresOn'),
    X('daysToExpiry', 'Days to expiry', 'number', (d) => (d.expiresOn ? daysBetween(today(), dayKey(d.expiresOn)) : null)),
    X('expiryState', 'Expiry state', 'text', (d) => {
      if (!d.expiresOn) return 'No expiry';
      const left = daysBetween(today(), dayKey(d.expiresOn));
      return left < 0 ? 'Expired' : left <= 30 ? 'Expires within 30 days' : left <= 90 ? 'Expires within 90 days' : 'Valid';
    }, { groupable: true }),
    E('verificationStatus', 'Verification', 'verificationStatus', opts(['unverified', 'verified', 'rejected', 'expired'])),
    E('confidentiality', 'Visibility', 'confidentiality', opts(['general', 'sensitive', 'restricted'])),
    N('version', 'Version', 'version', { summable: false }),
    B('hasFile', 'File attached', (d) => Boolean(getPath(d, 'file.id'))),
    DT('uploadedAt', 'Added on', 'createdAt', { groupable: false }),
  ],
  defaultColumns: ['employeeCode', 'employee', 'type', 'title', 'expiresOn', 'verificationStatus', 'hasFile'],
  defaultSort: { key: 'expiresOn', dir: 'asc' },
  note: 'Only general-visibility documents are listed unless you are HR.',
};

const appraisals = {
  key: 'appraisals',
  label: 'Appraisals',
  group: 'Talent',
  description: 'Performance appraisals: self and supervisor scores, final rating and review status.',
  access: 'all',
  model: lazy('Appraisal'),
  scope: forEmployees(),
  populate: [EMP_POPULATE],
  columns: [
    ...employeeColumns(),
    T('period', 'Period', 'period'),
    E('status', 'Status', 'status', opts(['assigned', 'self_submitted', 'reviewed'])),
    N('selfScore', 'Self score', 'selfAssessmentScore', { summable: false }),
    N('supervisorScore', 'Supervisor score', 'supervisorScore', { summable: false }),
    N('finalRating', 'Final rating', 'finalRating', { summable: false }),
    DT('selfSubmittedAt', 'Self-assessed on', 'selfSubmittedAt', { groupable: false }),
    DT('reviewedAt', 'Reviewed on', 'reviewedAt', { groupable: false }),
  ],
  defaultColumns: ['employeeCode', 'employee', 'department', 'period', 'status', 'selfScore', 'supervisorScore', 'finalRating'],
  defaultSort: { key: 'period', dir: 'desc' },
};

const objectives = {
  key: 'objectives',
  label: 'Objectives',
  group: 'Talent',
  description: 'Goals set for employees each period, with their weighting.',
  access: 'all',
  model: lazy('Objective'),
  scope: forEmployees(),
  populate: [EMP_POPULATE],
  columns: [
    ...employeeColumns(),
    T('period', 'Period', 'period'),
    T('title', 'Objective', 'title', { groupable: false }),
    T('description', 'Description', 'description', { groupable: false }),
    N('weight', 'Weight', 'weight'),
  ],
  defaultColumns: ['employeeCode', 'employee', 'period', 'title', 'weight'],
  defaultSort: { key: 'period', dir: 'desc' },
};

const training = {
  key: 'training',
  label: 'Training enrolments',
  group: 'Talent',
  description: 'Course enrolments, completion and overdue mandatory training.',
  access: 'all',
  model: lazy('Enrollment'),
  scope: forEmployees(),
  populate: [{ path: 'course', select: 'code title delivery mandatory durationHours provider' }],
  columns: [
    ...snapshotColumns(),
    X('courseCode', 'Course code', 'text', (e) => getPath(e, 'course.code'), { groupable: true }),
    X('course', 'Course', 'text', (e) => getPath(e, 'course.title'), { groupable: true }),
    X('delivery', 'Delivery', 'text', (e) => getPath(e, 'course.delivery'), { groupable: true }),
    X('provider', 'Provider', 'text', (e) => getPath(e, 'course.provider'), { groupable: true }),
    B('mandatory', 'Mandatory', (e) => Boolean(getPath(e, 'course.mandatory'))),
    X('courseHours', 'Course hours', 'hours', (e) => getPath(e, 'course.durationHours'), { summable: true }),
    E('status', 'Status', 'status', opts(['pending', 'enrolled', 'completed', 'rejected', 'cancelled', 'no_show'])),
    E('source', 'Enrolled by', 'source', opts(['self', 'manager', 'hr', 'mandatory'])),
    D('dueDate', 'Due date', 'dueDate'),
    DT('completedAt', 'Completed on', 'completedAt'),
    C('attended', 'Attended', 'bool', { path: 'attended', groupable: true }),
    N('feedbackScore', 'Feedback score', 'feedbackScore', { summable: false }),
    B('overdue', 'Overdue', (e) => Boolean(e.dueDate) && !['completed', 'cancelled', 'rejected', 'no_show'].includes(e.status) && dayKey(e.dueDate) < today()),
  ],
  defaultColumns: ['employeeCode', 'employee', 'course', 'status', 'dueDate', 'completedAt'],
  defaultSort: { key: 'dueDate', dir: 'asc' },
};

const certifications = {
  key: 'certifications',
  label: 'Certifications',
  group: 'Compliance',
  description: 'Certificates held by employees and when they expire.',
  access: 'all',
  model: lazy('CertificationRecord'),
  scope: forEmployees(),
  populate: [EMP_POPULATE, { path: 'course', select: 'code title' }],
  columns: [
    ...employeeColumns(),
    T('title', 'Certificate', 'title'),
    X('course', 'Course', 'text', (c) => getPath(c, 'course.title'), { groupable: true }),
    D('issuedAt', 'Issued on', 'issuedAt', { groupable: true }),
    D('expiresAt', 'Expires on', 'expiresAt'),
    X('daysToExpiry', 'Days to expiry', 'number', (c) => (c.expiresAt ? daysBetween(today(), dayKey(c.expiresAt)) : null)),
  ],
  defaultColumns: ['employeeCode', 'employee', 'title', 'issuedAt', 'expiresAt', 'daysToExpiry'],
  defaultSort: { key: 'expiresAt', dir: 'asc' },
};

const benefits = {
  key: 'benefits',
  label: 'Benefit enrolments',
  group: 'Money',
  description: 'Benefit plans employees are enrolled in, with employer and employee cost.',
  access: 'all',
  model: lazy('BenefitEnrollment'),
  scope: forEmployees(),
  populate: [{ path: 'plan', select: 'name category provider' }],
  columns: [
    ...snapshotColumns(),
    T('grade', 'Grade', 'snapshot.grade', { suggest: true }),
    X('plan', 'Plan', 'text', (b) => getPath(b, 'plan.name'), { groupable: true }),
    X('category', 'Plan category', 'text', (b) => getPath(b, 'plan.category'), { groupable: true }),
    X('provider', 'Provider', 'text', (b) => getPath(b, 'plan.provider'), { groupable: true }),
    E('status', 'Status', 'status', opts(['pending', 'active', 'ended', 'rejected'])),
    E('source', 'Enrolled through', 'source', opts(['auto', 'open_enrollment', 'life_event', 'hr'])),
    E('currency', 'Currency', 'currency', CURRENCY_OPTIONS),
    M('employerAmount', 'Employer cost', 'employerAmount'),
    M('employeeAmount', 'Employee cost', 'employeeAmount'),
    X('dependents', 'Dependants covered', 'number', (b) => (b.dependents || []).length, { summable: true }),
    D('effectiveFrom', 'Effective from', 'effectiveFrom'),
    D('effectiveTo', 'Effective to', 'effectiveTo', { groupable: false }),
  ],
  defaultColumns: ['employeeCode', 'employee', 'plan', 'status', 'employerAmount', 'employeeAmount', 'effectiveFrom'],
  defaultSort: { key: 'effectiveFrom', dir: 'desc' },
  currencyOf: (b) => b.currency,
};

const taskDataset = (key, label, modelName, description) => ({
  key,
  label,
  group: 'People',
  description,
  access: 'all',
  model: lazy(modelName),
  scope: forEmployees(),
  populate: [EMP_POPULATE],
  columns: [
    ...employeeColumns(),
    T('title', 'Task', 'title', { groupable: false }),
    E('owner', 'Owner', 'owner', opts(['hr', 'manager', 'it', 'finance', 'employee'])),
    E('status', 'Status', 'status', opts(['pending', 'done'])),
    D('dueOn', 'Due on', 'dueOn'),
    DT('doneAt', 'Done on', 'doneAt', { groupable: false }),
    B('overdue', 'Overdue', (t) => t.status !== 'done' && Boolean(t.dueOn) && dayKey(t.dueOn) < today()),
    T('note', 'Note', 'note', { groupable: false }),
  ],
  defaultColumns: ['employeeCode', 'employee', 'title', 'owner', 'status', 'dueOn'],
  defaultSort: { key: 'dueOn', dir: 'asc' },
});

const rewards = {
  key: 'rewards',
  label: 'Rewards & recognition',
  group: 'Talent',
  description: 'Awards and recognitions recorded on personnel files.',
  access: 'all',
  model: lazy('EmployeeReward'),
  scope: forEmployees(),
  populate: [EMP_POPULATE],
  columns: [
    ...employeeColumns(),
    T('reward', 'Reward', 'reward'),
    T('authority', 'Awarded by', 'authority'),
    T('description', 'Description', 'description', { groupable: false }),
    D('awardedOn', 'Awarded on', 'awardedOn'),
  ],
  defaultColumns: ['employeeCode', 'employee', 'reward', 'authority', 'awardedOn'],
  defaultSort: { key: 'awardedOn', dir: 'desc' },
};

const requisitions = {
  key: 'requisitions',
  label: 'Requisitions',
  group: 'Hiring',
  description: 'Open and closed hiring requests, with openings filled and how long they have been open.',
  access: 'all',
  model: lazy('Requisition'),
  scope: (ids) => (ids === null ? {} : { $or: [{ employee: { $in: ids } }, { hiringManager: { $in: ids } }] }),
  populate: [{ path: 'hiringManager', select: 'firstName lastName' }],
  columns: [
    T('code', 'Code', 'code'),
    T('title', 'Role', 'title'),
    T('department', 'Department', 'department', { suggest: true }),
    T('location', 'Location', 'location', { suggest: true }),
    E('status', 'Status', 'status', opts(['pending', 'open', 'on_hold', 'filled', 'rejected', 'cancelled'])),
    N('openings', 'Openings', 'openings'),
    N('filled', 'Filled', 'filledCount'),
    X('stillOpen', 'Still to fill', 'number', (r) => Math.max(0, (Number(r.openings) || 0) - (Number(r.filledCount) || 0)), { summable: true }),
    X('hiringManager', 'Hiring manager', 'text', (r) => nameOf(r.hiringManager), { groupable: true }),
    T('reason', 'Reason', 'reason', { groupable: false }),
    DT('requestedOn', 'Requested on', 'createdAt'),
    DT('decidedAt', 'Decided on', 'decidedAt', { groupable: false }),
    X('daysOpen', 'Days since requested', 'number', (r) => (r.createdAt ? daysBetween(dayKey(r.createdAt), today()) : null)),
  ],
  defaultColumns: ['code', 'title', 'department', 'status', 'openings', 'filled', 'requestedOn'],
  defaultSort: { key: 'requestedOn', dir: 'desc' },
};

const applications = {
  key: 'applications',
  label: 'Applications',
  group: 'Hiring',
  description: 'Candidates in the pipeline: stage, source, score and the role they applied for.',
  access: 'hr',
  model: lazy('Application'),
  scope: () => ({}),
  populate: [{ path: 'candidate', select: 'firstName lastName email phone source' }, { path: 'requisition', select: 'code title department' }],
  employeeField: '_id',
  columns: [
    X('candidate', 'Candidate', 'text', (a) => nameOf(a.candidate), { groupable: true }),
    X('email', 'Email', 'text', (a) => getPath(a, 'candidate.email')),
    X('requisition', 'Requisition', 'text', (a) => getPath(a, 'requisition.code'), { groupable: true }),
    X('role', 'Role', 'text', (a) => getPath(a, 'requisition.title'), { groupable: true }),
    X('department', 'Department', 'text', (a) => getPath(a, 'requisition.department'), { groupable: true }),
    E('stage', 'Stage', 'stage', opts(['applied', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn'])),
    E('source', 'Source', 'source', opts(['internal', 'referral', 'agency', 'career_site', 'other'])),
    N('score', 'Score', 'score', { summable: false }),
    X('interviews', 'Interviews held', 'number', (a) => (a.interviews || []).length, { summable: true }),
    DT('appliedOn', 'Applied on', 'createdAt'),
  ],
  defaultColumns: ['candidate', 'role', 'stage', 'source', 'score', 'appliedOn'],
  defaultSort: { key: 'appliedOn', dir: 'desc' },
};

const cases = {
  key: 'cases',
  label: 'Employee-relations cases',
  group: 'Compliance',
  description: 'Grievances, complaints, investigations and disciplinary cases, with outcomes and age.',
  access: 'hr',
  model: lazy('ErCase'),
  scope: () => ({}),
  populate: [],
  employeeField: 'subject',
  columns: [
    T('code', 'Case', 'code'),
    E('type', 'Type', 'type', opts(['grievance', 'complaint', 'investigation', 'disciplinary'])),
    E('status', 'Status', 'status', opts(['intake', 'investigation', 'hearing', 'decision', 'appeal', 'closed', 'rejected'])),
    T('department', 'Department', 'department', { suggest: true }),
    T('employee', 'About', 'snapshot.fullName'),
    T('summary', 'Summary', 'summary', { groupable: false }),
    E('outcome', 'Outcome', 'decision.outcome', opts(['upheld', 'not_upheld', 'informal_resolution', 'action'])),
    E('action', 'Action taken', 'decision.actionType', opts(['none', 'verbal_warning', 'written_warning', 'suspension', 'termination'])),
    DT('openedOn', 'Opened on', 'createdAt'),
    DT('closedAt', 'Closed on', 'closedAt', { groupable: false }),
    X('daysOpen', 'Days open', 'number', (c) => (c.createdAt ? daysBetween(dayKey(c.createdAt), c.closedAt ? dayKey(c.closedAt) : today()) : null)),
  ],
  defaultColumns: ['code', 'type', 'status', 'department', 'outcome', 'openedOn', 'daysOpen'],
  defaultSort: { key: 'openedOn', dir: 'desc' },
};

const settlements = {
  key: 'settlements',
  label: 'Final settlements',
  group: 'Money',
  description: 'Exit settlements: service length, amounts payable and recoveries.',
  access: 'hr',
  model: lazy('FinalSettlement'),
  scope: () => ({}),
  populate: [],
  columns: [
    T('requestNo', 'Request no.', 'requestNo'),
    T('employeeCode', 'Employee code', 'snapshot.employeeCode'),
    T('employee', 'Employee', 'snapshot.fullName'),
    T('department', 'Department', 'snapshot.department', { suggest: true }),
    T('designation', 'Designation', 'snapshot.designation', { suggest: true }),
    D('dateOfJoining', 'Joined', 'snapshot.dateOfJoining', { groupable: false }),
    D('dateOfRelieving', 'Relieved', 'snapshot.dateOfRelieving'),
    T('quitReason', 'Reason for leaving', 'snapshot.quitReason'),
    N('serviceYears', 'Service (years)', 'snapshot.serviceYears', { summable: false }),
    E('status', 'Status', 'status', opts(['draft', 'approved', 'paid'])),
    E('currency', 'Currency', 'currency', CURRENCY_OPTIONS),
    M('netSalaryPayable', 'Net salary payable', 'netSalaryPayable'),
    M('leaveEncashment', 'Leave encashment', 'leaveEncashment'),
    M('finalSettlement', 'Final settlement', 'finalSettlement'),
    M('deductions', 'Deductions', 'deductions.total'),
    M('netPayable', 'Net payable', 'netPayable'),
    DT('paidAt', 'Paid on', 'paidAt', { groupable: false }),
  ],
  defaultColumns: ['requestNo', 'employee', 'department', 'dateOfRelieving', 'quitReason', 'netPayable', 'status'],
  defaultSort: { key: 'dateOfRelieving', dir: 'desc' },
  currencyOf: (s) => s.currency,
};

const audit = {
  key: 'audit',
  label: 'Audit log',
  group: 'Compliance',
  description: 'Who changed what and when: hires, approvals, edits and exports.',
  access: 'hr',
  model: lazy('AuditLog'),
  scope: () => ({}),
  populate: [{ path: 'employee', select: 'employeeCode firstName lastName department' }],
  employeeField: 'employee',
  columns: [
    DT('when', 'When', 'createdAt'),
    T('actor', 'Done by', 'actorName'),
    T('role', 'Role', 'role'),
    T('action', 'Action', 'action'),
    T('objectType', 'Record type', 'objectType'),
    X('about', 'About employee', 'text', (a) => nameOf(a.employee), { groupable: true }),
    X('aboutCode', 'Employee code', 'text', (a) => getPath(a, 'employee.employeeCode'), { groupable: true }),
    T('summary', 'Summary', 'summary', { groupable: false }),
    T('ip', 'IP address', 'ip'),
  ],
  defaultColumns: ['when', 'actor', 'action', 'objectType', 'about', 'summary'],
  defaultSort: { key: 'when', dir: 'desc' },
};

const ALL = [
  employees, attendance, leave, payslips, loans, benefits, assets, assetRegister, documents, certifications,
  appraisals, objectives, training, rewards,
  taskDataset('onboarding', 'Onboarding tasks', 'HireTask', 'The new-starter checklist: what is done, what is overdue, and who owns it.'),
  taskDataset('offboarding', 'Offboarding tasks', 'ExitTask', 'Clearance checklists for leavers.'),
  requisitions, applications, cases, settlements, audit,
];

const BY_KEY = new Map(ALL.map((def) => [def.key, def]));

function get(key) {
  return BY_KEY.get(key) || null;
}

/** Datasets the caller may use, grouped for the picker. */
function listFor(user) {
  return ALL.filter((def) => def.access !== 'hr' || isHrUser(user));
}

module.exports = { all: ALL, get, listFor };
