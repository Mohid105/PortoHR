'use strict';

/**
 * Hiring someone in one go. The form on the screen carries everything HR
 * knows on day one: who they are, where they sit, what they are paid, how they
 * are paid, their statutory numbers, family, education, past jobs, documents
 * and whether they get a login. Everything is checked first and reported
 * field by field; only then are the records created.
 */

const Employee = require('../models/Employee');
const Person = require('../models/Person');
const Employment = require('../models/Employment');
const Grade = require('../models/Grade');
const User = require('../models/User');
const Address = require('../models/Address');
const FamilyMember = require('../models/FamilyMember');
const Qualification = require('../models/Qualification');
const WorkExperience = require('../models/WorkExperience');
const BankAccount = require('../models/BankAccount');
const StatutoryEnrollment = require('../models/StatutoryEnrollment');
const EmployeeDocument = require('../models/EmployeeDocument');
const HireTask = require('../models/HireTask');
const Payslip = require('../models/Payslip');
const Attendance = require('../models/Attendance');
const LeaveRequest = require('../models/LeaveRequest');
const Loan = require('../models/Loan');
const FinalSettlement = require('../models/FinalSettlement');
const AssetAssignment = require('../models/AssetAssignment');
const Position = require('../models/Position');
const mongoose = require('mongoose');
const files = require('./files.service');
const ApiError = require('../utils/ApiError');
const org = require('./org.service');
const workforce = require('./workforce.service');
const access = require('./access.service');
const registry = require('../config/shiftRegistry');
const importer = require('./import.service');
const { EMPLOYMENT_TYPES, GENDERS, CURRENCIES, WEEKDAYS } = require('../config/hr');
const { EMPLOYEE_CATEGORIES, PAY_GROUPS, MARITAL_STATUSES, NATIONALITIES, RELATIONSHIPS, PAYMENT_METHODS, DOCUMENT_TYPES, CONFIDENTIALITY } = require('../config/org');
const { ROLE_VALUES } = require('../config/roles');

const BLOOD = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const str = (v) => String(v === undefined || v === null ? '' : v).trim();
const list = (v) => (Array.isArray(v) ? v : []);
const bool = (v) => v === true || v === 'true' || v === 'on' || v === 1;

/** The first thing a new starter's manager and HR have to do. Days are counted from the joining date. */
const HIRE_CHECKLIST = [
  { key: 'contract_signed', title: 'Signed appointment letter and contract on file', owner: 'hr', day: 0 },
  { key: 'documents_collected', title: 'ID, education and experience documents collected and verified', owner: 'hr', day: 3 },
  { key: 'bank_verified', title: 'Bank account verified for salary', owner: 'finance', day: 5 },
  { key: 'it_access', title: 'Email, system access and workstation ready', owner: 'it', day: -1 },
  { key: 'assets_issued', title: 'ID card, laptop and other assets issued', owner: 'it', day: 1 },
  { key: 'induction', title: 'Orientation and company induction completed', owner: 'hr', day: 3 },
  { key: 'team_intro', title: 'Introduced to the team, buddy assigned', owner: 'manager', day: 1 },
  { key: 'goals_set', title: '30-60-90 day goals agreed', owner: 'manager', day: 14 },
  { key: 'policies_signed', title: 'Code of conduct and policies acknowledged', owner: 'employee', day: 7 },
  { key: 'probation_review', title: 'Probation review scheduled', owner: 'manager', day: 30 },
];

function nextCode(codes) {
  // Follows the pattern already in use: PH-1007 -> PH-1008, EMP-0099 -> EMP-0100.
  let best = null;
  codes.forEach((code) => {
    const m = /^([A-Z]*-?)(\d+)$/.exec(code || '');
    if (!m) return;
    const n = Number(m[2]);
    if (!best || n > best.n) best = { prefix: m[1], n, width: m[2].length };
  });
  if (!best) return 'EMP-0001';
  return `${best.prefix}${String(best.n + 1).padStart(best.width, '0')}`;
}

async function suggestCode() {
  const rows = await Employee.find({}).select('employeeCode').lean();
  return nextCode(rows.map((r) => r.employeeCode));
}

