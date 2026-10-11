'use strict';

/**
 * Bulk employee import. A spreadsheet is validated row by row first (the
 * "preview"), and only rows that pass are created. Every row is checked the
 * way a single hire would be, plus the things only a batch can get wrong:
 * duplicates inside the file, and a manager who is hired in the same file.
 */

const Employee = require('../models/Employee');
const OrgUnit = require('../models/OrgUnit');
const ApiError = require('../utils/ApiError');
const org = require('./org.service');
const workforce = require('./workforce.service');
const { EMPLOYMENT_TYPES, GENDERS, CURRENCIES } = require('../config/hr');
const shiftRegistry = require('../config/shiftRegistry');
const { EMPLOYEE_CATEGORIES, PAY_GROUPS, MARITAL_STATUSES } = require('../config/org');

const MAX_ROWS = 500;

/** Header spellings people actually use, mapped to our field names. */
const ALIASES = {
  employeecode: 'employeeCode', code: 'employeeCode', empcode: 'employeeCode', employeeno: 'employeeCode', employeeid: 'employeeCode', empno: 'employeeCode', emp: 'employeeCode',
  firstname: 'firstName', first: 'firstName', lastname: 'lastName', last: 'lastName', surname: 'lastName',
  email: 'email', workemail: 'email', officialemail: 'email',
  phone: 'phone', mobile: 'mobile', personalemail: 'personalEmail',
  designation: 'designation', position: 'designation', jobtitle: 'designation', title: 'designation',
  department: 'department', dept: 'department', team: 'team', grade: 'grade', location: 'location', plant: 'location',
  dateofjoining: 'dateOfJoining', doj: 'dateOfJoining', joiningdate: 'dateOfJoining', joindate: 'dateOfJoining',
  dateofbirth: 'dateOfBirth', dob: 'dateOfBirth', birthdate: 'dateOfBirth',
  gender: 'gender', sex: 'gender', fathername: 'fatherName', husbandname: 'fatherName', fatherhusbandname: 'fatherName',
  cnic: 'cnic', nationalid: 'cnic', address: 'address',
  employmenttype: 'employmentType', type: 'employmentType', employmentstatus: 'employmentStatus', status: 'employmentStatus',
  employeecategory: 'employeeCategory', category: 'employeeCategory', shift: 'shiftType', shifttype: 'shiftType',
  annualleavedays: 'annualLeaveDays', leavedays: 'annualLeaveDays',
  basesalary: 'baseSalary', salary: 'baseSalary', grosssalary: 'baseSalary', monthlysalary: 'baseSalary', currency: 'currency',
  reportsto: 'reportsToCode', reportstocode: 'reportsToCode', manager: 'reportsToCode', managercode: 'reportsToCode', supervisorcode: 'reportsToCode',
  paygroup: 'payGroup', probationenddate: 'probationEndDate', confirmationdate: 'confirmationDate',
  maritalstatus: 'maritalStatus', nationality: 'nationality',
};

const REQUIRED = ['employeeCode', 'firstName', 'lastName', 'email', 'designation', 'department', 'dateOfJoining', 'baseSalary'];

function normaliseHeader(key) {
  return ALIASES[String(key || '').toLowerCase().replace(/[^a-z]/g, '')] || null;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

/** Accepts 2019-01-31, 31/01/2019, 31-01-2019 and 31-JAN-2019. Returns YYYY-MM-DD or null. */
function parseDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  let year;
  let month;
  let day;
  let match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(text);
  if (match) {
    year = +match[1]; month = +match[2]; day = +match[3];
  } else if ((match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text))) {
    day = +match[1]; month = +match[2]; year = +match[3];
  } else if ((match = /^(\d{1,2})[-\s]([A-Za-z]{3,4})[-\s](\d{2,4})$/.exec(text))) {
    day = +match[1]; month = MONTHS[match[2].toLowerCase()]; year = +match[3];
    if (year < 100) year += year > 50 ? 1900 : 2000;
  } else {
    return null;
  }
  if (!month || month > 12 || day < 1 || day > 31) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseNumber(value) {
  const text = String(value === undefined || value === null ? '' : value).replace(/[,\s]/g, '');
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : NaN;
}

