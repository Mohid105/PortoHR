'use strict';

const Employee = require('../models/Employee');
const Assignment = require('../models/Assignment');
const LeaveRequest = require('../models/LeaveRequest');
const BankAccount = require('../models/BankAccount');
const EmployeeDocument = require('../models/EmployeeDocument');
const Requisition = require('../models/Requisition');
const Offer = require('../models/Offer');
const Loan = require('../models/Loan');
const CompensationRequest = require('../models/CompensationRequest');
const Payslip = require('../models/Payslip');
const Filing = require('../models/Filing');
const License = require('../models/License');
const CertificationRecord = require('../models/CertificationRecord');
const ErCase = require('../models/ErCase');
const AssetAssignment = require('../models/AssetAssignment');
const Attendance = require('../models/Attendance');
const ArrearsAdjustment = require('../models/ArrearsAdjustment');
const { monthRange } = require('./attendance.service');
const ReportDefinition = require('../models/ReportDefinition');
const KPISnapshot = require('../models/KPISnapshot');
const ExportLog = require('../models/ExportLog');
const ApiError = require('../utils/ApiError');
const { ROLES } = require('../config/roles');
const { REPORTS, ADHOC_GROUP_BY } = require('../config/analytics');
const { toMajor } = require('../utils/money');
const org = require('./org.service');

const ACTIVE = ['confirmed', 'probation', 'notice_period'];
const OPEN_ER = ['intake', 'investigation', 'hearing', 'decision', 'appeal'];
const PENDING = 'pending';

function isoDay(value) {
  if (!value) return '';
  const day = new Date(value);
  const y = day.getFullYear();
  const m = String(day.getMonth() + 1).padStart(2, '0');
  const d = String(day.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const day = new Date(value);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate());
}