function dateOrNull(value, label, errors, field, { required = false, min, max } = {}) {
  const text = str(value);
  if (!text) {
    if (required) errors.push({ field, message: `${label} is required` });
    return null;
  }
  const iso = importer.parseDate(text);
  if (iso === null || iso === '') {
    errors.push({ field, message: `${label} is not a valid date` });
    return null;
  }
  if (min && iso < min) errors.push({ field, message: `${label} cannot be before ${min}` });
  if (max && iso > max) errors.push({ field, message: `${label} cannot be after ${max}` });
  return iso;
}

function oneOf(value, options, label, errors, field, fallback) {
  const text = str(value);
  if (!text) return fallback;
  if (!options.includes(text)) {
    errors.push({ field, message: `${label} must be one of: ${options.filter(Boolean).join(', ')}` });
    return fallback;
  }
  return text;
}

const PHONE = /^[0-9+()\-\s]{7,20}$/;

/**
 * Turns the form into a hire payload plus the child records, collecting every
 * problem. Pure apart from the lookups passed in, so it can be tested.
 */
function build(body, lookups) {
  const errors = [];
  const warnings = [];
  const p = body.personal || {};
  const c = body.contact || {};
  const e = body.employment || {};
  const o = body.organization || {};
  const pay = body.pay || {};
  const st = body.statutory || {};
  const today = new Date().toISOString().slice(0, 10);
  const required = (value, label, field) => {
    if (!str(value)) errors.push({ field, message: `${label} is required` });
    return str(value);
  };

  // ---- personal
  const firstName = required(p.firstName, 'First name', 'personal.firstName');
  const lastName = required(p.lastName, 'Last name', 'personal.lastName');
  const dateOfBirth = dateOrNull(p.dateOfBirth, 'Date of birth', errors, 'personal.dateOfBirth', { max: today });
  if (dateOfBirth && dateOfBirth <= today) {
    const age = (Date.now() - new Date(dateOfBirth).getTime()) / (365.25 * 86400000);
    if (age < 14) errors.push({ field: 'personal.dateOfBirth', message: 'The employee would be under 14' });
    else if (age > 90) errors.push({ field: 'personal.dateOfBirth', message: 'Check the date of birth: that is over 90 years' });
  }
  const gender = oneOf(p.gender, GENDERS, 'Gender', errors, 'personal.gender', '');
  const maritalStatus = oneOf(p.maritalStatus, MARITAL_STATUSES, 'Marital status', errors, 'personal.maritalStatus', '');
  const nationality = oneOf(p.nationality, NATIONALITIES, 'Nationality', errors, 'personal.nationality', '');
  const bloodGroup = oneOf(p.bloodGroup, BLOOD, 'Blood group', errors, 'personal.bloodGroup', '');
  const nationalIds = [];
  if (str(p.cnic)) {
    const cnic = importer.parseCnic(p.cnic);
    if (cnic === null) errors.push({ field: 'personal.cnic', message: 'CNIC must have 13 digits' });
    else nationalIds.push({ type: 'cnic', number: cnic });
  } else if ((nationality || 'PK') === 'PK') {
    warnings.push('No CNIC entered. Pakistani employees need one for payroll tax and EOBI.');
  }
  if (str(p.passportNumber)) nationalIds.push({ type: 'passport', number: str(p.passportNumber).toUpperCase() });
  const personalEmail = str(p.personalEmail).toLowerCase();
  if (personalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalEmail)) errors.push({ field: 'personal.personalEmail', message: 'Personal email is not valid' });
  const mobile = str(p.mobile);
  if (mobile && !PHONE.test(mobile)) errors.push({ field: 'personal.mobile', message: 'Mobile number is not valid' });

  // ---- contact
  const email = required(c.email, 'Work email', 'contact.email').toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push({ field: 'contact.email', message: 'Work email is not valid' });
  const phone = str(c.phone);
  if (phone && !PHONE.test(phone)) errors.push({ field: 'contact.phone', message: 'Phone number is not valid' });
  const addresses = list(c.addresses)
    .map((a, i) => ({ type: ['permanent', 'current'].includes(a.type) ? a.type : 'current', line1: str(a.line1), line2: str(a.line2), city: str(a.city), postalCode: str(a.postalCode), country: str(a.country) || 'PK', _i: i }))
    .filter((a) => a.line1 || a.city);
  const currentAddress = addresses.find((a) => a.type === 'current') || addresses[0];

  // ---- employment
  const employeeCode = required(e.employeeCode, 'Employee code', 'employment.employeeCode').toUpperCase();
  if (employeeCode && !/^[A-Z0-9-]{3,20}$/.test(employeeCode)) errors.push({ field: 'employment.employeeCode', message: 'Use 3–20 letters, numbers or hyphens' });
  const dateOfJoining = dateOrNull(e.dateOfJoining, 'Date of joining', errors, 'employment.dateOfJoining', { required: true, max: new Date(Date.now() + 366 * 86400000).toISOString().slice(0, 10) });
  const employmentType = oneOf(e.employmentType, EMPLOYMENT_TYPES, 'Employment type', errors, 'employment.employmentType', 'full_time');
  const employeeCategory = oneOf(e.employeeCategory, EMPLOYEE_CATEGORIES, 'Employee category', errors, 'employment.employeeCategory', 'non_executive');
  const employmentStatus = oneOf(e.employmentStatus, ['probation', 'confirmed'], 'Status', errors, 'employment.employmentStatus', 'probation');
  const probationEndDate = dateOrNull(e.probationEndDate, 'Probation end', errors, 'employment.probationEndDate', { min: dateOfJoining || undefined });
  const confirmationDate = dateOrNull(e.confirmationDate, 'Confirmation date', errors, 'employment.confirmationDate', { min: dateOfJoining || undefined });
  const payGroup = oneOf(e.payGroup, PAY_GROUPS, 'Pay group', errors, 'employment.payGroup', '');
  let annualLeaveDays;
  if (str(e.annualLeaveDays)) {
    annualLeaveDays = Number(e.annualLeaveDays);
    if (!Number.isFinite(annualLeaveDays) || annualLeaveDays < 0 || annualLeaveDays > 365) errors.push({ field: 'employment.annualLeaveDays', message: 'Annual leave must be between 0 and 365 days' });
  }

  // ---- organisation
  const department = required(o.department, 'Department', 'organization.department');
  if (department && lookups && lookups.departments && !lookups.departments.map((d) => d.toLowerCase()).includes(department.toLowerCase())) {
    errors.push({ field: 'organization.department', message: `"${department}" is not a department yet. Add it under Admin → Departments.` });
  }
  const designation = required(o.designation, 'Designation', 'organization.designation');
  const shiftType = str(o.shiftType) || 'general';
  if (!registry.has(shiftType)) errors.push({ field: 'organization.shiftType', message: 'Choose one of the defined shifts' });
  const restDays = list(o.restDays).map(str);
  if (restDays.some((d) => !WEEKDAYS.includes(d))) errors.push({ field: 'organization.restDays', message: 'Rest days must be weekday names' });
  if (new Set(restDays).size !== restDays.length || restDays.length > 3) errors.push({ field: 'organization.restDays', message: 'Choose up to three different rest days' });
  const grade = str(o.grade);
  if (grade && lookups && lookups.grades && !lookups.grades.includes(grade.toUpperCase())) errors.push({ field: 'organization.grade', message: 'That grade does not exist' });
  const attendanceMode = o.attendanceMode === 'exempt' ? 'exempt' : 'punch';

  // ---- pay
  const baseSalary = Number(str(pay.baseSalary).replace(/,/g, ''));
  if (!str(pay.baseSalary)) errors.push({ field: 'pay.baseSalary', message: 'Basic salary is required (enter 0 for an unpaid role)' });
  else if (!Number.isFinite(baseSalary) || baseSalary < 0) errors.push({ field: 'pay.baseSalary', message: 'Basic salary must be zero or more' });
  const currency = oneOf(pay.currency, CURRENCIES, 'Currency', errors, 'pay.currency', 'PKR');
  const allowances = list(pay.allowances)
    .map((a, i) => ({ label: str(a.label), amount: Number(str(a.amount).replace(/,/g, '')), _i: i }))
    .filter((a) => a.label || str(a.amount));
  allowances.forEach((a) => {
    if (!a.label) errors.push({ field: `pay.allowances.${a._i}.label`, message: 'Name the allowance' });
    if (!Number.isFinite(a.amount) || a.amount < 0) errors.push({ field: `pay.allowances.${a._i}.amount`, message: 'Allowance must be zero or more' });
  });
  const bank = pay.payment || {};
  const method = oneOf(bank.method, PAYMENT_METHODS, 'Payment method', errors, 'pay.payment.method', 'bank_transfer');
  const hasBank = Boolean(str(bank.bankName) || str(bank.accountNumber) || str(bank.iban));
  const iban = str(bank.iban).replace(/\s+/g, '').toUpperCase();
  if (method === 'bank_transfer' && hasBank) {
    if (!str(bank.accountNumber) && !iban) errors.push({ field: 'pay.payment.accountNumber', message: 'Enter the account number or IBAN' });
    if (!str(bank.bankName)) errors.push({ field: 'pay.payment.bankName', message: 'Enter the bank name' });
  }
  if (iban && iban.startsWith('PK') && !/^PK\d{2}[A-Z0-9]{20}$/.test(iban)) errors.push({ field: 'pay.payment.iban', message: 'A Pakistani IBAN has 24 characters (PK + 2 digits + 20 letters/digits)' });
  if (!hasBank && method === 'bank_transfer') warnings.push('No bank account entered, so this person cannot be paid by transfer yet.');

  // ---- statutory
  const statutory = [];
  if (str(st.eobiNumber)) statutory.push({ scheme: 'eobi', membershipNumber: str(st.eobiNumber) });
  if (bool(st.pfEnrolled)) statutory.push({ scheme: 'provident_fund', membershipNumber: str(st.pfNumber) });
  if (str(st.ntn)) statutory.push({ scheme: 'tax', membershipNumber: str(st.ntn) });
  if (str(st.socialSecurityNumber)) statutory.push({ scheme: 'social_security', membershipNumber: str(st.socialSecurityNumber) });

  // ---- family, education, experience, documents
  const family = list(body.family).map((f, i) => ({ ...f, _i: i })).filter((f) => str(f.name) || str(f.phone));
  family.forEach((f) => {
    if (!str(f.name)) errors.push({ field: `family.${f._i}.name`, message: 'Enter a name' });
    if (str(f.relationship) && !RELATIONSHIPS.includes(f.relationship)) errors.push({ field: `family.${f._i}.relationship`, message: 'Unknown relationship' });
    if (str(f.phone) && !PHONE.test(str(f.phone))) errors.push({ field: `family.${f._i}.phone`, message: 'Phone number is not valid' });
    f.dateOfBirth = dateOrNull(f.dateOfBirth, 'Date of birth', errors, `family.${f._i}.dateOfBirth`, { max: today });
  });
  if (!family.some((f) => bool(f.isEmergency))) warnings.push('No emergency contact entered.');

  const education = list(body.education).map((q, i) => ({ ...q, _i: i })).filter((q) => str(q.title) || str(q.institution));
  education.forEach((q) => {
    if (!str(q.title)) errors.push({ field: `education.${q._i}.title`, message: 'Enter the degree or certificate' });
    q.issuedOn = dateOrNull(q.issuedOn, 'Date awarded', errors, `education.${q._i}.issuedOn`, { max: today });
    if (str(q.preference) && !['primary', 'secondary', 'tertiary'].includes(q.preference)) errors.push({ field: `education.${q._i}.preference`, message: 'Preference must be primary, secondary or tertiary' });
  });

  const experience = list(body.experience).map((x, i) => ({ ...x, _i: i })).filter((x) => str(x.organization));
  const thisYear = new Date().getFullYear();
  experience.forEach((x) => {
    const from = str(x.fromYear) ? Number(x.fromYear) : null;
    const to = str(x.toYear) ? Number(x.toYear) : null;
    if (from !== null && (!Number.isInteger(from) || from < 1950 || from > thisYear)) errors.push({ field: `experience.${x._i}.fromYear`, message: 'Enter a valid start year' });
    if (to !== null && (!Number.isInteger(to) || to < 1950 || to > thisYear)) errors.push({ field: `experience.${x._i}.toYear`, message: 'Enter a valid end year' });
    if (from !== null && to !== null && to < from) errors.push({ field: `experience.${x._i}.toYear`, message: 'The end year is before the start year' });
    x.fromYear = from;
    x.toYear = to;
  });

  const documents = list(body.documents).map((d, i) => ({ ...d, _i: i })).filter((d) => str(d.type) || str(d.title));
  documents.forEach((d) => {
    if (!DOCUMENT_TYPES.includes(str(d.type))) errors.push({ field: `documents.${d._i}.type`, message: 'Choose the document type' });
    d.issuedOn = dateOrNull(d.issuedOn, 'Issue date', errors, `documents.${d._i}.issuedOn`);
    d.expiresOn = dateOrNull(d.expiresOn, 'Expiry date', errors, `documents.${d._i}.expiresOn`, { min: d.issuedOn || undefined });
    if (str(d.confidentiality) && !CONFIDENTIALITY.includes(d.confidentiality)) errors.push({ field: `documents.${d._i}.confidentiality`, message: 'Unknown confidentiality' });
  });

  // ---- access
  const access_ = body.access || {};
  const createLogin = bool(access_.createLogin);
  const role = str(access_.role) || 'employee';
  if (createLogin && !ROLE_VALUES.includes(role)) errors.push({ field: 'access.role', message: 'Choose a role' });

  const payload = {
    employeeCode,
    firstName,
    lastName,
    email,
    middleName: str(p.middleName),
    preferredName: str(p.preferredName),
    fatherName: str(p.fatherName),
    maritalStatus,
    nationality,
    personalEmail,
    mobile,
    phone,
    gender,
    address: currentAddress ? [currentAddress.line1, currentAddress.city].filter(Boolean).join(', ') : '',
    designation,
    department,
    team: str(o.team),
    grade: grade ? grade.toUpperCase() : '',
    costCenter: str(e.costCenter),
    employmentType,
    employmentStatus,
    employeeCategory,
    legalEntity: str(e.legalEntity),
    location: str(e.location),
    shiftType,
    restDays: restDays.length ? restDays : ['saturday', 'sunday'],
    attendanceMode,
    reportsTo: str(o.reportsTo) || null,
    position: str(o.position) || null,
    compensation: { currency, baseSalary: Number.isFinite(baseSalary) ? baseSalary : 0, fixedAllowances: allowances.filter((a) => a.label).map((a) => ({ label: a.label, amount: a.amount })) },
    nationalIds,
  };
  if (dateOfBirth) payload.dateOfBirth = dateOfBirth;
  if (dateOfJoining) payload.dateOfJoining = dateOfJoining;
  if (payGroup) payload.payGroup = payGroup;
  if (probationEndDate) payload.probationEndDate = probationEndDate;
  if (annualLeaveDays !== undefined) payload.annualLeaveDays = annualLeaveDays;
  Object.keys(payload).forEach((k) => {
    if (payload[k] === '' || payload[k] === null) delete payload[k];
  });

  return {
    payload,
    extras: {
      bloodGroup,
      middleName: str(p.middleName),
      confirmationDate,
      addresses,
      family,
      education,
      experience,
      documents,
      statutory,
      bank: hasBank || method !== 'bank_transfer' ? { method, bankName: str(bank.bankName), branch: str(bank.branch), accountTitle: str(bank.accountTitle) || `${firstName} ${lastName}`.trim(), accountNumber: str(bank.accountNumber), iban } : null,
      createLogin,
      role,
      checklist: body.onboarding ? body.onboarding.createChecklist !== false : true,
    },
    errors,
    warnings,
  };
}