function parseCnic(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length !== 13) return null;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

function pickOption(value, options, synonyms) {
  const key = String(value || '').toLowerCase().replace(/[\s-]+/g, '_').trim();
  if (!key) return '';
  if (options.includes(key)) return key;
  if (synonyms && synonyms[key]) return synonyms[key];
  return null;
}

const TYPE_SYNONYMS = { permanent: 'full_time', fulltime: 'full_time', full: 'full_time', parttime: 'part_time', part: 'part_time', trainee: 'intern', internship: 'intern', contractual: 'contract' };
const CATEGORY_SYNONYMS = { nonexecutive: 'non_executive', 'non-executive': 'non_executive', staff: 'non_executive', executives: 'executive', managers: 'management', workers: 'worker', labour: 'worker', labor: 'worker' };
const GENDER_SYNONYMS = { m: 'male', f: 'female', man: 'male', woman: 'female' };

/**
 * Turns one raw spreadsheet row into a hire payload plus the problems found.
 * Pure: no database. Cross-row and database checks happen in `validateBatch`.
 */
function normaliseRow(raw) {
  const errors = [];
  const warnings = [];
  const row = {};
  Object.keys(raw || {}).forEach((key) => {
    const field = normaliseHeader(key);
    if (field && String(raw[key] === undefined || raw[key] === null ? '' : raw[key]).trim() !== '') row[field] = String(raw[key]).trim();
  });

  REQUIRED.forEach((field) => {
    if (!row[field]) errors.push(`${field} is required`);
  });

  const payload = {};
  ['firstName', 'lastName', 'email', 'phone', 'mobile', 'personalEmail', 'designation', 'department', 'team', 'grade', 'location', 'address', 'fatherName', 'nationality', 'reportsToCode'].forEach((f) => {
    if (row[f]) payload[f] = row[f];
  });
  if (row.employeeCode) payload.employeeCode = row.employeeCode.toUpperCase();
  if (payload.email) {
    payload.email = payload.email.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) errors.push('email is not a valid address');
  }
  if (payload.employeeCode && !/^[A-Z0-9-]{3,20}$/.test(payload.employeeCode)) {
    errors.push('employeeCode may only contain letters, numbers and hyphens (3–20 characters)');
  }

  ['dateOfJoining', 'dateOfBirth', 'probationEndDate', 'confirmationDate'].forEach((f) => {
    if (!row[f]) return;
    const date = parseDate(row[f]);
    if (date === null) errors.push(`${f} "${row[f]}" is not a date (use 31/01/2024 or 2024-01-31)`);
    else payload[f] = date;
  });
  if (payload.dateOfBirth) {
    const age = (Date.now() - new Date(payload.dateOfBirth).getTime()) / (365.25 * 86400000);
    if (age < 14 || age > 90) warnings.push(`date of birth gives an age of ${Math.floor(age)}`);
  }
  if (payload.dateOfJoining && new Date(payload.dateOfJoining) > new Date(Date.now() + 366 * 86400000)) {
    errors.push('dateOfJoining is more than a year in the future');
  }

  const salary = parseNumber(row.baseSalary);
  if (row.baseSalary && (Number.isNaN(salary) || salary < 0)) errors.push('baseSalary must be a number');
  const currency = (row.currency || '').toUpperCase();
  if (currency && !CURRENCIES.includes(currency)) errors.push(`currency must be one of ${CURRENCIES.join(', ')}`);
  if (salary !== null && !Number.isNaN(salary)) payload.compensation = { baseSalary: salary, currency: currency || 'PKR' };

  const pick = (field, options, synonyms) => {
    if (!row[field]) return;
    const value = pickOption(row[field], options, synonyms);
    if (value === null) errors.push(`${field} "${row[field]}" is not recognised. Use: ${options.join(', ')}`);
    else if (value) payload[field] = value;
  };
  pick('employmentType', EMPLOYMENT_TYPES, TYPE_SYNONYMS);
  pick('shiftType', shiftRegistry.codes(), {});
  pick('gender', GENDERS, GENDER_SYNONYMS);
  pick('employeeCategory', EMPLOYEE_CATEGORIES, CATEGORY_SYNONYMS);
  pick('maritalStatus', MARITAL_STATUSES, {});
  pick('payGroup', PAY_GROUPS, {});
  if (!payload.payGroup && payload.compensation && payload.compensation.currency === 'PKR') payload.payGroup = 'monthly_pk';
  if (row.employmentStatus) {
    const status = pickOption(row.employmentStatus, ['probation', 'confirmed', 'notice_period'], { permanent: 'confirmed', regular: 'confirmed', active: 'confirmed' });
    if (status === null) errors.push('employmentStatus must be probation, confirmed or notice_period (leavers are not imported)');
    else if (status) payload.employmentStatus = status;
  }

  if (row.annualLeaveDays) {
    const days = parseNumber(row.annualLeaveDays);
    if (Number.isNaN(days) || days < 0 || days > 365) errors.push('annualLeaveDays must be between 0 and 365');
    else payload.annualLeaveDays = days;
  }

  if (row.cnic) {
    const cnic = parseCnic(row.cnic);
    if (cnic === null) errors.push('cnic must have 13 digits');
    else payload.nationalIds = [{ type: 'cnic', number: cnic }];
  }

  return { payload, errors, warnings };
}