function actorName(user) {
  if (!user) return '';
  return `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || 'User';
}

function asId(value) {
  return String((value && (value._id || value.id || value)) || '');
}

function personName(row) {
  if (!row) return '';
  if (row.fullName) return row.fullName;
  return `${row.firstName || ''} ${row.lastName || ''}`.trim();
}

function employedOn(employee, asOf) {
  const join = dateOnly(employee.dateOfJoining);
  if (!join || join > asOf) return false;
  const left = employee.lastWorkingDay ? dateOnly(employee.lastWorkingDay) : null;
  if (left && left < asOf) return false;
  if (['resigned', 'terminated'].indexOf(employee.employmentStatus) !== -1 && !left) return false;
  return true;
}

function employeeFilter(ids) {
  if (ids === null) return {};
  if (!ids.length) return { _id: null };
  return { _id: { $in: ids } };
}

function scopedEmployeeField(ids) {
  if (ids === null) return {};
  if (!ids.length) return { employee: null };
  return { employee: { $in: ids } };
}

function canRun(user, report) {
  if (!report) return false;
  if (user.role === ROLES.HR_ADMIN) return true;
  return report.visibility !== 'hr';
}

function definitionFor(code) {
  return REPORTS.filter((row) => row.code === code)[0] || null;
}

function countBy(rows, keyFn) {
  const map = {};
  rows.forEach((row) => {
    const key = keyFn(row) || '—';
    map[key] = (map[key] || 0) + 1;
  });
  return Object.keys(map)
    .sort()
    .map((key) => ({ key, count: map[key] }));
}

async function loadPeople(ids) {
  return Employee.find(employeeFilter(ids))
    .select('firstName lastName employeeCode designation department team location employmentStatus dateOfJoining lastWorkingDay phone compensation currentPosition reportsTo')
    .sort({ lastName: 1, firstName: 1 });
}

async function overview(user, ids) {
  const asOf = dateOnly(new Date());
  const people = (await loadPeople(ids)).filter((row) => employedOn(row, asOf));
  const scope = scopedEmployeeField(ids);

  const [
    pendingLeave,
    pendingAssign,
    pendingBank,
    pendingLoans,
    pendingClaims,
    pendingOffers,
    openReqs,
    teams,
    latestSlip,
    overdueFilings,
    openCases,
    recovery,
    expiringDocs,
  ] = await Promise.all([
    LeaveRequest.countDocuments(Object.assign({}, scope, { status: PENDING })),
    Assignment.countDocuments(Object.assign({}, scope, { status: PENDING })),
    BankAccount.countDocuments(Object.assign({}, scope, { status: PENDING })),
    Loan.countDocuments(Object.assign({}, scope, { status: PENDING })),
    CompensationRequest.countDocuments(Object.assign({}, scope, { status: PENDING })),
    Offer.countDocuments(Object.assign({}, scope, { status: PENDING })),
    Requisition.countDocuments({ status: { $in: ['pending', 'open'] } }),
    user.role === ROLES.HR_ADMIN ? org.headcountByTeam() : Promise.resolve([]),
    Payslip.findOne(scope).sort({ month: -1 }).select('month'),
    user.role === ROLES.HR_ADMIN ? Filing.countDocuments({ status: { $in: ['due', 'overdue'] } }) : Promise.resolve(0),
    user.role === ROLES.HR_ADMIN ? ErCase.countDocuments({ status: { $in: OPEN_ER } }) : Promise.resolve(0),
    user.role === ROLES.HR_ADMIN ? AssetAssignment.countDocuments({ status: 'recovery' }) : Promise.resolve(0),
    EmployeeDocument.countDocuments(
      Object.assign({}, scope, {
        expiresOn: { $ne: null, $gte: asOf, $lte: new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate() + 30) },
      })
    ),
  ]);

  const vacant = teams.reduce((sum, row) => sum + (row.vacant || 0), 0);
  const pending =
    pendingLeave + pendingAssign + pendingBank + pendingLoans + pendingClaims + pendingOffers;
  const byDepartment = countBy(people, (row) => row.department);
  const byStatus = countBy(people, (row) => row.employmentStatus);

  const trendSource = await Employee.find(employeeFilter(ids)).select(
    'dateOfJoining lastWorkingDay employmentStatus'
  );
  const trend = [];
  for (let back = 5; back >= 0; back -= 1) {
    const end = new Date(asOf.getFullYear(), asOf.getMonth() - back + 1, 0);
    trend.push({
      month: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`,
      headcount: trendSource.filter((row) => employedOn(row, end)).length,
    });
  }

  const onNotice = people.filter((row) => row.employmentStatus === 'notice_period').length;
  const tiles = [
    { key: 'headcount', label: 'Headcount', value: people.length, href: 'headcount', hint: isoDay(asOf) },
    { key: 'pending', label: 'Unapproved requests', value: pending, href: 'quality', hint: 'Across your scope' },
    { key: 'expiring', label: 'Expiring in 30 days', value: expiringDocs, href: 'quality', hint: 'Personnel documents' },
    { key: 'outlook', label: 'On notice', value: onNotice, href: 'outlook', hint: 'Rule-based outlook' },
  ];

  if (user.role === ROLES.HR_ADMIN) {
    tiles.splice(1, 0, {
      key: 'vacancies',
      label: 'Vacant FTE',
      value: vacant,
      href: 'reports',
      hint: 'Approved seats still empty',
    });
    tiles.push(
      { key: 'requisitions', label: 'Open requisitions', value: openReqs, href: 'reports', hint: 'Pending or open' },
      { key: 'payroll', label: 'Latest payroll', value: latestSlip ? latestSlip.month : '—', href: 'reports', hint: 'Coverage report' },
      { key: 'filings', label: 'Filings due', value: overdueFilings, href: 'quality', hint: 'Due or overdue' },
      { key: 'er', label: 'Open ER cases', value: openCases, href: 'reports', hint: 'Counts only' },
      { key: 'recovery', label: 'Assets to recover', value: recovery, href: 'quality', hint: 'Separation checklist' }
    );
  }

  const payroll =
    user.role === ROLES.HR_ADMIN
      ? await payrollSummary(ids)
      : null;

  return {
    asOf: isoDay(asOf),
    scope: user.role === ROLES.HR_ADMIN ? 'company' : user.role === ROLES.MANAGER ? 'team' : 'self',
    tiles,
    byDepartment,
    byStatus,
    trend,
    payroll,
    pendingBreakdown: [
      { key: 'leave', count: pendingLeave },
      { key: 'assignment', count: pendingAssign },
      { key: 'bank', count: pendingBank },
      { key: 'loan', count: pendingLoans },
      { key: 'claim', count: pendingClaims },
      { key: 'offer', count: pendingOffers },
    ].filter((row) => row.count),
  };
}

