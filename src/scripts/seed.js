'use strict';

/**
 * Creates one login account per role so the sign-in screen is usable
 * immediately, plus a small Core HR directory to populate the employee table.
 */

const User = require('../models/User');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const logger = require('../utils/logger');
const { ROLES } = require('../config/roles');
const { connectDatabase, disconnectDatabase } = require('../config/database');
const Payslip = require('../models/Payslip');
const ArrearsAdjustment = require('../models/ArrearsAdjustment');
const SignaturePack = require('../models/SignaturePack');
const RolePermission = require('../models/RolePermission');
const Loan = require('../models/Loan');
const CompensationRequest = require('../models/CompensationRequest');
const Objective = require('../models/Objective');
const Kpi = require('../models/Kpi');
const Appraisal = require('../models/Appraisal');
const Assignment = require('../models/Assignment');
const FamilyMember = require('../models/FamilyMember');
const EmployeeDocument = require('../models/EmployeeDocument');
const BankAccount = require('../models/BankAccount');
const StatutoryEnrollment = require('../models/StatutoryEnrollment');
const Qualification = require('../models/Qualification');
const LeaveRequest = require('../models/LeaveRequest');
const Holiday = require('../models/Holiday');
const Requisition = require('../models/Requisition');
const Application = require('../models/Application');
const Grade = require('../models/Grade');
const Course = require('../models/Course');
const TrainingSession = require('../models/TrainingSession');
const Enrollment = require('../models/Enrollment');
const CertificationRecord = require('../models/CertificationRecord');
const Competency = require('../models/Competency');
const BenefitPlan = require('../models/BenefitPlan');
const PlanOption = require('../models/PlanOption');
const BenefitEnrollment = require('../models/BenefitEnrollment');
const ComplianceRule = require('../models/ComplianceRule');
const Filing = require('../models/Filing');
const License = require('../models/License');
const PolicyDocument = require('../models/PolicyDocument');
const AcknowledgementLog = require('../models/AcknowledgementLog');
const RetentionRule = require('../models/RetentionRule');
const ErCase = require('../models/ErCase');
const Asset = require('../models/Asset');
const AssetAssignment = require('../models/AssetAssignment');
const TransportRoute = require('../models/TransportRoute');
const AccommodationAllocation = require('../models/AccommodationAllocation');
const MaintenanceLog = require('../models/MaintenanceLog');
const KPISnapshot = require('../models/KPISnapshot');
const Delegation = require('../models/Delegation');
const Person = require('../models/Person');
const org = require('../services/org.service');
const { toMinor } = require('../utils/money');
const { instalments } = require('../services/loanMath');
const { currentPeriod } = require('../config/pms');
const workforce = require('../services/workforce.service');
const leave = require('../services/leave.service');
const ats = require('../services/recruitment.service');
const benefits = require('../services/benefits.service');
const compliance = require('../services/compliance.service');
const analytics = require('../services/analytics.service');
const admin = require('../services/admin.service');
const arrears = require('../services/arrears.service');
const esign = require('../services/esign.service');
const {
  attendanceDate,
  weekdayKey,
  shiftFor,
  computeTotals,
  monthRange,
  buildMonth,
} = require('../services/attendance.service');
const { buildPeriod, computePayslip } = require('../services/payroll.service');

const seedUsers = [
  {
    employeeId: 'PH-1001',
    firstName: 'Ayesha',
    lastName: 'Rahman',
    email: 'hr.admin@portohr.test',
    password: 'Portohr@123',
    role: ROLES.HR_ADMIN,
    designation: 'Head of People Operations',
    department: 'Human Resources',
  },
  {
    employeeId: 'PH-1002',
    firstName: 'Daniel',
    lastName: 'Okafor',
    email: 'manager@portohr.test',
    password: 'Portohr@123',
    role: ROLES.MANAGER,
    designation: 'Engineering Manager',
    department: 'Engineering',
  },
  {
    employeeId: 'PH-1003',
    firstName: 'Mohid',
    lastName: 'Khan',
    email: 'employee@portohr.test',
    password: 'Portohr@123',
    role: ROLES.EMPLOYEE,
    designation: 'Software Engineer',
    department: 'Engineering',
  },
];

/**
 * `manager` refers to another entry in this list by employeeCode; it is
 * resolved to a real ObjectId in a second pass once every record exists.
 */
const seedEmployees = [
  {
    employeeCode: 'PH-1001',
    firstName: 'Ayesha',
    lastName: 'Rahman',
    email: 'hr.admin@portohr.test',
    phone: '+1 415 555 0111',
    designation: 'Head of People Operations',
    department: 'Human Resources',
    team: 'People Ops',
    employmentType: 'full_time',
    employmentStatus: 'confirmed',
    dateOfJoining: '2019-03-04',
    shiftType: 'general',
    restDays: ['saturday', 'sunday'],
    compensation: {
      currency: 'USD',
      baseSalary: 11500,
      fixedAllowances: [
        { label: 'Housing', amount: 2500 },
        { label: 'Transport', amount: 600 },
      ],
    },
  },
  {
    employeeCode: 'PH-1002',
    firstName: 'Daniel',
    lastName: 'Okafor',
    email: 'manager@portohr.test',
    phone: '+1 415 555 0122',
    designation: 'Engineering Manager',
    department: 'Engineering',
    team: 'Platform',
    employmentType: 'full_time',
    employmentStatus: 'confirmed',
    dateOfJoining: '2020-07-13',
    shiftType: 'general',
    restDays: ['saturday', 'sunday'],
    compensation: {
      currency: 'USD',
      baseSalary: 12800,
      fixedAllowances: [
        { label: 'Housing', amount: 2800 },
        { label: 'Internet', amount: 150 },
      ],
    },
  },
  {
    employeeCode: 'PH-1003',
    firstName: 'Mohid',
    lastName: 'Khan',
    email: 'employee@portohr.test',
    phone: '+92 300 555 0133',
    designation: 'Software Engineer',
    department: 'Engineering',
    team: 'Platform',
    manager: 'PH-1002',
    employmentType: 'full_time',
    employmentStatus: 'confirmed',
    dateOfJoining: '2022-01-17',
    shiftType: 'general',
    restDays: ['saturday', 'sunday'],
    compensation: {
      currency: 'USD',
      baseSalary: 7400,
      fixedAllowances: [
        { label: 'Housing', amount: 1600 },
        { label: 'Internet', amount: 120 },
      ],
    },
  },
  {
    employeeCode: 'PH-1004',
    firstName: 'Sofia',
    lastName: 'Marino',
    email: 'sofia.marino@portohr.test',
    phone: '+39 06 555 0144',
    designation: 'Senior Frontend Engineer',
    department: 'Engineering',
    team: 'Product',
    manager: 'PH-1002',
    employmentType: 'full_time',
    employmentStatus: 'confirmed',
    dateOfJoining: '2021-09-06',
    shiftType: 'general',
    restDays: ['saturday', 'sunday'],
    compensation: {
      currency: 'EUR',
      baseSalary: 8200,
      fixedAllowances: [{ label: 'Housing', amount: 1400 }],
    },
  },
  {
    employeeCode: 'PH-1005',
    firstName: 'Ethan',
    lastName: 'Brooks',
    email: 'ethan.brooks@portohr.test',
    designation: 'Support Specialist',
    department: 'Customer Support',
    team: 'Tier 2',
    employmentType: 'full_time',
    employmentStatus: 'probation',
    dateOfJoining: '2025-11-03',
    shiftType: 'night',
    restDays: ['tuesday', 'wednesday'],
    compensation: {
      currency: 'USD',
      baseSalary: 4300,
      fixedAllowances: [{ label: 'Night shift', amount: 700 }],
    },
  },
  {
    employeeCode: 'PH-1006',
    firstName: 'Priya',
    lastName: 'Nair',
    email: 'priya.nair@portohr.test',
    designation: 'Financial Analyst',
    department: 'Finance',
    team: 'FP&A',
    employmentType: 'full_time',
    employmentStatus: 'confirmed',
    dateOfJoining: '2023-05-22',
    shiftType: 'general',
    restDays: ['saturday', 'sunday'],
    compensation: {
      currency: 'USD',
      baseSalary: 6900,
      fixedAllowances: [{ label: 'Transport', amount: 400 }],
    },
  },
  {
    employeeCode: 'PH-1007',
    firstName: 'Lukas',
    lastName: 'Weber',
    email: 'lukas.weber@portohr.test',
    designation: 'Account Executive',
    department: 'Sales',
    team: 'EMEA',
    employmentType: 'full_time',
    employmentStatus: 'notice_period',
    dateOfJoining: '2022-08-01',
    shiftType: 'evening',
    restDays: ['friday', 'saturday'],
    compensation: {
      currency: 'EUR',
      baseSalary: 5800,
      fixedAllowances: [
        { label: 'Car', amount: 900 },
        { label: 'Phone', amount: 100 },
      ],
    },
  },
  {
    employeeCode: 'PH-1008',
    firstName: 'Amara',
    lastName: 'Diallo',
    email: 'amara.diallo@portohr.test',
    designation: 'Operations Coordinator',
    department: 'Operations',
    team: 'Facilities',
    employmentType: 'part_time',
    employmentStatus: 'confirmed',
    dateOfJoining: '2024-02-19',
    shiftType: 'morning',
    restDays: ['sunday'],
    compensation: {
      currency: 'USD',
      baseSalary: 3200,
      fixedAllowances: [],
    },
  },
];

