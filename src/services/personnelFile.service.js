'use strict';

/**
 * The personnel file: one employee's record laid out the way an HR office keeps it. Most of it is read
 * from data the system already holds; the rest is the small PersonnelFile record. Who sees what follows
 * the same rule as the employee report: HR everything, the employee their own file, a manager their
 * direct reports without the personal and payment blocks.
 */

const PersonnelFile = require('../models/PersonnelFile');
const Assignment = require('../models/Assignment');
const Qualification = require('../models/Qualification');
const WorkExperience = require('../models/WorkExperience');
const EmployeeReward = require('../models/EmployeeReward');
const FamilyMember = require('../models/FamilyMember');
const Address = require('../models/Address');
const BankAccount = require('../models/BankAccount');
const StatutoryEnrollment = require('../models/StatutoryEnrollment');
const Attendance = require('../models/Attendance');
const LeaveRequest = require('../models/LeaveRequest');
const Enrollment = require('../models/Enrollment');
const ErCase = require('../models/ErCase');
const Person = require('../models/Person');
require('../models/Course');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');
const zoned = require('../utils/zoned');
const registry = require('../config/shiftRegistry');
const leaveService = require('./leave.service');
const importer = require('./import.service');
const { maskNationalId } = require('../utils/mask');
const { EMPLOYEE_CATEGORY_LABELS, PAYMENT_METHOD_LABELS } = require('../config/org');
const { EMPLOYMENT_STATUS_LABELS } = require('../config/hr');

const SCALARS = ['legacyCode', 'unitCode', 'division', 'section', 'joinedAs', 'groupInsurance', 'postalAddress', 'contactNumber'];
const DATES = ['marriageDate', 'approvalDate', 'pfEntitledDate'];
const LEAVE_ORDER = ['casual', 'sick', 'personal', 'annual', 'maternity', 'special', 'compensatory'];
const LEAVE_LABELS = { casual: 'Casual Leave', sick: 'Medical Leave', personal: 'Personal Leave', annual: 'Annual Leave', maternity: 'Maternity Leave', special: 'Special Leave', compensatory: 'Compensatory Leave' };

/** What each hand-kept list accepts. `required` must have a value; dates are checked. */
const LISTS = {
  promotions: { text: ['oldDesignation', 'newDesignation'], dates: ['date'], required: ['date', 'newDesignation'] },
  transfers: { text: ['fromSection', 'toSection'], dates: ['date'], required: ['date', 'toSection'] },
  discipline: { text: ['description', 'decision'], dates: ['date'], required: ['description'] },
  training: { text: ['institute', 'description'], dates: ['from', 'to'], required: ['description'] },
  heirs: { text: ['fullName', 'fatherName', 'husbandName', 'relation'], dates: [], required: ['fullName', 'relation'], numbers: ['share'] },
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const str = (v) => String(v === undefined || v === null ? '' : v).trim();
const key = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const cap = (t) => { const s = String(t || '').replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); };
const today = () => zoned.dateKey(new Date(), env.timezone);
const sectionOf = (a) => [a.department, a.team].filter(Boolean).join(' / ');
const ageOf = (d) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / (365.25 * 86400000)) : null);

async function fileFor(employeeId) {
  return (await PersonnelFile.findOne({ employee: employeeId })) || new PersonnelFile({ employee: employeeId });
}

/* ------------------------------------------------------------------ reading */