async function payrollSummary(ids) {
  const latest = await Payslip.findOne(scopedEmployeeField(ids)).sort({ month: -1 }).select('month');
  if (!latest) return { month: '', slips: 0, headcount: 0, net: null };
  const month = latest.month;
  const slips = await Payslip.find(Object.assign({}, scopedEmployeeField(ids), { month }));
  const asOf = dateOnly(new Date());
  const people = (await loadPeople(ids)).filter((row) => employedOn(row, asOf) && ACTIVE.indexOf(row.employmentStatus) !== -1);
  const net = slips.reduce((sum, row) => sum + (row.netPay || 0), 0);
  return {
    month,
    slips: slips.length,
    headcount: people.length,
    net: toMajor(net),
    currency: (slips[0] && slips[0].currency) || 'USD',
  };
}

async function headcount(user, ids, query = {}) {
  const asOf = dateOnly(query.asOf) || dateOnly(new Date());
  const people = (await loadPeople(ids)).filter((row) => employedOn(row, asOf));
  const finance = user.role === ROLES.HR_ADMIN;
  let payrollCost = 0;
  if (finance) {
    people.forEach((row) => {
      const base = (row.compensation && row.compensation.baseSalary) || 0;
      const allowances = ((row.compensation && row.compensation.fixedAllowances) || []).reduce(
        (sum, item) => sum + (item.amount || 0),
        0
      );
      payrollCost += base + allowances;
    });
  }

  const from = dateOnly(query.from) || new Date(asOf.getFullYear(), asOf.getMonth() - 2, 1);
  const to = dateOnly(query.to) || asOf;
  const all = await loadPeople(ids);
  const hires = all.filter((row) => {
    const day = dateOnly(row.dateOfJoining);
    return day && day >= from && day <= to;
  });
  const exits = all.filter((row) => {
    const day = dateOnly(row.lastWorkingDay);
    return day && day >= from && day <= to;
  });
  const moves = await Assignment.find(
    Object.assign({}, scopedEmployeeField(ids), {
      event: { $in: ['transfer', 'promotion', 'demotion'] },
      status: { $in: ['active', 'superseded'] },
      effectiveFrom: { $gte: from, $lte: to },
    })
  )
    .select('event designation department snapshot employee effectiveFrom')
    .limit(80);

  return {
    asOf: isoDay(asOf),
    from: isoDay(from),
    to: isoDay(to),
    total: people.length,
    payrollCost: finance ? Math.round(payrollCost) : null,
    byDepartment: countBy(people, (row) => row.department),
    byStatus: countBy(people, (row) => row.employmentStatus),
    byLocation: countBy(people, (row) => row.location || 'Unspecified'),
    hires: hires.map((row) => ({
      id: asId(row),
      fullName: personName(row),
      employeeCode: row.employeeCode,
      department: row.department,
      joinedOn: isoDay(row.dateOfJoining),
    })),
    exits: exits.map((row) => ({
      id: asId(row),
      fullName: personName(row),
      employeeCode: row.employeeCode,
      department: row.department,
      lastWorkingDay: isoDay(row.lastWorkingDay),
    })),
    transfers: moves.map((row) => ({
      event: row.event,
      designation: row.designation,
      department: row.department,
      effectiveFrom: isoDay(row.effectiveFrom),
    })),
  };
}