/**
 * Validates a whole batch: each row on its own, then duplicates inside the
 * file and against the database, departments, and reporting lines.
 */
async function validateBatch(rawRows, options) {
  if (!Array.isArray(rawRows) || !rawRows.length) throw ApiError.badRequest('There are no rows to import');
  if (rawRows.length > MAX_ROWS) throw ApiError.badRequest(`Import at most ${MAX_ROWS} employees at a time`);
  const createDepartments = Boolean(options && options.createMissingDepartments);

  const rows = rawRows.map((raw, index) => ({ line: index + 2, ...normaliseRow(raw) }));

  const codes = rows.map((r) => r.payload.employeeCode).filter(Boolean);
  const emails = rows.map((r) => r.payload.email).filter(Boolean);
  const [existingEmployees, departments] = await Promise.all([
    Employee.find({ $or: [{ employeeCode: { $in: codes } }, { email: { $in: emails } }] }).select('employeeCode email'),
    org.departmentNames(),
  ]);
  const takenCodes = new Set(existingEmployees.map((e) => e.employeeCode));
  const takenEmails = new Set(existingEmployees.map((e) => e.email));
  const canonical = new Map(departments.map((d) => [d.toLowerCase(), d]));
  const knownDepartments = new Set(canonical.keys());

  const seenCodes = new Map();
  const seenEmails = new Map();
  const missingDepartments = new Set();

  rows.forEach((row) => {
    const p = row.payload;
    if (p.employeeCode) {
      if (takenCodes.has(p.employeeCode)) row.errors.push(`employee code ${p.employeeCode} already exists`);
      if (seenCodes.has(p.employeeCode)) row.errors.push(`employee code ${p.employeeCode} is repeated (also on line ${seenCodes.get(p.employeeCode)})`);
      else seenCodes.set(p.employeeCode, row.line);
    }
    if (p.email) {
      if (takenEmails.has(p.email)) row.errors.push(`email ${p.email} is already used by another employee`);
      if (seenEmails.has(p.email)) row.errors.push(`email ${p.email} is repeated (also on line ${seenEmails.get(p.email)})`);
      else seenEmails.set(p.email, row.line);
    }
    if (p.department && knownDepartments.has(p.department.toLowerCase())) p.department = canonical.get(p.department.toLowerCase());
    if (p.department && !knownDepartments.has(p.department.toLowerCase())) {
      if (createDepartments) {
        missingDepartments.add(p.department);
        row.warnings.push(`department "${p.department}" will be created`);
      } else {
        row.errors.push(`department "${p.department}" does not exist (add it in Admin → Departments, or tick "create missing departments")`);
      }
    }
  });

  // Reporting lines: a manager must already exist, or be hired in this file.
  const existingManagers = await Employee.find({
    employeeCode: { $in: rows.map((r) => (r.payload.reportsToCode || '').toUpperCase()).filter(Boolean) },
  }).select('employeeCode');
  const managerIds = new Map(existingManagers.map((e) => [e.employeeCode, String(e._id)]));
  rows.forEach((row) => {
    const code = (row.payload.reportsToCode || '').toUpperCase();
    if (!code) return;
    row.payload.reportsToCode = code;
    if (code === row.payload.employeeCode) row.errors.push('an employee cannot report to themselves');
    else if (!managerIds.has(code) && !seenCodes.has(code)) row.errors.push(`manager ${code} was not found in the system or in this file`);
  });

  return { rows, missingDepartments: Array.from(missingDepartments), managerIds };
}