async function build(employee, access, yearInput) {
  const id = employee._id;
  const year = Number(yearInput) || Number(today().slice(0, 4));
  const [pf, person, assignments, quals, exp, rewards, family, addresses, banks, statutory, enrolments, cases] = await Promise.all([
    fileFor(id),
    employee.person ? Person.findById(employee.person) : null,
    Assignment.find({ employee: id, status: { $in: ['active', 'superseded'] } }).sort({ effectiveFrom: 1, createdAt: 1 }).lean(),
    Qualification.find({ person: employee.person }).sort({ issuedOn: 1 }).lean(),
    WorkExperience.find({ person: employee.person }).sort({ fromYear: 1 }).lean(),
    EmployeeReward.find({ employee: id }).sort({ awardedOn: 1 }).lean(),
    access.personal ? FamilyMember.find({ person: employee.person, status: { $ne: 'ended' } }).sort({ isEmergency: -1, name: 1 }).lean() : [],
    access.personal ? Address.find({ person: employee.person, status: 'active' }).lean() : [],
    access.personal ? BankAccount.find({ employee: id, status: 'active' }).lean() : [],
    access.personal ? StatutoryEnrollment.find({ employee: id, status: 'active' }).lean() : [],
    Enrollment.find({ employee: id, status: 'completed' }).populate('course', 'title provider delivery').lean(),
    access.isHr ? ErCase.find({ subject: id, 'decision.outcome': { $in: ['upheld', 'not_upheld', 'informal_resolution', 'action'] } }).sort({ createdAt: 1 }).lean() : [],
  ]);
  const reveal = access.isHr || access.isSelf;
  const comp = employee.compensation || {};
  const gross = (Number(comp.baseSalary) || 0) + (comp.fixedAllowances || []).reduce((s, a) => s + (Number(a.amount) || 0), 0);

  const basic = {
    name: [employee.firstName, employee.lastName].filter(Boolean).join(' '),
    employeeNo: employee.employeeCode,
    legacyCode: pf.legacyCode,
    unitCode: pf.unitCode,
    dateOfJoining: key(employee.dateOfJoining),
    grade: employee.grade,
    currentSalary: access.pay ? { amount: Number(comp.baseSalary) || 0, gross, currency: comp.currency || 'PKR' } : null,
    fatherName: person && person.fatherName,
    designation: employee.designation,
    division: pf.division,
    department: employee.department,
    section: pf.section || employee.team || '',
    employmentCategory: EMPLOYEE_CATEGORY_LABELS[employee.employeeCategory] || cap(employee.employeeCategory),
    status: EMPLOYMENT_STATUS_LABELS[employee.employmentStatus] || cap(employee.employmentStatus),
  };

  // Promotions and transfers the assignment history already proves, then the hand-kept ones.
  const derivedPromotions = [];
  const derivedTransfers = [];
  assignments.forEach((a, i) => {
    if (!i) return;
    const prev = assignments[i - 1];
    if (a.designation !== prev.designation) derivedPromotions.push({ date: key(a.effectiveFrom), oldDesignation: prev.designation, newDesignation: a.designation, source: 'system' });
    if (sectionOf(a) !== sectionOf(prev)) derivedTransfers.push({ date: key(a.effectiveFrom), fromSection: sectionOf(prev), toSection: sectionOf(a), source: 'system' });
  });
  const manual = (list, map) => (pf[list] || []).map((e) => Object.assign({ id: String(e._id), source: 'manual' }, map(e)));
  const byDate = (a, b) => String(a.date || a.from || '').localeCompare(String(b.date || b.from || ''));
  const promotions = derivedPromotions.concat(manual('promotions', (e) => ({ date: key(e.date), oldDesignation: e.oldDesignation, newDesignation: e.newDesignation }))).sort(byDate);
  const transfers = derivedTransfers.concat(manual('transfers', (e) => ({ date: key(e.date), fromSection: e.fromSection, toSection: e.toSection }))).sort(byDate);

  const discipline = access.isHr
    ? manual('discipline', (e) => ({ date: key(e.date), description: e.description, decision: e.decision }))
        .concat(cases.map((c) => ({ date: key(c.decision && c.decision.decidedAt) || key(c.closedAt) || key(c.createdAt), description: c.summary, decision: [cap(c.decision.outcome), c.decision.actionType && c.decision.actionType !== 'none' ? cap(c.decision.actionType) : ''].filter(Boolean).join(': '), source: 'case' })))
        .sort(byDate)
    : null;

  const training = manual('training', (e) => ({ from: key(e.from), to: key(e.to), institute: e.institute, description: e.description }))
    .concat(enrolments.map((e) => ({ from: key(e.completedAt), to: key(e.completedAt), institute: (e.course && (e.course.provider || cap(e.course.delivery))) || '', description: (e.course && e.course.title) || '', source: 'system' })))
    .sort(byDate);

  const balances = await leaveService.balancesFor(employee, year);
  const leaveRows = LEAVE_ORDER.map((code) => balances.find((b) => b.code === code)).filter(Boolean)
    .map((b) => ({ type: LEAVE_LABELS[b.code] || b.label, entitled: b.entitlementDays, availed: b.takenDays, balance: b.balanceDays }));
  const leave = { year, rows: leaveRows, total: { entitled: round2(leaveRows.reduce((s, r) => s + r.entitled, 0)), availed: round2(leaveRows.reduce((s, r) => s + r.availed, 0)), balance: round2(leaveRows.reduce((s, r) => s + r.balance, 0)) } };

  const from = `${year}-01-01`;
  const joined = key(employee.dateOfJoining);
  const periodStart = joined && joined > from ? joined : from;
  const periodEnd = `${year}-12-31` < today() ? `${year}-12-31` : today();
  const att = await Attendance.find({ employee: id, date: { $gte: new Date(`${from}T00:00:00Z`), $lte: new Date(`${year}-12-31T00:00:00Z`) } }).select('shiftStatus').lean();
  const count = (s) => att.filter((r) => r.shiftStatus === s).length;
  const countable = count('present') + count('short_day') + count('absent');
  const leaveDocs = await LeaveRequest.find({ employee: id, status: 'approved', fromDate: { $gte: new Date(`${from}T00:00:00Z`), $lte: new Date(`${year}-12-31T00:00:00Z`) } }).select('leaveType days').lean();
  const annual = {
    year,
    totalDays: periodEnd >= periodStart ? Math.round((new Date(`${periodEnd}T00:00:00Z`) - new Date(`${periodStart}T00:00:00Z`)) / 86400000) + 1 : 0,
    workingDays: att.length,
    leaves: round2(leaveDocs.filter((l) => l.leaveType !== 'lwp').reduce((s, l) => s + (Number(l.days) || 0), 0)),
    absents: count('absent'),
    lwp: round2(leaveDocs.filter((l) => l.leaveType === 'lwp').reduce((s, l) => s + (Number(l.days) || 0), 0)),
    attendancePercent: countable ? round2(((count('present') + count('short_day')) / countable) * 100) : null,
  };

  let personal = null;
  let familyRows = null;
  let payment = null;
  let heirs = null;
  if (access.personal) {
    const ids = (person && person.nationalIds) || [];
    const cnic = ids.find((n) => n.type === 'cnic');
    const stat = (scheme) => { const s = statutory.find((x) => x.scheme === scheme); return s ? (reveal ? s.membershipNumber : maskNationalId(s.membershipNumber)) : ''; };
    const addr = (type) => { const a = addresses.find((x) => x.type === type); return a ? [a.line1, a.line2, a.city, a.postalCode].filter(Boolean).join(', ') : ''; };
    const shift = employee.shiftType ? registry.get(employee.shiftType) : null;
    personal = {
      cnic: cnic ? (access.isHr ? cnic.number : maskNationalId(cnic.number)) : '',
      dateOfBirth: key((person && person.dateOfBirth) || employee.dateOfBirth),
      shift: shift ? shift.label : cap(employee.shiftType),
      bloodGroup: (person && person.bloodGroup) || '',
      confirmationDate: key(employee.confirmationDate),
      marriageDate: key(pf.marriageDate),
      approvalDate: key(pf.approvalDate),
      eobiNo: stat('eobi'),
      joinedAs: pf.joinedAs,
      ssn: stat('social_security'),
      gender: cap(employee.gender),
      restDay: (employee.restDays || []).map(cap).join(', '),
      groupInsurance: pf.groupInsurance,
      pfEntitledDate: key(pf.pfEntitledDate),
      permanentAddress: addr('permanent') || employee.address || '',
      postalAddress: pf.postalAddress || addr('current'),
      contactNumber: pf.contactNumber || (person && person.mobile) || employee.phone || '',
    };
    familyRows = family.map((f) => ({ name: f.name, relation: cap(f.relationship), age: ageOf(f.dateOfBirth), occupation: f.occupation, dependent: Boolean(f.isDependent) }));
    const bank = banks[0];
    payment = bank ? { payMethod: PAYMENT_METHOD_LABELS[bank.method] || cap(bank.method), bank: bank.bankName, branch: bank.branch, city: bank.city, accountNo: reveal ? bank.accountNumber : '' } : null;
    heirs = manual('heirs', (e) => ({ fullName: e.fullName, fatherName: e.fatherName, husbandName: e.husbandName, relation: e.relation, share: e.share }));
  }

  return {
    employeeId: String(id),
    year,
    canEdit: access.isHr,
    basic,
    promotions,
    qualifications: quals.map((q) => ({ qualification: q.title, category: q.level || cap(q.type), discipline: q.discipline, division: q.result, year: q.issuedOn ? new Date(q.issuedOn).getUTCFullYear() : null, institution: q.institution, preference: cap(q.preference) })),
    experience: exp.map((x) => ({ organization: x.organization, from: x.fromYear, to: x.toYear, designation: x.designation, leavingCause: x.leavingCause, description: x.description })),
    transfers,
    discipline,
    rewards: rewards.map((r) => ({ authority: r.authority, description: [r.reward, r.description].filter(Boolean).join(': '), date: key(r.awardedOn) })),
    leave,
    family: familyRows,
    training,
    personal,
    annual,
    payment,
    heirs,
    details: access.isHr ? Object.fromEntries(SCALARS.concat(DATES).map((k) => [k, DATES.includes(k) ? key(pf[k]) || '' : pf[k] || ''])) : null,
  };
}