/** Database-backed checks the pure builder cannot do: duplicates, the manager, the grade list. */
async function lookupsFor() {
  const [departments, grades] = await Promise.all([org.departmentNames(), Grade.find({}).select('code').lean()]);
  return { departments, grades: grades.map((g) => g.code) };
}

async function checkAgainstDatabase(payload, extras, errors) {
  const [byCode, byEmail, userByEmail] = await Promise.all([
    payload.employeeCode ? Employee.findOne({ employeeCode: payload.employeeCode }).select('_id') : null,
    payload.email ? Employee.findOne({ email: payload.email }).select('_id') : null,
    payload.email ? User.findOne({ email: payload.email }).select('_id') : null,
  ]);
  if (byCode) errors.push({ field: 'employment.employeeCode', message: `Employee code ${payload.employeeCode} is already taken` });
  if (byEmail || userByEmail) errors.push({ field: 'contact.email', message: 'That work email is already used' });

  const cnic = (payload.nationalIds || []).find((n) => n.type === 'cnic');
  if (cnic) {
    const clash = await Person.findOne({ 'nationalIds.number': cnic.number }).select('firstName lastName');
    if (clash) errors.push({ field: 'personal.cnic', message: `This CNIC already belongs to ${clash.firstName} ${clash.lastName}` });
  }
  if (payload.reportsTo) {
    const manager = await Employee.findById(payload.reportsTo).select('employmentStatus');
    if (!manager) errors.push({ field: 'organization.reportsTo', message: 'That manager was not found' });
    else if (['resigned', 'terminated'].includes(manager.employmentStatus)) errors.push({ field: 'organization.reportsTo', message: 'That manager has left the company' });
  }
}