async function seedDirectory() {
  const created = [];

  for (const { manager, ...data } of seedEmployees) {
    const existing = await Employee.findOne({ employeeCode: data.employeeCode });
    if (existing) {
      logger.info(`Skipped employee ${data.employeeCode} (already exists)`);
      continue;
    }
    const employee = await Employee.create(data);
    created.push({ employee, managerCode: manager });
  }

  // Second pass: now that every record has an id, wire up the reporting lines.
  for (const { employee, managerCode } of created) {
    if (!managerCode) continue;
    const managerDoc = await Employee.findOne({ employeeCode: managerCode }).select('_id');
    if (managerDoc) {
      employee.reportsTo = managerDoc._id;
      await employee.save();
    }
  }

  // Link each directory record to its login account where one exists.
  const users = await User.find().select('_id email');
  for (const user of users) {
    await Employee.updateOne(
      { email: user.email, userAccount: null },
      { $set: { userAccount: user._id } }
    );
  }

  if (created.length) logger.info(`Created ${created.length} employee record(s)`);
}

/**
 * Splits each directory row into Person / Employment / Position / Assignment,
 * then adds one superseded row and one pending salary change so the timeline
 * and maker-checker queue have something to show on a fresh database.
 */
async function seedWorkforce() {
  await org.ensureOrganization();
  const employees = await Employee.find();
  for (const employee of employees) {
    await workforce.ensureWorkforce(employee);
  }

  const mohid = await Employee.findOne({ employeeCode: 'PH-1003' });
  if (mohid && (await Assignment.countDocuments({ employee: mohid._id })) === 1) {
    const active = await Assignment.findOne({ employee: mohid._id, status: 'active' });
    const joined = workforce.startOfDay(mohid.dateOfJoining);
    const moved = workforce.startOfDay('2024-06-01');
    const snapshot = workforce.assignmentSnapshot(mohid);
    await Assignment.create({
      employee: mohid._id,
      employment: mohid.employment,
      person: mohid.person,
      position: active.position,
      designation: snapshot.designation,
      department: snapshot.department,
      team: 'Product',
      reportsTo: snapshot.reportsTo,
      shiftType: snapshot.shiftType,
      restDays: snapshot.restDays,
      compensation: {
        currency: snapshot.compensation.currency,
        baseSalary: snapshot.compensation.baseSalary - 400,
        fixedAllowances: snapshot.compensation.fixedAllowances,
      },
      effectiveFrom: joined,
      effectiveTo: moved,
      status: 'superseded',
      changedFields: [],
      requiresApproval: false,
    });
    active.effectiveFrom = moved;
    active.changedFields = ['team', 'compensation'];
    await active.save();
  }

  const sofia = await Employee.findOne({ employeeCode: 'PH-1004' });
  const hr = await User.findOne({ role: ROLES.HR_ADMIN });
  if (sofia && hr && !(await Assignment.findOne({ employee: sofia._id, status: 'pending' }))) {
    await workforce.ensureWorkforce(sofia);
    const snapshot = workforce.assignmentSnapshot(sofia);
    const position = await workforce.findOrCreatePosition(snapshot.designation);
    await Assignment.create({
      employee: sofia._id,
      employment: sofia.employment,
      person: sofia.person,
      position: position._id,
      designation: snapshot.designation,
      department: snapshot.department,
      team: snapshot.team,
      reportsTo: snapshot.reportsTo,
      shiftType: snapshot.shiftType,
      restDays: snapshot.restDays,
      compensation: {
        currency: snapshot.compensation.currency,
        baseSalary: snapshot.compensation.baseSalary + 500,
        fixedAllowances: snapshot.compensation.fixedAllowances,
      },
      effectiveFrom: workforce.startOfDay(),
      status: 'pending',
      changedFields: ['compensation'],
      requiresApproval: true,
      reason: 'Annual review increase proposed by People Ops.',
      requestedBy: hr._id,
    });
  }

  logger.info('Workforce history ready (Person, Employment, Position, Assignment)');
}

async function seedPersonnelFile() {
  const mohid = await Employee.findOne({ employeeCode: 'PH-1003' });
  const sofia = await Employee.findOne({ employeeCode: 'PH-1004' });
  const ayesha = await Employee.findOne({ employeeCode: 'PH-1001' });
  if (!mohid) return;

  const person = await Person.findById(mohid.person);
  if (person && !person.fatherName) {
    person.fatherName = 'Imran Khan';
    person.nationality = 'PK';
    person.maritalStatus = 'single';
    person.personalEmail = 'mohid.khan.personal@example.com';
    person.mobile = '+92 300 555 0133';
    person.nationalIds = [{ type: 'cnic', number: '35202-1234567-1', issuingCountry: 'PK' }];
    await person.save();
  }

  if (mohid.person && !(await FamilyMember.findOne({ person: mohid.person }))) {
    await FamilyMember.create({
      person: mohid.person,
      name: 'Imran Khan',
      relationship: 'father',
      phone: '+92 300 555 0100',
      isEmergency: true,
    });
  }

  if (!(await Qualification.findOne({ person: mohid.person }))) {
    await Qualification.create({
      person: mohid.person,
      employee: mohid._id,
      type: 'education',
      title: 'BSc Computer Science',
      institution: 'NUST',
      issuedOn: '2021-07-01',
    });
  }

  if (!(await EmployeeDocument.findOne({ employee: mohid._id }))) {
    await EmployeeDocument.create({
      employee: mohid._id,
      person: mohid.person,
      type: 'cnic',
      title: 'CNIC copy',
      reference: '35202-1234567-1',
      issuedOn: '2020-01-15',
      expiresOn: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
      verificationStatus: 'verified',
    });
    await EmployeeDocument.create({
      employee: mohid._id,
      person: mohid.person,
      type: 'contract',
      title: 'Employment contract',
      documentDate: mohid.dateOfJoining,
      verificationStatus: 'verified',
      confidentiality: 'sensitive',
    });
  }

  if (!(await StatutoryEnrollment.findOne({ employee: mohid._id }))) {
    await StatutoryEnrollment.create({
      employee: mohid._id,
      person: mohid.person,
      scheme: 'eobi',
      covered: true,
      membershipNumber: 'EOBI-1003-8821',
      status: 'active',
      effectiveFrom: mohid.dateOfJoining,
    });
  }

  if (ayesha && !(await BankAccount.findOne({ employee: ayesha._id }))) {
    await BankAccount.create({
      employee: ayesha._id,
      person: ayesha.person,
      method: 'bank_transfer',
      bankName: 'HBL',
      branch: 'Clifton',
      accountTitle: 'Ayesha Rahman',
      accountNumber: '001234567890',
      iban: 'PK36HABB0000001234567890',
      status: 'active',
    });
  }

  if (sofia && !(await BankAccount.findOne({ employee: sofia._id, status: 'pending' }))) {
    await BankAccount.create({
      employee: sofia._id,
      person: sofia.person,
      method: 'bank_transfer',
      bankName: 'Meezan Bank',
      branch: 'DHA',
      accountTitle: 'Sofia Marino',
      accountNumber: '009988776655',
      iban: 'PK12MEZN0000009988776655',
      status: 'pending',
      reason: 'Switching salary account after relocation.',
    });
  }

  logger.info('Personnel file samples ready (family, documents, bank, statutory)');
}