/** Rows with their managers first, so a reporting line can be set at creation. */
function creationOrder(rows) {
  const byCode = new Map(rows.map((r) => [r.payload.employeeCode, r]));
  const ordered = [];
  const state = new Map();
  const visit = (row) => {
    const code = row.payload.employeeCode;
    if (state.get(code) === 2) return true;
    if (state.get(code) === 1) return false; // a reporting loop inside the file
    state.set(code, 1);
    const manager = byCode.get(row.payload.reportsToCode);
    let ok = true;
    if (manager && manager !== row) ok = visit(manager);
    state.set(code, 2);
    if (ok) ordered.push(row);
    else row.errors.push('reporting lines in the file form a loop');
    return ok;
  };
  rows.forEach(visit);
  return ordered;
}

async function cleanupOrphan(code) {
  try {
    const employee = await Employee.findOne({ employeeCode: code });
    if (employee && !employee.employment) await Employee.deleteOne({ _id: employee._id });
  } catch (err) {
    /* best effort */
  }
}

async function run(rawRows, options, user) {
  const { rows, missingDepartments, managerIds } = await validateBatch(rawRows, options);
  const summary = (list) => list.map((r) => ({ line: r.line, employeeCode: r.payload.employeeCode || '', name: `${r.payload.firstName || ''} ${r.payload.lastName || ''}`.trim(), errors: r.errors, warnings: r.warnings, ok: !r.errors.length }));

  if (!options || !options.commit) {
    return { committed: false, total: rows.length, valid: rows.filter((r) => !r.errors.length).length, missingDepartments, rows: summary(rows) };
  }

  const good = rows.filter((r) => !r.errors.length);
  const ordered = creationOrder(good);
  const created = new Map();

  for (const name of missingDepartments) {
    await org.createDepartment({ name });
  }

  for (const row of ordered) {
    const p = { ...row.payload };
    const managerCode = p.reportsToCode;
    delete p.reportsToCode;
    if (managerCode) p.reportsTo = created.get(managerCode) || managerIds.get(managerCode) || null;
    try {
      const employee = await workforce.createHire(p, user._id);
      created.set(p.employeeCode, String(employee._id));
      row.created = true;
    } catch (err) {
      row.errors.push(err.message || 'could not be created');
      await cleanupOrphan(p.employeeCode);
    }
  }

  const failed = rows.filter((r) => r.errors.length);
  return {
    committed: true,
    total: rows.length,
    created: created.size,
    failed: failed.length,
    rows: summary(rows).map((r, i) => ({ ...r, created: Boolean(rows[i].created) })),
  };
}

module.exports = { MAX_ROWS, normaliseRow, parseDate, parseCnic, creationOrder, validateBatch, cleanupOrphan, run };