async function onboard(body, user) {
  const lookups = await lookupsFor();
  const built = build(body || {}, lookups);
  await checkAgainstDatabase(built.payload, built.extras, built.errors);
  if (built.errors.length) {
    throw ApiError.badRequest(`Please correct ${built.errors.length} field${built.errors.length === 1 ? '' : 's'} before saving`, built.errors);
  }

  const { payload, extras } = built;
  const warnings = built.warnings.slice();
  let employee;
  try {
    employee = await workforce.createHire(payload, user._id);
  } catch (err) {
    await importer.cleanupOrphan(payload.employeeCode);
    // The hire can still fail on rules only it knows (an occupied position, say).
    const field = /already exists/i.test(err.message) ? 'personal.dateOfBirth' : /position/i.test(err.message) ? 'organization.position' : /reports|manager/i.test(err.message) ? 'organization.reportsTo' : null;
    if (field && err.statusCode && err.statusCode < 500) throw ApiError.badRequest(err.message, [{ field, message: err.message }]);
    throw err;
  }

  const personId = employee.person;
  const joining = new Date(payload.dateOfJoining);
  const step = async (label, fn) => {
    try {
      return await fn();
    } catch (err) {
      warnings.push(`${label} could not be saved: ${err.message}`);
      return null;
    }
  };

  await step('Personal details', async () => {
    const set = {};
    if (extras.bloodGroup) set.bloodGroup = extras.bloodGroup;
    if (extras.middleName) set.middleName = extras.middleName;
    if (Object.keys(set).length) await Person.updateOne({ _id: personId }, { $set: set });
    if (extras.confirmationDate) {
      await Employment.updateOne({ _id: employee.employment }, { $set: { confirmationDate: new Date(extras.confirmationDate) } });
      await Employee.updateOne({ _id: employee._id }, { $set: { confirmationDate: new Date(extras.confirmationDate) } });
    }
  });

  if (extras.addresses.length) {
    await step('Addresses', () => Address.insertMany(extras.addresses.map((a) => ({ person: personId, type: a.type, line1: a.line1, line2: a.line2, city: a.city, postalCode: a.postalCode, country: a.country, effectiveFrom: joining }))));
  }
  if (extras.family.length) {
    await step('Family and emergency contacts', () =>
      FamilyMember.insertMany(
        extras.family.map((f) => ({
          person: personId,
          name: str(f.name),
          relationship: RELATIONSHIPS.includes(f.relationship) ? f.relationship : 'other',
          phone: str(f.phone),
          email: str(f.email).toLowerCase(),
          dateOfBirth: f.dateOfBirth || null,
          occupation: str(f.occupation),
          isEmergency: bool(f.isEmergency),
          isDependent: bool(f.isDependent),
          isNominee: bool(f.isNominee),
          benefitEligible: bool(f.isDependent),
        }))
      )
    );
  }
  if (extras.education.length) {
    await step('Education', () =>
      Qualification.insertMany(
        extras.education.map((q) => ({
          person: personId,
          employee: employee._id,
          type: ['education', 'professional', 'license', 'language', 'membership', 'skill'].includes(q.type) ? q.type : 'education',
          title: str(q.title),
          level: str(q.level),
          discipline: str(q.discipline),
          result: str(q.result),
          preference: str(q.preference),
          institution: str(q.institution),
          issuedOn: q.issuedOn || null,
        }))
      )
    );
  }
  if (extras.experience.length) {
    await step('Previous experience', () =>
      WorkExperience.insertMany(extras.experience.map((x) => ({ person: personId, employee: employee._id, organization: str(x.organization), designation: str(x.designation), fromYear: x.fromYear, toYear: x.toYear, leavingCause: str(x.leavingCause), description: str(x.description) })))
    );
  }
  if (extras.bank) {
    await step('Bank details', () => BankAccount.create({ employee: employee._id, person: personId, ...extras.bank, effectiveFrom: joining, status: 'active', requestedBy: user._id, decidedBy: user._id, decidedAt: new Date(), decisionNote: 'Entered at hire' }));
  }
  if (extras.statutory.length) {
    await step('Statutory enrolments', () =>
      StatutoryEnrollment.insertMany(extras.statutory.map((s) => ({ employee: employee._id, person: personId, scheme: s.scheme, covered: true, membershipNumber: s.membershipNumber, effectiveFrom: joining, status: 'active', requestedBy: user._id, decidedBy: user._id, decidedAt: new Date(), decisionNote: 'Entered at hire' })))
    );
  }

  const documents = [];
  for (const d of extras.documents) {
    // eslint-disable-next-line no-await-in-loop
    const row = await step(`Document "${str(d.title) || str(d.type)}"`, () =>
      EmployeeDocument.create({
        employee: employee._id,
        person: personId,
        type: str(d.type),
        title: str(d.title),
        reference: str(d.reference),
        issuedOn: d.issuedOn || null,
        expiresOn: d.expiresOn || null,
        confidentiality: CONFIDENTIALITY.includes(d.confidentiality) ? d.confidentiality : 'general',
        uploadedBy: user._id,
      })
    );
    documents.push(row ? { index: d._i, id: String(row._id), type: row.type, title: row.title } : { index: d._i, id: null });
  }

  let login = null;
  if (extras.createLogin) {
    login = await step('The login account', async () => {
      const result = await access.createLogin(employee._id, { role: extras.role });
      return { email: result.user.email, role: result.user.roleLabel, temporaryPassword: result.temporaryPassword };
    });
  }

  let checklist = 0;
  if (extras.checklist) checklist = (await step('The onboarding checklist', () => startChecklist(employee, joining))) || 0;

  return { employee, documents, login, warnings, checklist };
}