function previousMonthKey(asOf) {
  const date = new Date(asOf.getFullYear(), asOf.getMonth() - 1, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function tenureDays(employee, asOf) {
  const join = dateOnly(employee.dateOfJoining);
  if (!join) return 0;
  return Math.max(0, Math.round((asOf.getTime() - join.getTime()) / 86400000));
}

function bandFor(score) {
  if (score >= 40) return 'attention';
  if (score >= 20) return 'watch';
  return 'stable';
}

async function overtimeByEmployee(ids, month) {
  const range = monthRange(month);
  if (!range) return {};
  const match = { date: { $gte: range.start, $lt: range.end } };
  if (ids !== null) match.employee = { $in: ids };
  const rows = await Attendance.aggregate([
    { $match: match },
    { $group: { _id: '$employee', overtimeHours: { $sum: '$overtimeHours' } } },
  ]);
  const map = {};
  rows.forEach((row) => {
    map[String(row._id)] = Math.round((row.overtimeHours || 0) * 10) / 10;
  });
  return map;
}

async function outlook(user, ids) {
  const asOf = dateOnly(new Date());
  const people = (await loadPeople(ids)).filter((row) => employedOn(row, asOf) && ACTIVE.indexOf(row.employmentStatus) !== -1);
  const scope = scopedEmployeeField(ids);
  const month = previousMonthKey(asOf);
  const horizon = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate() + 30);

  const [overtime, expiringDocs, teams, openReqs, arrearsOpen] = await Promise.all([
    overtimeByEmployee(ids, month),
    EmployeeDocument.find(
      Object.assign({}, scope, { expiresOn: { $ne: null, $gte: asOf, $lte: horizon } })
    ).select('employee'),
    user.role === ROLES.HR_ADMIN ? org.headcountByTeam() : Promise.resolve([]),
    user.role === ROLES.HR_ADMIN
      ? Requisition.find({ status: { $in: ['pending', 'open'] } }).select('openings status')
      : Promise.resolve([]),
    user.role === ROLES.HR_ADMIN
      ? ArrearsAdjustment.countDocuments({ status: { $in: ['simulated', 'posted'] } })
      : Promise.resolve(0),
  ]);

  const expiringSet = new Set(expiringDocs.map((row) => String(row.employee)));
  const watch = [];
  people.forEach((row) => {
    const reasons = [];
    let score = 0;
    if (row.employmentStatus === 'notice_period') {
      score += 45;
      reasons.push('On notice period');
    }
    if (row.lastWorkingDay) {
      const left = dateOnly(row.lastWorkingDay);
      if (left && left >= asOf && left <= horizon) {
        score += 40;
        reasons.push(`Last working day ${isoDay(left)}`);
      }
    }
    if (row.employmentStatus === 'probation' && tenureDays(row, asOf) < 120) {
      score += 18;
      reasons.push('On probation (under 120 days)');
    }
    if (!row.reportsTo && (row.employmentStatus !== 'confirmed' || tenureDays(row, asOf) < 180)) {
      score += 20;
      reasons.push('No manager on file');
    }
    const ot = overtime[String(row._id)] || 0;
    if (ot >= 20) {
      score += 16;
      reasons.push(`High overtime last month (${ot}h)`);
    }
    if (expiringSet.has(String(row._id))) {
      score += 12;
      reasons.push('A personnel document expires within 30 days');
    }
    const band = bandFor(score);
    if (user.role === ROLES.EMPLOYEE || band !== 'stable') {
      watch.push({
        id: asId(row),
        fullName: personName(row),
        employeeCode: row.employeeCode,
        department: row.department,
        designation: row.designation,
        status: row.employmentStatus,
        score,
        band,
        reasons,
      });
    }
  });
  watch.sort((a, b) => b.score - a.score);

  const onNotice = people.filter((row) => row.employmentStatus === 'notice_period').length;
  const vacant = teams.reduce((sum, row) => sum + (row.vacant || 0), 0);
  const pipeline = openReqs.reduce((sum, row) => sum + (Number(row.openings) || 0), 0);
  const projected = people.length - onNotice;

  const movement = [];
  const history = await Employee.find(employeeFilter(ids)).select('dateOfJoining lastWorkingDay employmentStatus');
  for (let back = 5; back >= 0; back -= 1) {
    const start = new Date(asOf.getFullYear(), asOf.getMonth() - back, 1);
    const end = new Date(asOf.getFullYear(), asOf.getMonth() - back + 1, 0);
    movement.push({
      month: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`,
      headcount: history.filter((row) => employedOn(row, end)).length,
      hires: history.filter((row) => {
        const day = dateOnly(row.dateOfJoining);
        return day && day >= start && day <= end;
      }).length,
      exits: history.filter((row) => {
        const day = dateOnly(row.lastWorkingDay);
        return day && day >= start && day <= end;
      }).length,
    });
  }

  return {
    asOf: isoDay(asOf),
    method: 'rule-based',
    disclaimer:
      'Scores are transparent rules on current records (notice, manager, probation, overtime, expiring papers). This is not a statistical or machine-learning forecast.',
    overtimeMonth: month,
    watch,
    coverage: {
      headcount: people.length,
      onNotice,
      projectedIfNoticeExits: projected,
      vacantFte: user.role === ROLES.HR_ADMIN ? vacant : null,
      openRequisitionSeats: user.role === ROLES.HR_ADMIN ? pipeline : null,
      openArrears: user.role === ROLES.HR_ADMIN ? arrearsOpen : null,
    },
    movement,
  };
}

async function quality(user, ids) {
  const asOf = dateOnly(new Date());
  const horizon = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate() + 30);
  const people = (await loadPeople(ids)).filter((row) => employedOn(row, asOf) && ACTIVE.indexOf(row.employmentStatus) !== -1);
  const scope = scopedEmployeeField(ids);
  const peopleIds = people.map((row) => row._id);

  const [banks, docs, certs, licenses, filings, recovery, pendingLeave, pendingAssign, pendingBank] = await Promise.all([
    BankAccount.find({ employee: { $in: peopleIds }, status: 'active' }).select('employee'),
    EmployeeDocument.find(
      Object.assign({}, scope, { expiresOn: { $ne: null, $gte: asOf, $lte: horizon } })
    )
      .populate('employee', 'firstName lastName employeeCode')
      .limit(80),
    CertificationRecord.find(
      Object.assign({}, scope, { expiresAt: { $ne: null, $gte: asOf, $lte: horizon } })
    )
      .populate('employee', 'firstName lastName employeeCode')
      .limit(80),
    user.role === ROLES.HR_ADMIN
      ? License.find({ expiresOn: { $ne: null, $gte: asOf, $lte: horizon }, status: { $ne: 'revoked' } }).limit(80)
      : License.find(
          Object.assign({}, scope, { expiresOn: { $ne: null, $gte: asOf, $lte: horizon }, status: { $ne: 'revoked' } })
        ).limit(80),
    user.role === ROLES.HR_ADMIN ? Filing.find({ status: { $in: ['due', 'overdue'] } }).limit(40) : Promise.resolve([]),
    user.role === ROLES.HR_ADMIN
      ? AssetAssignment.find({ status: 'recovery' }).limit(40)
      : AssetAssignment.find(Object.assign({}, scope, { status: 'recovery' })).limit(40),
    LeaveRequest.find(Object.assign({}, scope, { status: PENDING })).limit(40),
    Assignment.find(Object.assign({}, scope, { status: PENDING })).limit(40),
    BankAccount.find(Object.assign({}, scope, { status: PENDING })).limit(40),
  ]);

  const bankSet = new Set(banks.map((row) => String(row.employee)));
  const missingBank = people.filter((row) => !bankSet.has(String(row._id)));
  const missingPhone = people.filter((row) => !String(row.phone || '').trim());

  function named(employee, message, kind) {
    const person = employee && employee.fullName ? employee : employee;
    return {
      kind,
      message,
      holder: personName(person),
      employeeCode: person && person.employeeCode,
    };
  }

  const exceptions = [];
  missingPhone.forEach((row) => exceptions.push(named(row, 'No phone number on the employee file', 'missing_phone')));
  missingBank.forEach((row) => exceptions.push(named(row, 'No active bank / payment method', 'missing_bank')));
  docs.forEach((row) =>
    exceptions.push(named(row.employee, `${row.type || 'Document'} expires ${isoDay(row.expiresOn)}`, 'document'))
  );
  certs.forEach((row) =>
    exceptions.push(named(row.employee, `${row.title || 'Certificate'} expires ${isoDay(row.expiresAt)}`, 'certificate'))
  );
  licenses.forEach((row) =>
    exceptions.push({
      kind: 'licence',
      message: `${row.name || 'Licence'} expires ${isoDay(row.expiresOn)}`,
      holder: (row.snapshot && row.snapshot.fullName) || '',
      employeeCode: (row.snapshot && row.snapshot.employeeCode) || '',
    })
  );
  filings.forEach((row) =>
    exceptions.push({
      kind: 'filing',
      message: `${row.code || 'Filing'} ${row.periodLabel || ''} is ${row.status}`.trim(),
      holder: '',
      employeeCode: '',
    })
  );
  recovery.forEach((row) =>
    exceptions.push({
      kind: 'asset_recovery',
      message: `Asset recovery · ${row.snapshot && row.snapshot.fullName ? row.snapshot.fullName : 'holder'}`,
      holder: row.snapshot && row.snapshot.fullName,
      employeeCode: row.snapshot && row.snapshot.employeeCode,
    })
  );
  pendingLeave.forEach((row) =>
    exceptions.push({
      kind: 'pending_leave',
      message: `Leave waiting · ${row.leaveType}`,
      holder: row.snapshot && row.snapshot.fullName,
      employeeCode: row.snapshot && row.snapshot.employeeCode,
    })
  );
  pendingAssign.forEach((row) =>
    exceptions.push({
      kind: 'pending_assignment',
      message: `${row.event || 'Assignment'} waiting for a checker`,
      holder: '',
      employeeCode: '',
    })
  );
  pendingBank.forEach((row) =>
    exceptions.push({
      kind: 'pending_bank',
      message: 'Bank change waiting for a checker',
      holder: '',
      employeeCode: '',
    })
  );

  return {
    asOf: isoDay(asOf),
    total: exceptions.length,
    byKind: countBy(exceptions, (row) => row.kind),
    exceptions: exceptions.slice(0, 120),
  };
}

function groupRows(rows, groupBy) {
  if (!groupBy) return rows;
  const grouped = {};
  rows.forEach((row) => {
    const key = String(row[groupBy] || row.kind || row.type || '—');
    grouped[key] = grouped[key] || { key, count: 0 };
    grouped[key].count += row.count || 1;
  });
  return Object.keys(grouped)
    .sort()
    .map((key) => grouped[key]);
}

async function runReport(user, ids, code, query = {}) {
  const report = definitionFor(code);
  if (!report) throw ApiError.notFound('Report not found');
  if (!canRun(user, report)) throw ApiError.forbidden('That report is not in your catalogue');

  const asOf = dateOnly(query.asOf) || dateOnly(new Date());
  const people = (await loadPeople(ids)).filter((row) => employedOn(row, asOf));
  const groupBy = report.groupBy.indexOf(query.groupBy) !== -1 ? query.groupBy : '';
  let rows = [];
  let columns = [];

  if (code === 'headcount_department') {
    columns = ['department', 'count'];
    rows = countBy(people, (row) => row.department).map((row) => ({ department: row.key, count: row.count }));
  } else if (code === 'headcount_status') {
    columns = ['status', 'count'];
    rows = countBy(people, (row) => row.employmentStatus).map((row) => ({ status: row.key, count: row.count }));
  } else if (code === 'roster') {
    columns = user.role === ROLES.HR_ADMIN
      ? ['employeeCode', 'fullName', 'department', 'status', 'baseSalary']
      : ['employeeCode', 'fullName', 'department', 'status'];
    rows = people.map((row) => {
      const item = {
        employeeCode: row.employeeCode,
        fullName: personName(row),
        department: row.department,
        status: row.employmentStatus,
      };
      if (user.role === ROLES.HR_ADMIN) item.baseSalary = (row.compensation && row.compensation.baseSalary) || 0;
      return item;
    });
  } else if (code === 'vacancies') {
    const teams = await org.headcountByTeam();
    columns = ['team', 'approved', 'filled', 'vacant'];
    rows = teams.map((row) => ({ team: row.name, approved: row.approved, filled: row.filled, vacant: row.vacant }));
  } else if (code === 'pending_work') {
    const overviewData = await overview(user, ids);
    columns = ['type', 'count'];
    rows = overviewData.pendingBreakdown.map((row) => ({ type: row.key, count: row.count }));
  } else if (code === 'expiring') {
    const qualityData = await quality(user, ids);
    const subset = qualityData.exceptions.filter((row) =>
      ['document', 'certificate', 'licence'].includes(row.kind)
    );
    columns = ['kind', 'holder', 'message'];
    rows = subset.map((row) => ({ kind: row.kind, holder: row.holder || '', message: row.message }));
  } else if (code === 'open_requisitions') {
    const filter = { status: { $in: ['pending', 'open'] } };
    if (ids !== null) {
      filter.$or = [{ employee: { $in: ids } }, { hiringManager: { $in: ids } }];
    }
    const reqs = await Requisition.find(filter).sort({ createdAt: -1 }).limit(80);
    columns = ['code', 'title', 'department', 'status', 'openings'];
    rows = reqs.map((row) => ({
      code: row.code,
      title: row.title,
      department: row.department,
      status: row.status,
      openings: row.openings,
    }));
  } else if (code === 'payroll_coverage') {
    const summary = await payrollSummary(ids);
    columns = ['month', 'slips', 'headcount', 'net'];
    rows = [summary];
  } else if (code === 'er_caseload') {
    const open = await ErCase.find({}).select('type status department');
    columns = ['type', 'status', 'count'];
    const map = {};
    open.forEach((row) => {
      const key = `${row.type}|${row.status}`;
      map[key] = map[key] || { type: row.type, status: row.status, count: 0 };
      map[key].count += 1;
    });
    rows = Object.keys(map).map((key) => map[key]);
  } else if (code === 'retention_watch') {
    const data = await outlook(user, ids);
    columns = ['employeeCode', 'fullName', 'department', 'band', 'score', 'reasons'];
    rows = data.watch.map((row) => ({
      employeeCode: row.employeeCode,
      fullName: row.fullName,
      department: row.department,
      band: row.band,
      score: row.score,
      reasons: (row.reasons || []).join('; '),
    }));
  } else if (code === 'headcount_outlook') {
    const data = await outlook(user, ids);
    columns = ['headcount', 'onNotice', 'projectedIfNoticeExits', 'vacantFte', 'openRequisitionSeats'];
    rows = [data.coverage];
  }

  if (groupBy && rows.length && rows[0][groupBy] !== undefined) {
    rows = groupRows(rows, groupBy);
    columns = ['key', 'count'];
  }

  await ReportDefinition.updateOne({ code }, { $set: { lastRunAt: new Date() } });

  return {
    report: { code: report.code, name: report.name, summary: report.summary },
    asOf: isoDay(asOf),
    columns,
    rows,
    rowCount: rows.length,
  };
}

async function runAdhoc(user, ids, query = {}) {
  if (user.role !== ROLES.HR_ADMIN && user.role !== ROLES.MANAGER) {
    throw ApiError.forbidden('Ad-hoc roster pivots are a manager and HR view');
  }
  const groupBy = ADHOC_GROUP_BY.indexOf(query.groupBy) !== -1 ? query.groupBy : 'department';
  const asOf = dateOnly(query.asOf) || dateOnly(new Date());
  const people = (await loadPeople(ids)).filter((row) => employedOn(row, asOf));
  const fieldOf = (row) => {
    if (groupBy === 'status') return row.employmentStatus || '—';
    return row[groupBy] || '—';
  };
  const rows = countBy(people, fieldOf).map((row) => ({ key: row.key, count: row.count }));
  return {
    report: {
      code: 'adhoc_roster',
      name: `Roster by ${groupBy}`,
      summary: `Whitelist pivot of the caller’s roster. Group-by is limited to ${ADHOC_GROUP_BY.join(', ')}.`,
    },
    asOf: isoDay(asOf),
    groupBy,
    columns: ['key', 'count'],
    rows,
    rowCount: rows.length,
  };
}

async function recordExport(user, payload, query) {
  const doc = await ExportLog.create({
    reportCode: payload.report.code,
    reportName: payload.report.name,
    format: 'json',
    rowCount: payload.rowCount,
    filters: query || {},
    actor: user._id,
    actorName: actorName(user),
    role: user.role,
  });
  return {
    id: asId(doc),
    reportCode: doc.reportCode,
    rowCount: doc.rowCount,
    at: isoDay(doc.createdAt),
  };
}

async function listReports(user) {
  const seeded = await ReportDefinition.find({}).sort({ category: 1, name: 1 });
  const byCode = {};
  seeded.forEach((row) => {
    byCode[row.code] = row;
  });
  return REPORTS.filter((row) => canRun(user, row)).map((row) => ({
    code: row.code,
    name: row.name,
    category: row.category,
    summary: row.summary,
    groupBy: row.groupBy,
    cadence: (byCode[row.code] && byCode[row.code].cadence) || 'none',
    lastRunAt: byCode[row.code] ? isoDay(byCode[row.code].lastRunAt) : '',
  }));
}

async function listSnapshots() {
  const rows = await KPISnapshot.find({}).sort({ asOf: -1, createdAt: -1 }).limit(24);
  return rows.map((row) => ({
    id: asId(row),
    asOf: isoDay(row.asOf),
    scope: row.scope,
    label: row.label,
    metrics: row.metrics,
    generatedByName: row.generatedByName,
  }));
}

async function refreshSnapshot(user, ids) {
  const data = await overview(user, ids);
  const metrics = {};
  data.tiles.forEach((tile) => {
    metrics[tile.key] = tile.value;
  });
  const doc = await KPISnapshot.create({
    asOf: dateOnly(new Date()),
    scope: data.scope === 'company' ? 'company' : 'team',
    label: `KPI refresh ${isoDay(new Date())}`,
    metrics,
    generatedBy: user._id,
    generatedByName: actorName(user),
  });
  return {
    id: asId(doc),
    asOf: isoDay(doc.asOf),
    scope: doc.scope,
    metrics: doc.metrics,
  };
}

async function listExports() {
  const rows = await ExportLog.find({}).sort({ createdAt: -1 }).limit(40);
  return rows.map((row) => ({
    id: asId(row),
    reportCode: row.reportCode,
    reportName: row.reportName,
    rowCount: row.rowCount,
    actorName: row.actorName,
    at: isoDay(row.createdAt),
  }));
}

async function ensureCatalogue() {
  for (const row of REPORTS) {
    await ReportDefinition.updateOne(
      { code: row.code },
      {
        $setOnInsert: {
          code: row.code,
          name: row.name,
          category: row.category,
          summary: row.summary,
          visibility: row.visibility,
          cadence: row.code === 'headcount_department' ? 'monthly' : 'none',
        },
      },
      { upsert: true }
    );
  }
}

module.exports = {
  overview,
  headcount,
  quality,
  outlook,
  runReport,
  runAdhoc,
  recordExport,
  listReports,
  listSnapshots,
  refreshSnapshot,
  listExports,
  ensureCatalogue,
  isoDay,
  dateOnly,
};