/** Small deterministic PRNG so re-seeding produces the same history every time. */
function seededRandom(key) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  }
  return function next() {
    hash += 0x6d2b79f5;
    let t = hash;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Long enough that the two months payroll is seeded for are fully covered. */
const HISTORY_DAYS = 100;

/**
 * Builds a plausible attendance history. Clock times are generated first and the
 * status is then derived with the same computeTotals() the live clock-out uses,
 * so seeded days obey exactly the same overtime and short-day rules.
 */
async function seedAttendance() {
  if ((await Attendance.estimatedDocumentCount()) > 0) {
    logger.info('Skipped attendance history (records already exist)');
    return;
  }

  const employees = await Employee.find();
  const todayKey = attendanceDate().getTime();
  const rows = [];

  for (const employee of employees) {
    const random = seededRandom(employee.employeeCode);
    const shift = shiftFor(employee.shiftType);
    const [startHour, startMinute] = (shift.startTime || '09:00').split(':').map(Number);
    const joined = attendanceDate(employee.dateOfJoining);

    for (let back = HISTORY_DAYS; back >= 1; back -= 1) {
      const date = new Date(todayKey - back * 24 * 60 * 60 * 1000);
      if (date < joined) continue;
      if ((employee.restDays || []).indexOf(weekdayKey(date)) !== -1) continue;

      const roll = random();
      if (roll < 0.04) {
        rows.push({
          employee: employee._id,
          date,
          shiftType: employee.shiftType,
          shiftStatus: 'absent',
          notes: 'Unplanned absence',
        });
        continue;
      }
      if (roll < 0.1) {
        rows.push({
          employee: employee._id,
          date,
          shiftType: employee.shiftType,
          shiftStatus: 'on_leave',
          notes: 'Annual leave',
        });
        continue;
      }

      // Arrive within 20 minutes of the shift start, then work a variable day.
      // Built in local time so seeded clock times read the same way as live ones.
      const timeIn = new Date(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        startHour,
        startMinute + Math.round(random() * 20)
      );

      const workedHours = shift.expectedHours + (random() * 3.5 - 1.25);
      const timeOut = new Date(
        timeIn.getTime() + (workedHours + shift.breakMinutes / 60) * 3600000
      );

      const totals = computeTotals(timeIn, timeOut, shift);
      rows.push({
        employee: employee._id,
        date,
        timeIn,
        timeOut,
        shiftType: employee.shiftType,
        expectedHours: shift.expectedHours,
        hoursWorked: totals.hoursWorked,
        overtimeHours: totals.overtimeHours,
        shortfallHours: totals.shortfallHours,
        shiftStatus: totals.shiftStatus,
      });
    }
  }

  await Attendance.insertMany(rows);
  logger.info(`Created ${rows.length} attendance record(s) across ${employees.length} employees`);
}

/**
 * Runs payroll over the completed months already covered by the seeded
 * attendance, and marks them paid so employees start with real payslip history.
 * Uses the live engine, so seeded payslips are not hand-written fiction.
 */
async function seedPayroll() {
  if ((await Payslip.estimatedDocumentCount()) > 0) {
    logger.info('Skipped payroll history (payslips already exist)');
    return;
  }

  const employees = await Employee.find();
  const now = new Date();
  const months = [2, 1].map((back) => {
    const date = new Date(now.getFullYear(), now.getMonth() - back, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  });

  let created = 0;
  for (const month of months) {
    const range = monthRange(month);

    for (const employee of employees) {
      if (employee.dateOfJoining >= range.end) continue;

      const records = await Attendance.find({
        employee: employee._id,
        date: { $gte: range.start, $lt: range.end },
      }).sort({ date: 1 });

      const { summary } = buildMonth(employee, range, records, now);
      const attendance = Object.assign({}, summary, { recordedDays: records.length });
      const computed = computePayslip({
        employee,
        period: buildPeriod(employee, range, now),
        attendance,
      });

      await Payslip.create({
        employee: employee._id,
        month,
        currency: computed.currency,
        snapshot: {
          employeeCode: employee.employeeCode,
          fullName: employee.fullName,
          designation: employee.designation,
          department: employee.department,
          team: employee.team,
          employmentType: employee.employmentType,
          shiftType: employee.shiftType,
          dateOfJoining: employee.dateOfJoining,
          contractedBasic: computed.contracted.basic,
          contractedAllowances: computed.contracted.allowances,
          contractedGross: computed.contracted.gross,
        },
        period: computed.period,
        attendance: computed.attendance,
        rates: computed.rates,
        earnings: computed.earnings,
        deductions: computed.deductions,
        incomeTaxDetail: computed.incomeTaxDetail,
        taxableGross: computed.taxableGross,
        netPay: computed.netPay,
        warnings: computed.warnings,
        engineVersion: computed.engineVersion,
        status: 'paid',
        generatedAt: range.end,
        finalisedAt: range.end,
        paidAt: range.end,
      });
      created += 1;
    }
  }

  logger.info(`Created ${created} payslip(s) across ${months.join(', ')}`);
}

async function seedArrears() {
  if ((await ArrearsAdjustment.estimatedDocumentCount()) > 0) {
    logger.info('Skipped arrears (already exist)');
    return;
  }
  const mohid = await Employee.findOne({ employeeCode: 'PH-1003' });
  const hrUser = await User.findOne({ email: 'hr.admin@portohr.test' });
  if (!mohid || !hrUser) {
    logger.warn('Skipped arrears (Mohid or HR login missing)');
    return;
  }
  const now = new Date();
  const closed = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const month = `${closed.getFullYear()}-${String(closed.getMonth() + 1).padStart(2, '0')}`;
  try {
    await arrears.simulate(hrUser, {
      employee: String(mohid._id),
      month,
      reason: 'Backdated increment that should have applied from 1 July.',
      whatIf: { baseSalary: 8000 },
    });
    logger.info(`Created Mohid arrears simulation for ${month} (what-if basic 8000)`);
  } catch (err) {
    logger.warn(`Skipped arrears (${err.message})`);
  }
}

/**
 * A queue that is worth looking at: some requests already decided, and some
 * still pending so the approval buttons have something to act on.
 */
const seedLoans = [
  { employeeCode: 'PH-1003', amount: 6000, repaymentMonths: 12, reason: 'Deposit and agency fees for a new apartment closer to the office.', status: 'pending', daysAgo: 3 },
  { employeeCode: 'PH-1005', amount: 2500, repaymentMonths: 6, reason: 'Replacing a failed home boiler ahead of winter.', status: 'approved', daysAgo: 40, decisionNote: 'Approved. Instalments start with next month payroll.' },
  { employeeCode: 'PH-1007', amount: 15000, repaymentMonths: 24, reason: 'Funding a family vehicle purchase over two years.', status: 'rejected', daysAgo: 26, decisionNote: 'Above the limit for the current grade. Reapply for a smaller amount.' },
  { employeeCode: 'PH-1006', amount: 1800, repaymentMonths: 9, reason: 'Part-time postgraduate course fees for the coming semester.', status: 'pending', daysAgo: 1 },
];

const seedClaims = [
  { employeeCode: 'PH-1003', type: 'travel_allowance', amount: 480.5, receiptProof: 'https://receipts.portohr.test/2026/travel-1042', note: 'Client workshop, two nights.', status: 'pending', daysAgo: 2 },
  { employeeCode: 'PH-1004', type: 'travel_allowance', amount: 1265, receiptProof: 'EXP-2026-0318', status: 'approved', daysAgo: 33, decisionNote: 'Receipts match the trip report.' },
  { employeeCode: 'PH-1008', type: 'annual_benefit', amount: 2000, note: 'Annual wellbeing entitlement.', status: 'approved', daysAgo: 55, decisionNote: 'Within entitlement.' },
  { employeeCode: 'PH-1005', type: 'travel_allowance', amount: 92.4, receiptProof: 'https://receipts.portohr.test/2026/travel-1088', note: 'Airport transfer for the vendor visit.', status: 'pending', daysAgo: 5 },
];

async function seedFinanceRequests() {
  if ((await Loan.estimatedDocumentCount()) > 0 || (await CompensationRequest.estimatedDocumentCount()) > 0) {
    logger.info('Skipped finance requests (loans or claims already exist)');
    return;
  }

  const employees = await Employee.find();
  const byCode = new Map(employees.map((employee) => [employee.employeeCode, employee]));
  const users = await User.find();
  const userByEmail = new Map(users.map((user) => [user.email, user]));
  const approver = await User.findOne({ role: ROLES.HR_ADMIN });

  const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const base = (entry) => {
    const employee = byCode.get(entry.employeeCode);
    if (!employee) return null;
    const raisedAt = daysAgo(entry.daysAgo);
    const submitter = userByEmail.get(employee.email);

    return {
      employee: employee._id,
      currency: employee.compensation.currency,
      snapshot: {
        employeeCode: employee.employeeCode,
        fullName: employee.fullName,
        designation: employee.designation,
        department: employee.department,
      },
      status: entry.status,
      decisionNote: entry.decisionNote || '',
      decidedBy: entry.status === 'pending' ? null : (approver && approver._id) || null,
      // Decided a couple of days after it was raised, as a real queue would be.
      decidedAt: entry.status === 'pending' ? null : daysAgo(Math.max(entry.daysAgo - 2, 0)),
      submittedBy: (submitter && submitter._id) || null,
      createdAt: raisedAt,
      updatedAt: raisedAt,
    };
  };

  const loans = seedLoans
    .map((entry) => {
      const common = base(entry);
      if (!common) return null;
      const amount = toMinor(entry.amount);
      return Object.assign(common, {
        amount,
        reason: entry.reason,
        repaymentMonths: entry.repaymentMonths,
      }, instalments(amount, entry.repaymentMonths));
    })
    .filter(Boolean);

  const claims = seedClaims
    .map((entry) => {
      const common = base(entry);
      if (!common) return null;
      return Object.assign(common, {
        type: entry.type,
        amount: toMinor(entry.amount),
        receiptProof: entry.receiptProof || '',
        note: entry.note || '',
      });
    })
    .filter(Boolean);

  // `timestamps: true` would overwrite createdAt on insert without this.
  await Loan.insertMany(loans, { timestamps: false });
  await CompensationRequest.insertMany(claims, { timestamps: false });

  logger.info(`Created ${loans.length} loan request(s) and ${claims.length} compensation claim(s)`);
}

const seedHolidays2026 = [
  { date: '2026-01-01', name: 'New Year’s Day' },
  { date: '2026-03-20', name: 'Eid al-Fitr' },
  { date: '2026-03-21', name: 'Eid al-Fitr (2nd day)' },
  { date: '2026-03-23', name: 'Pakistan Day' },
  { date: '2026-05-01', name: 'Labour Day' },
  { date: '2026-05-27', name: 'Eid al-Adha' },
  { date: '2026-05-28', name: 'Eid al-Adha (2nd day)' },
  { date: '2026-08-14', name: 'Independence Day' },
  { date: '2026-12-25', name: 'Christmas Day' },
];

async function seedLeave() {
  await leave.ensureLeaveTypes();

  if ((await Holiday.estimatedDocumentCount()) === 0) {
    await Holiday.insertMany(
      seedHolidays2026.map((row) => ({
        date: leave.parseDate(row.date, 'Holiday date'),
        name: row.name,
        location: '',
      }))
    );
    logger.info(`Created ${seedHolidays2026.length} public holidays for 2026`);
  } else {
    logger.info('Skipped holidays (already exist)');
  }

  if ((await LeaveRequest.estimatedDocumentCount()) > 0) {
    logger.info('Skipped leave requests (already exist)');
    return;
  }

  const mohid = await Employee.findOne({ employeeCode: 'PH-1003' });
  const sofia = await Employee.findOne({ employeeCode: 'PH-1004' });
  const managerUser = await User.findOne({ email: 'manager@portohr.test' });
  const employeeUser = await User.findOne({ email: 'employee@portohr.test' });
  const hrUser = await User.findOne({ email: 'hr.admin@portohr.test' });

  if (!mohid || !sofia || !managerUser || !employeeUser || !hrUser) {
    logger.info('Skipped leave requests (directory users are incomplete)');
    return;
  }

  // HR raises Sofia’s request so her manager is free to approve it.
  await leave.createRequest(sofia, hrUser, {
    leaveType: 'casual',
    fromDate: '2026-09-16',
    toDate: '2026-09-16',
    reason: 'Family appointment that cannot be moved to a rest day.',
  });

  const drafted = await leave.createRequest(mohid, employeeUser, {
    leaveType: 'annual',
    fromDate: '2026-09-21',
    toDate: '2026-09-23',
    reason: 'Travelling home for a family wedding over a long weekend.',
  });
  const pending = await LeaveRequest.findById(drafted.id);
  await leave.decideRequest(pending, mohid, managerUser, 'approved', 'Coverage confirmed with the platform team.');

  logger.info('Created leave types, holidays and sample leave requests');
}

function snapshotOf(employee) {
  return {
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    designation: employee.designation,
    department: employee.department,
    team: employee.team || '',
    grade: employee.grade || '',
  };
}

/**
 * One open self-assessment (Mohid) so the employee form has something to
 * submit, and one already self-assessed review (Sofia) so a manager can open
 * the side-by-side supervisor view without filling the form first.
 */
async function seedPms() {
  if ((await Objective.estimatedDocumentCount()) > 0 || (await Appraisal.estimatedDocumentCount()) > 0) {
    logger.info('Skipped PMS (objectives or appraisals already exist)');
    return;
  }

  const period = currentPeriod();
  const managerUser = await User.findOne({ email: 'manager@portohr.test' });
  const mohid = await Employee.findOne({ employeeCode: 'PH-1003' });
  const sofia = await Employee.findOne({ employeeCode: 'PH-1004' });
  if (!mohid || !sofia) {
    logger.warn('Skipped PMS (PH-1003 or PH-1004 missing from the directory)');
    return;
  }

  const assignedBy = (managerUser && managerUser._id) || null;

  const mohidObjective = await Objective.create({
    employee: mohid._id,
    period,
    title: 'Deliver the payroll engine',
    description: 'Ship monthly payroll runs that match contracted pay, overtime and statutory deductions.',
    weight: 60,
    snapshot: snapshotOf(mohid),
    assignedBy,
  });
  await Objective.create({
    employee: mohid._id,
    period,
    title: 'Raise engineering quality',
    description: 'Keep review latency down and stop defects reaching production.',
    weight: 40,
    snapshot: snapshotOf(mohid),
    assignedBy,
  });

  await Kpi.create({
    employee: mohid._id,
    period,
    objective: mohidObjective._id,
    title: 'On-time payroll delivery',
    target: 'Every monthly run published by the 3rd working day',
    weight: 40,
    snapshot: snapshotOf(mohid),
    assignedBy,
  });
  await Kpi.create({
    employee: mohid._id,
    period,
    objective: mohidObjective._id,
    title: 'Payslip accuracy',
    target: 'Fewer than 2 correction tickets per month',
    weight: 30,
    snapshot: snapshotOf(mohid),
    assignedBy,
  });
  await Kpi.create({
    employee: mohid._id,
    period,
    title: 'Code review turnaround',
    target: 'P50 first review under 1 business day',
    weight: 30,
    snapshot: snapshotOf(mohid),
    assignedBy,
  });

  await Appraisal.create({
    employee: mohid._id,
    period,
    snapshot: snapshotOf(mohid),
    assignedBy,
    status: 'assigned',
  });

  const sofiaObjective = await Objective.create({
    employee: sofia._id,
    period,
    title: 'Ship the Q3 product surface',
    description: 'Launch the redesigned employee self-service pages and keep adoption moving.',
    weight: 100,
    snapshot: snapshotOf(sofia),
    assignedBy,
  });

  const sofiaKpis = await Kpi.create([
    {
      employee: sofia._id,
      period,
      objective: sofiaObjective._id,
      title: 'Feature adoption',
      target: '70% of active staff use self-service within 30 days',
      weight: 40,
      completion: 80,
      snapshot: snapshotOf(sofia),
      assignedBy,
    },
    {
      employee: sofia._id,
      period,
      objective: sofiaObjective._id,
      title: 'Interface defects',
      target: 'No Sev-1 bugs open at quarter end',
      weight: 35,
      completion: 90,
      snapshot: snapshotOf(sofia),
      assignedBy,
    },
    {
      employee: sofia._id,
      period,
      objective: sofiaObjective._id,
      title: 'Design review cadence',
      target: 'Weekly critique with Product, notes published same day',
      weight: 25,
      completion: 70,
      snapshot: snapshotOf(sofia),
      assignedBy,
    },
  ]);

  await Appraisal.create({
    employee: sofia._id,
    period,
    snapshot: snapshotOf(sofia),
    assignedBy,
    status: 'self_submitted',
    selfAssessmentScore: 4.1,
    selfAssessmentNotes:
      'The new self-service pages landed on schedule. Adoption is ahead of the 70% target; I would like another sprint to tidy the remaining accessibility gaps.',
    selfSubmittedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    kpiScores: [
      {
        kpi: sofiaKpis[0]._id,
        selfScore: 4,
        selfNotes: 'Adoption crossed 74% in the first three weeks after launch.',
        completion: 80,
      },
      {
        kpi: sofiaKpis[1]._id,
        selfScore: 5,
        selfNotes: 'No Sev-1 defects. Two Sev-2 items are already patched.',
        completion: 90,
      },
      {
        kpi: sofiaKpis[2]._id,
        selfScore: 3,
        selfNotes: 'Missed one critique while covering a product freeze. Notes still went out the next morning.',
        completion: 70,
      },
    ],
  });

  logger.info(`Created PMS plans for PH-1003 and PH-1004 (${period})`);
}

async function seedRecruitment() {
  if ((await Requisition.estimatedDocumentCount()) > 0) {
    logger.info('Skipped recruitment (requisitions already exist)');
    return;
  }

  await org.ensureOrganization();
  const daniel = await Employee.findOne({ employeeCode: 'PH-1002' });
  const hrUser = await User.findOne({ email: 'hr.admin@portohr.test' });
  const managerUser = await User.findOne({ email: 'manager@portohr.test' });
  if (!daniel || !hrUser || !managerUser) {
    logger.info('Skipped recruitment (directory users are incomplete)');
    return;
  }

  const team = await org.findOrCreateTeam('Engineering', 'Platform');
  const grade = await Grade.findOne({ code: 'M3' });
  const job = await org.findOrCreateJob('Backend Engineer');
  const designerJob = await org.findOrCreateJob('Product Designer');
  const designerGrade = (await Grade.findOne({ code: 'M4' })) || grade;

  const backendSeat = await org.createSeat({
    title: 'Backend Engineer',
    job: job._id,
    grade: grade && grade._id,
    team: team._id,
    orgRole: 'worker',
    location: 'Karachi HQ',
    status: 'vacant',
  });
  const designerSeat = await org.createSeat({
    title: 'Product Designer',
    job: designerJob._id,
    grade: designerGrade && designerGrade._id,
    team: team._id,
    orgRole: 'worker',
    location: 'Karachi HQ',
    status: 'vacant',
  });

  const openReq = await ats.createRequisition(
    {
      position: backendSeat._id,
      hiringManager: daniel._id,
      reason: 'Platform needs a backend engineer to own the payroll APIs and integrations.',
    },
    hrUser,
    daniel
  );

  const pendingReq = await ats.createRequisition(
    {
      position: designerSeat._id,
      hiringManager: daniel._id,
      reason: 'Product wants a dedicated designer for the self-service redesign.',
    },
    managerUser,
    daniel
  );

  const requisition = await Requisition.findById(openReq.id);
  const lina = await ats.findOrCreateCandidate({
    firstName: 'Lina',
    lastName: 'Qureshi',
    email: 'lina.qureshi@candidates.test',
    phone: '+92 300 555 0144',
    source: 'career_site',
    resumeUrl: 'https://resumes.portohr.test/lina-qureshi',
  });
  const omar = await ats.findOrCreateCandidate({
    firstName: 'Omar',
    lastName: 'Farooq',
    email: 'omar.farooq@candidates.test',
    phone: '+92 321 555 0198',
    source: 'referral',
  });

  const linaApp = await ats.applyToRequisition(requisition, lina, {
    source: 'career_site',
    coverNote: 'Six years in Node/Mongo payroll systems.',
  });
  await ats.applyToRequisition(requisition, omar, {
    source: 'referral',
    coverNote: 'Referred by the Platform team after a meetup talk.',
  });

  const linaDoc = await Application.findById(linaApp._id);
  await ats.addInterview(
    linaDoc,
    {
      interviewerName: 'Daniel Okafor',
      score: 4,
      notes: 'Strong systems thinking. Follow-up on event sourcing.',
      recommendation: 'advance',
    },
    managerUser
  );
  await ats.createOffer(await Application.findById(linaApp._id), requisition, {
    salary: 7200,
    startDate: '2026-10-01',
    letterBody: 'Offer for Backend Engineer, Platform team, starting 1 Oct 2026.',
  }, hrUser);

  logger.info(`Created recruitment sample (${openReq.code} open, ${pendingReq.code} pending HR, offer waiting on hiring manager)`);
}

async function seedLms() {
  if ((await Course.estimatedDocumentCount()) > 0) {
    logger.info('Skipped LMS (courses already exist)');
    return;
  }

  const mohid = await Employee.findOne({ employeeCode: 'PH-1003' });
  const sofia = await Employee.findOne({ employeeCode: 'PH-1004' });
  const daniel = await Employee.findOne({ employeeCode: 'PH-1002' });
  const hrUser = await User.findOne({ email: 'hr.admin@portohr.test' });
  const empUser = await User.findOne({ email: 'employee@portohr.test' });
  if (!mohid || !sofia || !daniel || !hrUser || !empUser) {
    logger.info('Skipped LMS (directory users are incomplete)');
    return;
  }

  await Competency.insertMany([
    { code: 'SEC', name: 'Information security', category: 'compliance' },
    { code: 'NODE', name: 'Node.js', category: 'engineering' },
    { code: 'LEAD', name: 'People leadership', category: 'management' },
    { code: 'PEOPLE', name: 'People operations', category: 'hr' },
  ]);

  const infosec = await Course.create({
    code: 'CRS-1001',
    title: 'Information Security Awareness',
    summary: 'Annual mandatory module covering phishing, device handling and data classification.',
    delivery: 'elearning',
    durationHours: 1,
    competencies: ['SEC'],
    mandatory: true,
    issuesCertificate: true,
    validityMonths: 12,
    url: 'https://learn.portohr.test/infosec',
    provider: 'PortoHR Academy',
    status: 'published',
  });
  const ones = await Course.create({
    code: 'CRS-1002',
    title: 'Effective 1:1s',
    summary: 'A half-day classroom on running useful 1:1s, feedback and development plans.',
    delivery: 'instructor_led',
    durationHours: 4,
    competencies: ['LEAD'],
    mandatory: false,
    issuesCertificate: false,
    provider: 'People Ops',
    status: 'published',
  });
  const nodejs = await Course.create({
    code: 'CRS-1003',
    title: 'Node.js Internals',
    summary: 'Event loop, streams and back-pressure for engineers shipping payroll jobs.',
    delivery: 'elearning',
    durationHours: 6,
    competencies: ['NODE'],
    mandatory: false,
    issuesCertificate: false,
    url: 'https://learn.portohr.test/node-internals',
    provider: 'Engineering Guild',
    status: 'published',
  });

  const session = await TrainingSession.create({
    course: ones._id,
    startsAt: new Date('2026-09-22T05:00:00.000Z'),
    endsAt: new Date('2026-09-22T09:00:00.000Z'),
    location: 'Karachi HQ',
    instructorName: 'Ayesha Rahman',
    capacity: 16,
    status: 'scheduled',
  });

  await Enrollment.create({
    employee: mohid._id,
    snapshot: snapshotOf(mohid),
    course: infosec._id,
    source: 'mandatory',
    status: 'enrolled',
    dueDate: new Date('2026-09-01'),
    submittedBy: hrUser._id,
    decidedBy: hrUser._id,
    decidedAt: new Date(),
  });
  await Enrollment.create({
    employee: mohid._id,
    snapshot: snapshotOf(mohid),
    course: nodejs._id,
    source: 'self',
    status: 'pending',
    submittedBy: empUser._id,
  });
  await Enrollment.create({
    employee: daniel._id,
    snapshot: snapshotOf(daniel),
    course: ones._id,
    session: session._id,
    source: 'hr',
    status: 'enrolled',
    submittedBy: hrUser._id,
    decidedBy: hrUser._id,
    decidedAt: new Date(),
  });

  const sofiaEnrollment = await Enrollment.create({
    employee: sofia._id,
    snapshot: snapshotOf(sofia),
    course: infosec._id,
    source: 'mandatory',
    status: 'completed',
    dueDate: new Date('2026-08-15'),
    completedAt: new Date('2025-10-15'),
    feedbackScore: 4,
    feedbackNote: 'Clear examples. Would like a short phishing drill next year.',
    submittedBy: hrUser._id,
    decidedBy: hrUser._id,
    decidedAt: new Date('2025-10-01'),
  });
  await CertificationRecord.create({
    employee: sofia._id,
    course: infosec._id,
    enrollment: sofiaEnrollment._id,
    title: 'Information Security Awareness certificate',
    issuedAt: new Date('2025-10-15'),
    expiresAt: new Date('2026-10-15'),
  });

  logger.info('Created LMS sample (mandatory InfoSec, pending Node.js request, 1:1s session, expiring certificate)');
}

async function seedBenefits() {
  if ((await BenefitPlan.estimatedDocumentCount()) > 0) {
    logger.info('Skipped benefits (plans already exist)');
    return;
  }

  const mohid = await Employee.findOne({ employeeCode: 'PH-1003' });
  const sofia = await Employee.findOne({ employeeCode: 'PH-1004' });
  const daniel = await Employee.findOne({ employeeCode: 'PH-1002' });
  const hrUser = await User.findOne({ email: 'hr.admin@portohr.test' });
  const empUser = await User.findOne({ email: 'employee@portohr.test' });
  if (!mohid || !sofia || !daniel || !hrUser || !empUser) {
    logger.info('Skipped benefits (directory users are incomplete)');
    return;
  }

  const medical = await BenefitPlan.create({
    code: 'PLN-1001',
    name: 'Group Medical',
    summary: 'OPD and hospitalization with the panel network. Family cover is available on the plus option.',
    category: 'medical',
    provider: 'Igi Life / Jubilee',
    currency: 'USD',
    status: 'published',
  });
  const life = await BenefitPlan.create({
    code: 'PLN-1002',
    name: 'Group Life',
    summary: 'Employer-paid core cover, with a voluntary 2x top-up.',
    category: 'life',
    provider: 'State Life',
    currency: 'USD',
    status: 'published',
  });
  const retire = await BenefitPlan.create({
    code: 'PLN-1003',
    name: 'Provident Fund',
    summary: 'Matched retirement contribution. Default for every confirmed grade.',
    category: 'retirement',
    provider: 'PortoHR Trustee',
    currency: 'USD',
    status: 'published',
  });
  const wellness = await BenefitPlan.create({
    code: 'PLN-1004',
    name: 'Wellness stipend',
    summary: 'Optional gym and wellbeing allowance. Not auto-enrolled.',
    category: 'wellness',
    provider: 'PortoHR',
    currency: 'USD',
    eligibleGrades: ['M3', 'M4', 'M5', 'M6'],
    status: 'published',
  });

  await PlanOption.create({
    plan: medical._id,
    code: 'MED-CORE',
    name: 'Employee only',
    employerAmount: 80,
    employeeAmount: 40,
    maxDependents: 0,
    isDefault: true,
  });
  const medicalFamily = await PlanOption.create({
    plan: medical._id,
    code: 'MED-FAM',
    name: 'Employee + family',
    employerAmount: 140,
    employeeAmount: 85,
    maxDependents: 4,
    isDefault: false,
  });
  await PlanOption.create({
    plan: life._id,
    code: 'LIFE-1X',
    name: '1× annual salary',
    employerAmount: 18,
    employeeAmount: 0,
    maxDependents: 0,
    isDefault: true,
  });
  const lifeTop = await PlanOption.create({
    plan: life._id,
    code: 'LIFE-2X',
    name: '2× annual salary',
    employerAmount: 18,
    employeeAmount: 22,
    maxDependents: 0,
    isDefault: false,
  });
  await PlanOption.create({
    plan: retire._id,
    code: 'PF-5',
    name: '5% matched',
    employerAmount: 200,
    employeeAmount: 200,
    maxDependents: 0,
    isDefault: true,
  });
  await PlanOption.create({
    plan: wellness._id,
    code: 'WELL-GYM',
    name: 'Gym stipend',
    employerAmount: 30,
    employeeAmount: 0,
    maxDependents: 0,
    isDefault: false,
  });

  await benefits.autoEnroll(mohid, hrUser._id);
  await benefits.autoEnroll(sofia, hrUser._id);
  await benefits.autoEnroll(daniel, hrUser._id);

  let spouse = sofia.person
    ? await FamilyMember.findOne({ person: sofia.person, relationship: 'spouse' })
    : null;
  if (sofia.person && !spouse) {
    spouse = await FamilyMember.create({
      person: sofia.person,
      name: 'Luca Marino',
      relationship: 'spouse',
      isEmergency: true,
      isDependent: true,
      benefitEligible: true,
      dateOfBirth: '1992-04-18',
    });
  }

  if (spouse) {
    const sofiaMedical = await BenefitEnrollment.findOne({ employee: sofia._id, plan: medical._id, status: 'active' });
    if (sofiaMedical) {
      sofiaMedical.status = 'ended';
      sofiaMedical.effectiveTo = new Date();
      await sofiaMedical.save();
    }
    await BenefitEnrollment.create({
      code: 'BEN-1101',
      employee: sofia._id,
      snapshot: snapshotOf(sofia),
      plan: medical._id,
      option: medicalFamily._id,
      dependents: [spouse._id],
      source: 'hr',
      currency: 'USD',
      employerAmount: medicalFamily.employerAmount,
      employeeAmount: medicalFamily.employeeAmount,
      status: 'active',
      replaces: sofiaMedical && sofiaMedical._id,
      submittedBy: hrUser._id,
      decidedBy: hrUser._id,
      decidedAt: new Date(),
    });
  }

  const mohidLife = await BenefitEnrollment.findOne({ employee: mohid._id, plan: life._id, status: 'active' });
  await BenefitEnrollment.create({
    code: 'BEN-1102',
    employee: mohid._id,
    snapshot: snapshotOf(mohid),
    plan: life._id,
    option: lifeTop._id,
    source: 'open_enrollment',
    reason: 'Want the 2× top-up while open enrollment is open.',
    currency: 'USD',
    employerAmount: lifeTop.employerAmount,
    employeeAmount: lifeTop.employeeAmount,
    status: 'pending',
    replaces: mohidLife && mohidLife._id,
    submittedBy: empUser._id,
  });

  logger.info('Created benefits sample (grade defaults, Sofia family medical, Mohid 2× life pending HR)');
}

async function seedCompliance() {
  if ((await ComplianceRule.estimatedDocumentCount()) > 0) {
    logger.info('Skipped compliance (rules already exist)');
    return;
  }

  const mohid = await Employee.findOne({ employeeCode: 'PH-1003' });
  const sofia = await Employee.findOne({ employeeCode: 'PH-1004' });
  const daniel = await Employee.findOne({ employeeCode: 'PH-1002' });
  const ethan = await Employee.findOne({ employeeCode: 'PH-1005' });
  const hrUser = await User.findOne({ email: 'hr.admin@portohr.test' });
  if (!mohid || !sofia || !daniel || !hrUser) {
    logger.info('Skipped compliance (directory users are incomplete)');
    return;
  }

  const eobi = await ComplianceRule.create({
    code: 'RUL-1001',
    name: 'EOBI monthly contribution',
    country: 'PK',
    category: 'pension',
    authority: 'EOBI',
    frequency: 'monthly',
    dueDay: 15,
    dueMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    summary: 'Employer contribution return for covered heads.',
    status: 'published',
  });
  const sessi = await ComplianceRule.create({
    code: 'RUL-1002',
    name: 'SESSI quarterly return',
    country: 'PK',
    category: 'social_security',
    authority: 'SESSI',
    frequency: 'quarterly',
    dueDay: 15,
    dueMonths: [1, 4, 7, 10],
    summary: 'Sindh Employees Social Security Institution quarterly filing.',
    status: 'published',
  });
  await ComplianceRule.create({
    code: 'RUL-1003',
    name: 'Income tax / NTN annual return',
    country: 'PK',
    category: 'tax',
    authority: 'FBR',
    frequency: 'annual',
    dueDay: 30,
    dueMonth: 9,
    dueMonths: [9],
    summary: 'Corporate income-tax return for the Pakistan legal entity.',
    status: 'published',
  });
  await ComplianceRule.create({
    code: 'RUL-1004',
    name: 'Annual labour inspection return',
    country: 'PK',
    category: 'labour',
    authority: 'Sindh Labour Department',
    frequency: 'annual',
    dueDay: 31,
    dueMonth: 12,
    dueMonths: [12],
    summary: 'Establishment labour return and inspection pack.',
    status: 'published',
  });

  await compliance.ensureFilings(2026);

  const cutoff = new Date(2026, 8, 1);
  const historic = await Filing.find({ dueOn: { $lt: cutoff } }).populate('rule');
  for (const row of historic) {
    row.status = 'filed';
    row.filedOn = row.dueOn;
    row.filedBy = hrUser._id;
    row.reference = `${row.rule.code}-${row.periodLabel}`.replace(/\s+/g, '');
    await row.save();
  }

  await License.create({
    code: 'LIC-1001',
    name: 'Sindh labour / establishment licence',
    kind: 'labour',
    scope: 'company',
    issuer: 'Sindh Labour Department',
    reference: 'SLD-KHI-44821',
    issuedOn: '2025-10-06',
    expiresOn: '2026-10-05',
    notes: 'Renew before the October inspection window.',
    status: 'active',
  });
  await License.create({
    code: 'LIC-1002',
    name: 'SECP certificate of incorporation',
    kind: 'company',
    scope: 'company',
    issuer: 'SECP',
    reference: '0071234',
    issuedOn: '2019-03-01',
    expiresOn: '2028-03-01',
    status: 'active',
  });
  if (ethan) {
    await License.create({
      code: 'LIC-1003',
      name: 'Work permit',
      kind: 'work_visa',
      scope: 'employee',
      employee: ethan._id,
      snapshot: snapshotOf(ethan),
      issuer: 'Ministry of Interior',
      reference: 'WP-2025-8812',
      issuedOn: '2025-09-29',
      expiresOn: '2026-09-28',
      status: 'active',
    });
  }

  const conduct = await PolicyDocument.create({
    code: 'POL-1001',
    title: 'Code of Conduct',
    summary: 'Expected behaviour, conflicts of interest and reporting channels.',
    body: 'Everyone at PortoHR acts with integrity, treats colleagues with respect, and raises concerns through HR rather than informal pressure. Gifts above a token value must be declared. Harassment of any kind is a disciplinary matter.',
    version: 1,
    status: 'published',
    requiresAck: true,
    dueWithinDays: 30,
    publishedAt: new Date('2026-09-01T00:00:00'),
    publishedBy: hrUser._id,
  });
  const infosec = await PolicyDocument.create({
    code: 'POL-1002',
    title: 'Information Security Policy',
    summary: 'Acceptable use, MFA and how to handle personal data.',
    body: 'Work accounts require MFA. Customer and employee personal data leaves the building only through approved systems. Report a suspected incident to IT within one hour.',
    version: 1,
    status: 'published',
    requiresAck: true,
    dueWithinDays: 21,
    publishedAt: new Date('2026-08-20T00:00:00'),
    publishedBy: hrUser._id,
  });

  await AcknowledgementLog.create({
    policy: conduct._id,
    employee: sofia._id,
    snapshot: snapshotOf(sofia),
    version: 1,
    acknowledgedAt: new Date('2026-09-03'),
  });
  await AcknowledgementLog.create({
    policy: conduct._id,
    employee: daniel._id,
    snapshot: snapshotOf(daniel),
    version: 1,
    acknowledgedAt: new Date('2026-09-02'),
  });
  await AcknowledgementLog.create({
    policy: infosec._id,
    employee: mohid._id,
    snapshot: snapshotOf(mohid),
    version: 1,
    acknowledgedAt: new Date('2026-08-22'),
  });
  await AcknowledgementLog.create({
    policy: infosec._id,
    employee: daniel._id,
    snapshot: snapshotOf(daniel),
    version: 1,
    acknowledgedAt: new Date('2026-08-21'),
  });

  await RetentionRule.create([
    { category: 'personnel', years: 7, action: 'archive', notes: 'Keep the personnel file through the statutory limitation period.' },
    { category: 'payroll', years: 10, action: 'archive', notes: 'FBR and EOBI inspection window.' },
    { category: 'attendance', years: 3, action: 'anonymize', notes: 'Drop badges after the labour-inspection window.' },
    { category: 'employee_relations', years: 7, action: 'archive' },
    { category: 'learning', years: 5, action: 'archive' },
  ]);

  logger.info('Created compliance sample (PK filings, labour licence, work permit, two policies)');
}

async function seedGrievance() {
  if ((await ErCase.estimatedDocumentCount()) > 0) {
    logger.info('Skipped grievance (cases already exist)');
    return;
  }

  const mohid = await Employee.findOne({ employeeCode: 'PH-1003' });
  const sofia = await Employee.findOne({ employeeCode: 'PH-1004' });
  const ethan = await Employee.findOne({ employeeCode: 'PH-1005' });
  const hrUser = await User.findOne({ email: 'hr.admin@portohr.test' });
  const empUser = await User.findOne({ email: 'employee@portohr.test' });
  if (!mohid || !sofia || !hrUser) {
    logger.info('Skipped grievance (directory users are incomplete)');
    return;
  }

  await ErCase.create({
    code: 'ER-1001',
    type: 'grievance',
    status: 'intake',
    summary: 'Night-shift coverage on the Platform team',
    description:
      'The last two rotations left only one engineer on the late window. I want a documented rota rather than informal cover.',
    department: mohid.department,
    subject: mohid._id,
    complainant: mohid._id,
    snapshot: snapshotOf(mohid),
    parties: [
      { employee: mohid._id, role: 'complainant', snapshot: snapshotOf(mohid) },
      { employee: mohid._id, role: 'subject', snapshot: snapshotOf(mohid) },
    ],
    submittedBy: (empUser || hrUser)._id,
    timeline: [
      {
        at: new Date('2026-09-11T09:00:00'),
        actorName: 'Mohid Khan',
        action: 'intake',
        note: 'Night-shift coverage on the Platform team',
        visibility: 'parties',
      },
    ],
  });

  if (ethan) {
    await ErCase.create({
      code: 'ER-1002',
      type: 'disciplinary',
      status: 'hearing',
      summary: 'Probation attendance shortfalls',
      description: 'Repeated short days during probation without a prior leave request.',
      department: ethan.department,
      subject: ethan._id,
      complainant: null,
      snapshot: snapshotOf(ethan),
      parties: [{ employee: ethan._id, role: 'subject', snapshot: snapshotOf(ethan) }],
      submittedBy: hrUser._id,
      hearing: { scheduledOn: new Date('2026-09-18T10:00:00'), location: 'Karachi HQ · Room 4', outcome: '' },
      investigationNotes: [
        {
          at: new Date('2026-09-08T11:00:00'),
          authorName: 'Ayesha Rahman',
          body: 'Time log shows four short days in August. Manager asked for a written explanation; none received.',
        },
      ],
      documents: [
        {
          title: 'August attendance extract',
          url: 'https://files.portohr.test/er/ER-1002-attendance',
          classification: 'restricted',
          addedAt: new Date('2026-09-08'),
        },
      ],
      timeline: [
        {
          at: new Date('2026-09-05T09:00:00'),
          actorName: 'Ayesha Rahman',
          action: 'intake',
          note: 'HR-raised disciplinary during probation.',
          visibility: 'parties',
        },
        {
          at: new Date('2026-09-05T09:30:00'),
          actorName: 'Ayesha Rahman',
          action: 'triaged',
          note: 'Opened investigation.',
          visibility: 'parties',
        },
        {
          at: new Date('2026-09-08T11:00:00'),
          actorName: 'Ayesha Rahman',
          action: 'investigation_updated',
          note: '',
          visibility: 'hr',
        },
        {
          at: new Date('2026-09-09T16:00:00'),
          actorName: 'Ayesha Rahman',
          action: 'hearing_scheduled',
          note: 'Karachi HQ · Room 4',
          visibility: 'parties',
        },
      ],
    });
  }

  await ErCase.create({
    code: 'ER-1003',
    type: 'grievance',
    status: 'closed',
    summary: 'Desk allocation after the Product move',
    description: 'Asked for a quiet desk after the floor move. Facilities resolved it the same week.',
    department: sofia.department,
    subject: sofia._id,
    complainant: sofia._id,
    snapshot: snapshotOf(sofia),
    parties: [
      { employee: sofia._id, role: 'complainant', snapshot: snapshotOf(sofia) },
      { employee: sofia._id, role: 'subject', snapshot: snapshotOf(sofia) },
    ],
    submittedBy: hrUser._id,
    decision: {
      outcome: 'informal_resolution',
      actionType: 'none',
      note: 'Facilities assigned a quieter bay. No disciplinary action.',
      coreHrNote: '',
      decidedAt: new Date('2026-08-20'),
      decidedBy: hrUser._id,
    },
    closedAt: new Date('2026-08-21'),
    timeline: [
      {
        at: new Date('2026-08-18'),
        actorName: 'Sofia Marino',
        action: 'intake',
        note: 'Desk allocation after the Product move',
        visibility: 'parties',
      },
      {
        at: new Date('2026-08-19'),
        actorName: 'Ayesha Rahman',
        action: 'triaged',
        note: 'Facilities copied.',
        visibility: 'parties',
      },
      {
        at: new Date('2026-08-20'),
        actorName: 'Ayesha Rahman',
        action: 'decision',
        note: 'Informal resolution: quieter bay assigned.',
        visibility: 'parties',
      },
      {
        at: new Date('2026-08-21'),
        actorName: 'Ayesha Rahman',
        action: 'closed',
        note: '',
        visibility: 'parties',
      },
    ],
  });

  logger.info('Created ER sample (Mohid intake, Ethan hearing, Sofia closed)');
}

async function seedAssets() {
  if ((await Asset.estimatedDocumentCount()) > 0) {
    logger.info('Skipped assets (register already exists)');
    return;
  }

  const ayesha = await Employee.findOne({ employeeCode: 'PH-1001' });
  const daniel = await Employee.findOne({ employeeCode: 'PH-1002' });
  const mohid = await Employee.findOne({ employeeCode: 'PH-1003' });
  const sofia = await Employee.findOne({ employeeCode: 'PH-1004' });
  const ethan = await Employee.findOne({ employeeCode: 'PH-1005' });
  const lukas = await Employee.findOne({ employeeCode: 'PH-1007' });
  const amara = await Employee.findOne({ employeeCode: 'PH-1008' });
  const hrUser = await User.findOne({ email: 'hr.admin@portohr.test' });
  if (!mohid || !ayesha || !hrUser) {
    logger.info('Skipped assets (directory users are incomplete)');
    return;
  }

  if (lukas && !lukas.lastWorkingDay) {
    lukas.lastWorkingDay = new Date(2026, 8, 30);
    await lukas.save();
  }

  const catalogue = await Asset.create([
    {
      code: 'AST-1001',
      name: 'MacBook Pro 14',
      category: 'it',
      status: 'issued',
      serial: 'C02-MOHID',
      barcode: 'MB-1003',
      location: 'Karachi HQ',
      purchaseDate: new Date(2024, 2, 12),
      purchaseValue: 2400,
      residualValue: 400,
      usefulLifeMonths: 36,
      currency: 'USD',
    },
    {
      code: 'AST-1002',
      name: 'MacBook Pro 14',
      category: 'it',
      status: 'issued',
      serial: 'C02-DANIEL',
      barcode: 'MB-1002',
      location: 'Karachi HQ',
      purchaseDate: new Date(2023, 10, 4),
      purchaseValue: 2400,
      residualValue: 400,
      usefulLifeMonths: 36,
    },
    {
      code: 'AST-1003',
      name: 'MacBook Air 13',
      category: 'it',
      status: 'issued',
      serial: 'C02-SOFIA',
      barcode: 'MB-1004',
      location: 'Karachi HQ',
      purchaseDate: new Date(2024, 5, 1),
      purchaseValue: 1600,
      residualValue: 250,
      usefulLifeMonths: 36,
      currency: 'EUR',
    },
    {
      code: 'AST-1004',
      name: 'ThinkPad T14',
      category: 'it',
      status: 'issued',
      serial: 'TP-LUKAS',
      barcode: 'NB-1007',
      location: 'EMEA',
      purchaseDate: new Date(2023, 1, 8),
      purchaseValue: 1400,
      residualValue: 200,
      usefulLifeMonths: 36,
      currency: 'EUR',
    },
    {
      code: 'AST-1005',
      name: 'Access card',
      category: 'access_card',
      status: 'issued',
      barcode: 'AC-1007',
      location: 'Karachi HQ',
      purchaseDate: new Date(2022, 7, 1),
      purchaseValue: 15,
      residualValue: 0,
      usefulLifeMonths: 24,
    },
    {
      code: 'AST-1006',
      name: 'Toyota Corolla — sales pool',
      category: 'vehicle',
      status: 'issued',
      serial: 'KHI-4421',
      barcode: 'VH-1007',
      location: 'Karachi HQ',
      purchaseDate: new Date(2021, 3, 15),
      purchaseValue: 18000,
      residualValue: 4000,
      usefulLifeMonths: 60,
    },
    {
      code: 'AST-1007',
      name: 'Employee ID card',
      category: 'id_card',
      status: 'issued',
      barcode: 'ID-1003',
      location: 'Karachi HQ',
      purchaseDate: new Date(2022, 0, 17),
      purchaseValue: 8,
      residualValue: 0,
      usefulLifeMonths: 24,
    },
    {
      code: 'AST-1008',
      name: 'USB headset',
      category: 'it',
      status: 'available',
      barcode: 'HS-2001',
      location: 'Karachi stores',
      purchaseDate: new Date(2025, 10, 2),
      purchaseValue: 90,
      residualValue: 10,
      usefulLifeMonths: 24,
    },
    {
      code: 'AST-1009',
      name: 'Spare MacBook Air',
      category: 'it',
      status: 'available',
      barcode: 'MB-2099',
      location: 'Karachi stores',
      purchaseDate: new Date(2025, 6, 20),
      purchaseValue: 1500,
      residualValue: 250,
      usefulLifeMonths: 36,
    },
    {
      code: 'AST-1010',
      name: 'Facilities uniform set',
      category: 'uniform',
      status: 'issued',
      barcode: 'UN-1008',
      location: 'Karachi HQ',
      purchaseDate: new Date(2024, 1, 19),
      purchaseValue: 60,
      residualValue: 0,
      usefulLifeMonths: 18,
    },
    {
      code: 'AST-1011',
      name: 'Employee ID card',
      category: 'id_card',
      status: 'issued',
      barcode: 'ID-1005',
      location: 'Karachi HQ',
      purchaseDate: new Date(2025, 10, 3),
      purchaseValue: 8,
      residualValue: 0,
      usefulLifeMonths: 24,
    },
  ]);

  const byCode = {};
  catalogue.forEach((row) => {
    byCode[row.code] = row;
  });

  function assignment(assetCode, employee, status, extra) {
    return Object.assign(
      {
        asset: byCode[assetCode]._id,
        employee: employee._id,
        position: employee.currentPosition || null,
        snapshot: snapshotOf(employee),
        status,
        conditionOut: 'good',
        issuedBy: hrUser._id,
      },
      extra
    );
  }

  await AssetAssignment.create([
    assignment('AST-1001', mohid, 'acknowledged', {
      issuedOn: new Date(2024, 2, 18),
      acknowledgedOn: new Date(2024, 2, 19),
      note: 'Standard engineering kit.',
    }),
    assignment('AST-1002', daniel, 'acknowledged', {
      issuedOn: new Date(2023, 10, 10),
      acknowledgedOn: new Date(2023, 10, 10),
    }),
    assignment('AST-1003', sofia, 'acknowledged', {
      issuedOn: new Date(2024, 5, 4),
      acknowledgedOn: new Date(2024, 5, 5),
    }),
    assignment('AST-1007', mohid, 'acknowledged', {
      issuedOn: new Date(2022, 0, 17),
      acknowledgedOn: new Date(2022, 0, 17),
    }),
    assignment('AST-1008', mohid, 'requested', {
      issuedBy: null,
      note: 'Need a quieter mic for support calls.',
    }),
    assignment('AST-1010', amara || ayesha, 'acknowledged', {
      issuedOn: new Date(2024, 1, 20),
      acknowledgedOn: new Date(2024, 1, 20),
    }),
    assignment('AST-1011', ethan || ayesha, 'issued', {
      issuedOn: new Date(2025, 10, 4),
      note: 'Awaiting Day-1 acknowledgement.',
    }),
  ]);

  if (lukas) {
    await AssetAssignment.create([
      assignment('AST-1004', lukas, 'recovery', {
        issuedOn: new Date(2023, 1, 12),
        acknowledgedOn: new Date(2023, 1, 12),
        recoveryQueuedOn: new Date(2026, 8, 1),
        dueOn: new Date(2026, 8, 30),
        note: 'Queued for recovery — notice period.',
      }),
      assignment('AST-1005', lukas, 'recovery', {
        issuedOn: new Date(2022, 7, 4),
        acknowledgedOn: new Date(2022, 7, 4),
        recoveryQueuedOn: new Date(2026, 8, 1),
        dueOn: new Date(2026, 8, 30),
      }),
      assignment('AST-1006', lukas, 'recovery', {
        issuedOn: new Date(2023, 4, 2),
        acknowledgedOn: new Date(2023, 4, 3),
        recoveryQueuedOn: new Date(2026, 8, 1),
        dueOn: new Date(2026, 8, 30),
        conditionOut: 'fair',
        note: 'Sales pool car. Log the mileage on return.',
      }),
    ]);
  }

  await TransportRoute.create({
    code: 'TR-01',
    name: 'Clifton shuttle',
    origin: 'Clifton Block 5',
    destination: 'Karachi HQ',
    departsAt: '08:15',
    capacity: 12,
    vehicleLabel: 'Coaster 1',
    allocations: [
      {
        employee: mohid._id,
        snapshot: snapshotOf(mohid),
        status: 'allocated',
        seat: 'A4',
        effectiveFrom: new Date(2025, 0, 6),
      },
      sofia
        ? {
            employee: sofia._id,
            snapshot: snapshotOf(sofia),
            status: 'allocated',
            seat: 'A5',
            effectiveFrom: new Date(2025, 0, 6),
          }
        : null,
    ].filter(Boolean),
  });

  await TransportRoute.create({
    code: 'TR-02',
    name: 'Defence loop',
    origin: 'DHA Phase 5',
    destination: 'Karachi HQ',
    departsAt: '08:40',
    capacity: 8,
    vehicleLabel: 'Hiace 2',
    allocations: lukas
      ? [
          {
            employee: lukas._id,
            snapshot: snapshotOf(lukas),
            status: 'allocated',
            seat: 'B1',
            effectiveFrom: new Date(2024, 8, 2),
          },
        ]
      : [],
  });

  if (lukas) {
    await AccommodationAllocation.create({
      employee: lukas._id,
      snapshot: snapshotOf(lukas),
      site: 'Staff hostel — Block B',
      room: '12',
      bed: 'A',
      status: 'allocated',
      checkInOn: new Date(2024, 8, 1),
      monthlyCharge: 250,
      currency: 'EUR',
      note: 'Vacate by last working day.',
    });
  }

  await MaintenanceLog.create({
    asset: byCode['AST-1001']._id,
    requestedBy: mohid._id,
    requesterName: mohid.fullName,
    kind: 'repair',
    status: 'scheduled',
    summary: 'Battery swelling — swap under warranty',
    notes: 'Apple authorised service, pickup from HQ stores.',
    vendor: 'CompuHouse',
    scheduledOn: new Date(2026, 8, 20),
  });

  await MaintenanceLog.create({
    asset: byCode['AST-1006']._id,
    requestedBy: lukas ? lukas._id : null,
    requesterName: lukas ? lukas.fullName : 'Facilities',
    kind: 'service',
    status: 'done',
    summary: 'Quarterly service and tyre rotation',
    vendor: 'Toyota Clifton',
    cost: 180,
    scheduledOn: new Date(2026, 7, 12),
    completedOn: new Date(2026, 7, 14),
  });

  logger.info('Created assets sample (Mohid kit + pending headset, Lukas recovery checklist)');
}

async function seedAnalytics() {
  await analytics.ensureCatalogue();
  if ((await KPISnapshot.estimatedDocumentCount()) > 0) {
    logger.info('Skipped analytics snapshots (already exist)');
    return;
  }
  const hrUser = await User.findOne({ email: 'hr.admin@portohr.test' });
  await KPISnapshot.create({
    asOf: new Date(2026, 8, 1),
    scope: 'company',
    label: 'September open',
    metrics: { headcount: 8, vacancies: 1, pending: 4, expiring: 2, filings: 2, er: 2, recovery: 0 },
    generatedBy: hrUser && hrUser._id,
    generatedByName: 'Ayesha Rahman',
  });
  logger.info('Created analytics catalogue and a September KPI snapshot');
}

async function seedAdmin() {
  await admin.ensureDefaults();
  if ((await Delegation.estimatedDocumentCount()) > 0) {
    logger.info('Skipped admin delegations (already exist)');
    return;
  }
  const daniel = await Employee.findOne({ employeeCode: 'PH-1002' });
  const mohid = await Employee.findOne({ employeeCode: 'PH-1003' });
  const hrUser = await User.findOne({ email: 'hr.admin@portohr.test' });
  if (!daniel || !mohid || !hrUser) {
    logger.warn('Skipped admin delegation (Daniel, Mohid or HR login missing)');
    return;
  }
  await admin.createDelegation(hrUser, {
    grantor: String(daniel._id),
    delegate: String(mohid._id),
    fromOn: '2026-09-01',
    toOn: '2026-09-30',
    note: 'Cover Engineering approvals while Daniel is travelling.',
  });
  logger.info('Created admin catalogue and Daniel → Mohid delegation for September');
}

const SEED_SIGNATURE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function seedEsign() {
  await RolePermission.updateMany({}, { $addToSet: { modules: 'esign' } });
  await admin.ensureDefaults();

  if ((await SignaturePack.estimatedDocumentCount()) > 0) {
    logger.info('Skipped e-sign packs (already exist)');
    return;
  }

  const mohid = await Employee.findOne({ employeeCode: 'PH-1003' });
  const hrUser = await User.findOne({ email: 'hr.admin@portohr.test' });
  const employeeUser = await User.findOne({ email: 'employee@portohr.test' });
  if (!mohid || !hrUser || !employeeUser) {
    logger.warn('Skipped e-sign (Mohid or logins missing)');
    return;
  }

  const policy = await esign.send(hrUser, {
    employee: String(mohid._id),
    kind: 'policy',
    title: 'Code of Conduct — signature',
    body:
      'I confirm that I have read the PortoHR Code of Conduct (version 2026.1) and will follow it in my work.\n\nThis signature is evidence of acknowledgement. It does not change my Core HR record, compensation or payroll.',
    dueOn: '2026-09-05',
  });
  await esign.sign(
    employeeUser,
    mohid,
    policy.id,
    {
      typedName: 'Mohid Khan',
      signatureImage: SEED_SIGNATURE_PNG,
      strokeCount: 4,
      declare: true,
    },
    { ip: '127.0.0.1', userAgent: 'portohr-seed' }
  );

  await esign.send(hrUser, {
    employee: String(mohid._id),
    kind: 'contract',
    title: 'Contract addendum — basic salary from 1 July 2026',
    body:
      'This addendum records that Mohid Khan (PH-1003), Software Engineer, should have been paid a basic salary of USD 8,000 from 1 July 2026.\n\nThe July 2026 payslip stays as it was paid. Any difference is settled as arrears, not by rewriting the closed slip.\n\nSigning this letter is consent to the addendum. It does not itself change Core HR compensation or generate payroll.',
    dueOn: '2026-09-20',
  });

  logger.info('Created Mohid e-sign packs (Code of Conduct signed, July addendum awaiting)');
}

async function run(options = {}) {
  await connectDatabase();

  for (const data of seedUsers) {
    const existing = await User.findOne({ email: data.email });
    if (existing) {
      logger.info(`Skipped ${data.email} (already exists)`);
      continue;
    }
    // Created one at a time so the pre-save hook hashes each password.
    await User.create(data);
    logger.info(`Created ${data.role.padEnd(8)} ${data.email}`);
  }

  const manager = await User.findOne({ role: ROLES.MANAGER });
  if (manager) {
    await User.updateMany(
      { role: ROLES.EMPLOYEE, reportsTo: null },
      { $set: { reportsTo: manager._id } }
    );
  }

  await seedDirectory();
  await seedWorkforce();
  await seedPersonnelFile();
  await seedAttendance();
  await seedLeave();
  await seedPayroll();
  await seedArrears();
  await seedFinanceRequests();
  await seedPms();
  await seedRecruitment();
  await seedLms();
  await seedBenefits();
  await seedCompliance();
  await seedGrievance();
  await seedAssets();
  await seedAnalytics();
  await seedAdmin();
  await seedEsign();

  logger.info('Seed complete. Default password for all accounts: Portohr@123');
  if (!options.keepOpen) await disconnectDatabase();
}

// Only self-runs as a script, so the seed can also be imported and driven
// directly — by a test, or by another script that needs demo data.
if (require.main === module) {
  run().catch(async (err) => {
    logger.error('Seed failed:', err.message);
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  });
}

module.exports = { run };