/* ---------------- onboarding checklist ---------------- */

const addDays = (date, days) => new Date(new Date(date).getTime() + days * 86400000);

/** Idempotent: calling it again only adds items that are missing. */
async function startChecklist(employee, joining) {
  const start = joining || employee.dateOfJoining || new Date();
  const have = new Set((await HireTask.find({ employee: employee._id }).select('key').lean()).map((t) => t.key));
  const missing = HIRE_CHECKLIST.filter((item) => !have.has(item.key));
  if (missing.length) {
    await HireTask.insertMany(missing.map((item) => ({ employee: employee._id, key: item.key, title: item.title, owner: item.owner, dueOn: addDays(start, item.day) })));
  }
  return HireTask.countDocuments({ employee: employee._id });
}

const taskView = (t) => ({ id: String(t._id), key: t.key, title: t.title, owner: t.owner, status: t.status, dueOn: t.dueOn, doneAt: t.doneAt, note: t.note });
const progressOf = (tasks) => ({ total: tasks.length, done: tasks.filter((t) => t.status === 'done').length });

async function checklistFor(employeeId) {
  const tasks = await HireTask.find({ employee: employeeId }).sort({ dueOn: 1, createdAt: 1 }).lean();
  return { tasks: tasks.map(taskView), ...progressOf(tasks) };
}