/* ------------------------------------------------------------------ writing */

function badRequest(errors) {
  return ApiError.badRequest(errors.length === 1 ? errors[0].message : `Please correct ${errors.length} fields`, errors);
}

async function saveDetails(employee, body) {
  const errors = [];
  const pf = await fileFor(employee._id);
  const oldSection = pf.section;
  SCALARS.forEach((k) => {
    if (body[k] === undefined) return;
    const v = str(body[k]);
    if (v.length > (k === 'postalAddress' ? 300 : 80)) errors.push({ field: k, message: 'That is too long' });
    else pf[k] = v;
  });
  DATES.forEach((k) => {
    if (body[k] === undefined) return;
    const v = str(body[k]);
    if (!v) { pf[k] = null; return; }
    const iso = importer.parseDate(v);
    if (!iso) errors.push({ field: k, message: 'Enter a valid date' });
    else pf[k] = new Date(`${iso}T00:00:00Z`);
  });
  if (errors.length) throw badRequest(errors);
  // Moving someone between sections is a transfer, so record it without making HR type it twice.
  if (oldSection && pf.section && oldSection !== pf.section) pf.transfers.push({ date: new Date(`${today()}T00:00:00Z`), fromSection: oldSection, toSection: pf.section });
  await pf.save();
}

function cleanEntry(listName, body) {
  const def = LISTS[listName];
  if (!def) throw ApiError.notFound('Unknown list');
  const errors = [];
  const entry = {};
  def.text.forEach((k) => { entry[k] = str(body[k]).slice(0, 400); });
  def.dates.forEach((k) => {
    const v = str(body[k]);
    if (!v) { entry[k] = null; return; }
    const iso = importer.parseDate(v);
    if (!iso) errors.push({ field: k, message: 'Enter a valid date' });
    else entry[k] = new Date(`${iso}T00:00:00Z`);
  });
  (def.numbers || []).forEach((k) => {
    const n = Number(body[k] === '' || body[k] === undefined ? 0 : body[k]);
    if (!Number.isFinite(n) || n < 0 || n > 100) errors.push({ field: k, message: 'Enter a percentage from 0 to 100' });
    else entry[k] = n;
  });
  def.required.forEach((k) => { if (entry[k] === null || entry[k] === undefined || entry[k] === '') errors.push({ field: k, message: 'This is required' }); });
  if (errors.length) throw badRequest(errors);
  return entry;
}

async function addEntry(employee, listName, body) {
  const entry = cleanEntry(listName, body || {});
  const pf = await fileFor(employee._id);
  if (listName === 'heirs') {
    const total = pf.heirs.reduce((s, h) => s + (Number(h.share) || 0), 0) + (entry.share || 0);
    if (total > 100) throw badRequest([{ field: 'share', message: `Shares would add up to ${round2(total)}%. They cannot exceed 100%.` }]);
  }
  pf[listName].push(entry);
  await pf.save();
}

async function removeEntry(employee, listName, entryId) {
  if (!LISTS[listName]) throw ApiError.notFound('Unknown list');
  const pf = await fileFor(employee._id);
  const row = pf[listName].id(entryId);
  if (!row) throw ApiError.notFound('Entry not found');
  row.deleteOne();
  await pf.save();
}

module.exports = { LISTS, build, saveDetails, addEntry, removeEntry, cleanEntry };