/** Everyone whose checklist is still open, most overdue first. `scope` null means all employees. */
async function openChecklists(scope) {
  const filter = scope ? { employee: { $in: scope } } : {};
  const tasks = await HireTask.find(filter).populate('employee', 'firstName lastName employeeCode designation department dateOfJoining employmentStatus').sort({ dueOn: 1 }).lean();
  const byEmployee = new Map();
  tasks.forEach((t) => {
    if (!t.employee) return;
    const key = String(t.employee._id);
    if (!byEmployee.has(key)) byEmployee.set(key, { employee: t.employee, tasks: [] });
    byEmployee.get(key).tasks.push(t);
  });
  const now = Date.now();
  return [...byEmployee.values()]
    .map(({ employee, tasks: list }) => {
      const open = list.filter((t) => t.status !== 'done');
      return {
        employee: { id: String(employee._id), name: `${employee.firstName} ${employee.lastName}`, code: employee.employeeCode, designation: employee.designation, department: employee.department, dateOfJoining: employee.dateOfJoining },
        ...progressOf(list),
        overdue: open.filter((t) => t.dueOn && new Date(t.dueOn).getTime() < now).length,
        nextDue: open.length ? open[0].dueOn : null,
        tasks: list.map(taskView),
      };
    })
    .filter((row) => row.done < row.total)
    .sort((a, b) => b.overdue - a.overdue || new Date(a.nextDue || 0) - new Date(b.nextDue || 0));
}

async function setTask(taskId, body, user) {
  const task = await HireTask.findById(taskId);
  if (!task) throw ApiError.notFound('Task not found');
  const done = body.status === 'done';
  task.status = done ? 'done' : 'pending';
  task.doneAt = done ? new Date() : null;
  task.doneBy = done ? user._id : null;
  if (body.note !== undefined) task.note = str(body.note).slice(0, 300);
  await task.save();
  return task;
}

/* ---------------- removing a hire made in error ---------------- */

/** Records that belong to one employee and are created around hiring or the first days of work. */
const OWNED_BY_EMPLOYEE = [
  'Assignment', 'PersonnelFile', 'BankAccount', 'StatutoryEnrollment', 'EmployeeDocument', 'EmployeeReward', 'HireTask', 'ExitTask', 'Qualification', 'WorkExperience',
  'Objective', 'Appraisal', 'Enrollment', 'CertificationRecord', 'BenefitEnrollment', 'LeaveAdjustment', 'ShiftRoster', 'AttendanceRequest', 'AttendancePunch', 'PayrollInput',
];

/**
 * Hiring without a chosen position makes a seat named POS-<code digits> for the person. Once they
 * are gone and nothing else refers to it, that seat has no reason to exist.
 */
async function dropOwnSeat(employee) {
  const digits = String(employee.employeeCode || '').replace(/[^0-9]/g, '');
  if (!employee.currentPosition || !digits) return;
  const seat = await Position.findById(employee.currentPosition);
  if (seat && seat.positionCode === `POS-${digits}` && !seat.incumbent && !(await Assignment.exists({ position: seat._id }))) await seat.deleteOne();
}

/**
 * Removes an employee who should never have been added, together with what the
 * hiring form created: login, seat, documents and their files, family, bank
 * and statutory records. Anyone with payroll, attendance, leave, loan or
 * asset history is refused, because erasing that would falsify the books;
 * they are separated instead, which keeps it.
 */
async function removeEmployee(employee) {
  const id = employee._id;
  const counts = await Promise.all([
    Payslip.countDocuments({ employee: id }), Attendance.countDocuments({ employee: id }), LeaveRequest.countDocuments({ employee: id }),
    Loan.countDocuments({ employee: id }), FinalSettlement.countDocuments({ employee: id }), AssetAssignment.countDocuments({ employee: id }),
  ]);
  const names = ['payslips', 'attendance records', 'leave requests', 'loans', 'final settlements', 'asset records'];
  const have = names.filter((name, i) => counts[i] > 0);
  if (have.length) {
    throw ApiError.conflict(`${employee.fullName} has ${have.join(', ')} on record, so removing them would erase history. Use Separate instead: it ends their employment and keeps the records.`);
  }

  const docs = await EmployeeDocument.find({ employee: id }).select('file').lean();
  await Promise.all(docs.filter((d) => d.file && d.file.id).map((d) => files.remove(d.file.id)));

  for (const name of OWNED_BY_EMPLOYEE) {
    const Model = mongoose.models[name] || require(`../models/${name}`); // eslint-disable-line global-require
    if (Model.schema.path('employee')) {
      // eslint-disable-next-line no-await-in-loop
      await Model.deleteMany({ employee: id });
    }
  }
  if (employee.person) {
    await Promise.all([FamilyMember.deleteMany({ person: employee.person }), Address.deleteMany({ person: employee.person }), Qualification.deleteMany({ person: employee.person }), WorkExperience.deleteMany({ person: employee.person })]);
  }
  if (employee.employment) await Employment.deleteOne({ _id: employee.employment });
  if (employee.person && !(await Employee.exists({ person: employee.person, _id: { $ne: id } }))) await Person.deleteOne({ _id: employee.person });
  if (employee.userAccount) await User.deleteOne({ _id: employee.userAccount });
  await User.deleteMany({ employeeId: employee.employeeCode, email: employee.email });
  await org.vacatePosition(employee.currentPosition, id);
  await dropOwnSeat(employee);
  await Employee.updateMany({ reportsTo: id }, { $set: { reportsTo: null } });
  await employee.deleteOne();
}

module.exports = { removeEmployee, HIRE_CHECKLIST, nextCode, suggestCode, build, onboard, startChecklist, checklistFor, openChecklists, setTask };
