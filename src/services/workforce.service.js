'use strict';

const Person = require('../models/Person');
const Employment = require('../models/Employment');
const Position = require('../models/Position');
const Assignment = require('../models/Assignment');
const Employee = require('../models/Employee');
const Grade = require('../models/Grade');
const ApiError = require('../utils/ApiError');
const {
  IDENTITY_FIELDS,
  CONTACT_FIELDS,
  EMPLOYMENT_FIELDS,
  ASSIGNMENT_FIELDS,
  CHECKER_FIELDS,
} = require('../config/workforce');
const org = require('./org.service');
const logger = require('../utils/logger');
const webhooks = require('./webhooks.service');

function pick(source, fields) {
  return fields.reduce((acc, field) => {
    if (source[field] !== undefined) acc[field] = source[field];
    return acc;
  }, {});
}

function startOfDay(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function dayBefore(value) {
  const date = startOfDay(value);
  date.setUTCDate(date.getUTCDate() - 1);
  return date;
}

function allowancesEqual(left, right) {
  const a = left || [];
  const b = right || [];
  if (a.length !== b.length) return false;
  return a.every(
    (item, index) => item.label === b[index].label && Number(item.amount) === Number(b[index].amount)
  );
}

function compensationEqual(left, right) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return (
    left.currency === right.currency &&
    Number(left.baseSalary) === Number(right.baseSalary) &&
    allowancesEqual(left.fixedAllowances, right.fixedAllowances)
  );
}

function restDaysEqual(left, right) {
  const a = (left || []).slice().sort();
  const b = (right || []).slice().sort();
  return a.length === b.length && a.every((day, index) => day === b[index]);
}

function idEqual(left, right) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return String(left._id || left) === String(right._id || right);
}

function assignmentSnapshot(employee) {
  return {
    designation: employee.designation,
    department: employee.department,
    team: employee.team || '',
    reportsTo: employee.reportsTo ? employee.reportsTo._id || employee.reportsTo : null,
    shiftType: employee.shiftType,
    restDays: (employee.restDays || []).slice(),
    location: employee.location || '',
    orgRole: employee.orgRole || '',
    gradeCode: employee.grade || '',
    position: employee.currentPosition || null,
    compensation: {
      currency: (employee.compensation && employee.compensation.currency) || 'USD',
      baseSalary: (employee.compensation && employee.compensation.baseSalary) || 0,
      fixedAllowances: ((employee.compensation && employee.compensation.fixedAllowances) || []).map((item) => ({
        label: item.label,
        amount: item.amount,
      })),
    },
  };
}

function diffAssignment(current, next) {
  const changed = [];
  if (current.designation !== next.designation) changed.push('designation');
  if (current.department !== next.department) changed.push('department');
  if ((current.team || '') !== (next.team || '')) changed.push('team');
  if (current.shiftType !== next.shiftType) changed.push('shiftType');
  if (!restDaysEqual(current.restDays, next.restDays)) changed.push('restDays');
  if (!idEqual(current.reportsTo, next.reportsTo)) changed.push('reportsTo');
  if (!idEqual(current.position, next.position)) changed.push('position');
  if ((current.location || '') !== (next.location || '')) changed.push('location');
  if ((current.orgRole || '') !== (next.orgRole || '')) changed.push('orgRole');
  if ((current.gradeCode || '') !== (next.gradeCode || '')) changed.push('grade');
  if (!compensationEqual(current.compensation, next.compensation)) changed.push('compensation');
  return changed;
}

function requiresChecker(changedFields) {
  return changedFields.some((field) => CHECKER_FIELDS.indexOf(field) !== -1);
}

function inferEvent(changedFields, explicit) {
  if (explicit) return explicit;
  if (changedFields.indexOf('compensation') !== -1 && changedFields.length === 1) return 'salary_change';
  if (changedFields.indexOf('designation') !== -1 || changedFields.indexOf('grade') !== -1) return 'promotion';
  if (changedFields.indexOf('department') !== -1 || changedFields.indexOf('team') !== -1 || changedFields.indexOf('position') !== -1) {
    return 'transfer';
  }
  if (changedFields.indexOf('shiftType') !== -1 || changedFields.indexOf('restDays') !== -1) return 'shift_change';
  if (changedFields.indexOf('reportsTo') !== -1) return 'manager_change';
  return 'transfer';
}

async function findOrCreatePosition(title) {
  return org.findOrCreateJob(title);
}

function projectPerson(employee, person) {
  employee.firstName = person.firstName;
  employee.lastName = person.lastName;
  employee.preferredName = person.preferredName || '';
  employee.dateOfBirth = person.dateOfBirth;
  employee.gender = person.gender;
}

function projectEmployment(employee, employment) {
  employee.employeeCode = employment.employeeCode;
  employee.email = employment.email;
  employee.phone = employment.phone;
  employee.address = employment.address;
  employee.employmentType = employment.employmentType;
  employee.employmentStatus = employment.employmentStatus;
  employee.dateOfJoining = employment.dateOfJoining;
  employee.annualLeaveDays = employment.annualLeaveDays;
  employee.userAccount = employment.userAccount;
  employee.location = employment.location || employee.location;
  employee.legalEntity = employment.legalEntity || employee.legalEntity;
  employee.employeeCategory = employment.employeeCategory || employee.employeeCategory;
  employee.payGroup = employment.payGroup || employee.payGroup;
  employee.probationEndDate = employment.probationEndDate;
  employee.confirmationDate = employment.confirmationDate;
  employee.lastWorkingDay = employment.lastWorkingDay;
}

function projectAssignment(employee, assignment) {
  employee.designation = assignment.designation;
  employee.department = assignment.department;
  employee.team = assignment.team || '';
  employee.reportsTo = assignment.reportsTo || null;
  employee.shiftType = assignment.shiftType;
  employee.restDays = assignment.restDays;
  employee.location = assignment.location || employee.location;
  employee.orgRole = assignment.orgRole || employee.orgRole;
  employee.grade = assignment.gradeCode || employee.grade;
  employee.costCenter = assignment.costCenter || employee.costCenter;
  employee.compensation = {
    currency: assignment.compensation.currency,
    baseSalary: assignment.compensation.baseSalary,
    fixedAllowances: assignment.compensation.fixedAllowances,
  };
  employee.currentAssignment = assignment._id;
  if (assignment.position) employee.currentPosition = assignment.position;
}

async function addDays(date, probationDays) {
  const end = startOfDay(date);
  end.setUTCDate(end.getUTCDate() + (probationDays || 90));
  return end;
}

/**
 * Builds Person / Employment / Position / Assignment for a directory row that
 * was created before this split, so payroll and attendance keep reading Employee.
 */
async function ensureWorkforce(employee) {
  await org.ensureOrganization();
  await materializeCurrent(employee);

  if (!employee.person) {
    const person = await Person.create({
      firstName: employee.firstName,
      lastName: employee.lastName,
      preferredName: employee.preferredName || '',
      dateOfBirth: employee.dateOfBirth,
      gender: employee.gender || '',
    });
    employee.person = person._id;
  }

  if (!employee.employment) {
    const employment = await Employment.create({
      person: employee.person,
      employee: employee._id,
      employeeCode: employee.employeeCode,
      email: employee.email,
      phone: employee.phone || '',
      address: employee.address || '',
      employmentType: employee.employmentType,
      employmentStatus: employee.employmentStatus,
      dateOfJoining: employee.dateOfJoining,
      originalHireDate: employee.dateOfJoining,
      annualLeaveDays: employee.annualLeaveDays,
      location: employee.location || 'Karachi HQ',
      userAccount: employee.userAccount,
      isCurrent: true,
    });
    employee.employment = employment._id;
  }

  const seat = await org.findOrCreateSeatForEmployee(employee);
  employee.currentPosition = seat._id;
  employee.orgRole = employee.orgRole || seat.orgRole || '';
  if (seat.grade) {
    const grade = await Grade.findById(seat.grade);
    if (grade) employee.grade = grade.code;
  }

  const active = await Assignment.findOne({ employee: employee._id, status: 'active' });
  if (!active) {
    const snapshot = assignmentSnapshot(employee);
    snapshot.position = seat._id;
    snapshot.gradeCode = employee.grade;
    snapshot.orgRole = employee.orgRole;
    snapshot.location = employee.location || seat.location || '';
    const assignment = await Assignment.create({
      employee: employee._id,
      employment: employee.employment,
      person: employee.person,
      position: seat._id,
      job: seat.job,
      grade: seat.grade,
      teamUnit: seat.team,
      event: 'hire',
      ...snapshot,
      effectiveFrom: startOfDay(employee.dateOfJoining),
      effectiveTo: null,
      status: 'active',
      changedFields: [],
      requiresApproval: false,
    });
    employee.currentAssignment = assignment._id;
    await org.occupyPosition(seat, employee);
  } else if (!employee.currentAssignment) {
    employee.currentAssignment = active._id;
  }

  if (employee.isModified()) await employee.save();
  return employee;
}

async function activateAssignment(employee, assignment) {
  const previous = await Assignment.findOne({
    employee: employee._id,
    status: 'active',
    _id: { $ne: assignment._id },
  });

  if (previous) {
    previous.status = 'superseded';
    previous.effectiveTo = dayBefore(assignment.effectiveFrom);
    await previous.save();
    if (previous.position && !idEqual(previous.position, assignment.position)) {
      await org.vacatePosition(previous.position, employee._id);
    }
  }

  assignment.status = 'active';
  assignment.effectiveTo = null;
  assignment.decidedAt = assignment.decidedAt || new Date();
  await assignment.save();

  projectAssignment(employee, assignment);
  if (assignment.position) {
    const seat = await Position.findById(assignment.position);
    await org.occupyPosition(seat, employee);
  }
  await employee.save();
  if (['transfer', 'promotion'].indexOf(assignment.event) !== -1) {
    webhooks.emit('employee.transferred', {
      employeeCode: employee.employeeCode,
      fullName: employee.fullName,
      event: assignment.event,
      designation: assignment.designation,
      department: assignment.department,
      effectiveFrom: assignment.effectiveFrom,
    });
  }
  return assignment;
}

async function postAssignment(employee, assignment) {
  const from = startOfDay(assignment.effectiveFrom);
  const today = startOfDay();
  if (from > today) {
    assignment.status = 'scheduled';
    assignment.decidedAt = assignment.decidedAt || new Date();
    await assignment.save();
    return assignment;
  }
  return activateAssignment(employee, assignment);
}

async function materializeCurrent(employee) {
  if (!employee || !employee._id) return employee;
  const today = startOfDay();
  const due = await Assignment.find({
    employee: employee._id,
    status: 'scheduled',
    effectiveFrom: { $lte: today },
  }).sort({ effectiveFrom: 1 });

  for (const row of due) {
    await activateAssignment(employee, row);
  }
  return employee;
}

async function createHire(payload, userId) {
  await org.ensureOrganization();

  const duplicate = await Person.findOne({
    firstName: payload.firstName,
    lastName: payload.lastName,
    dateOfBirth: payload.dateOfBirth || null,
  });
  if (duplicate && payload.dateOfBirth) {
    throw ApiError.conflict('A person with this name and date of birth already exists — use rehire');
  }

  let seat = null;
  if (payload.position) {
    seat = await org.assertPositionAvailable(payload.position, null);
    payload.designation = seat.title;
    if (seat.team) {
      const team = await require('../models/OrgUnit').findById(seat.team).populate('parent');
      if (team) {
        payload.team = team.name.replace(/ General$/, '');
        let node = team;
        while (node && node.type !== 'department' && node.parent) {
          node = await require('../models/OrgUnit').findById(node.parent);
        }
        if (node && node.type === 'department') payload.department = node.name;
      }
    }
    if (seat.grade) {
      const grade = await Grade.findById(seat.grade);
      if (grade) payload.grade = grade.code;
    }
    payload.orgRole = seat.orgRole;
    payload.location = payload.location || seat.location;
  }

  const employee = await Employee.create(payload);
  const person = await Person.create({
    firstName: employee.firstName,
    lastName: employee.lastName,
    preferredName: payload.preferredName || '',
    fatherName: payload.fatherName || '',
    dateOfBirth: employee.dateOfBirth,
    gender: employee.gender || '',
    maritalStatus: payload.maritalStatus || '',
    nationality: payload.nationality || '',
    personalEmail: payload.personalEmail || '',
    mobile: payload.mobile || payload.phone || '',
    nationalIds: payload.nationalIds || [],
  });
  const grade = payload.grade ? await Grade.findOne({ code: payload.grade }) : null;
  const probationEndDate = payload.probationEndDate || (await addDays(employee.dateOfJoining, (grade && grade.probationDays) || 90));

  const employment = await Employment.create({
    person: person._id,
    employee: employee._id,
    employeeCode: employee.employeeCode,
    email: employee.email,
    phone: employee.phone || '',
    address: employee.address || '',
    employmentType: employee.employmentType,
    employmentStatus: employee.employmentStatus || 'probation',
    dateOfJoining: employee.dateOfJoining,
    originalHireDate: employee.dateOfJoining,
    probationEndDate,
    annualLeaveDays: employee.annualLeaveDays,
    location: payload.location || 'Karachi HQ',
    legalEntity: payload.legalEntity || 'PortoHR (Pvt) Ltd',
    employeeCategory: payload.employeeCategory || 'non_executive',
    payGroup: payload.payGroup || 'monthly_intl',
    userAccount: employee.userAccount,
    isCurrent: true,
  });

  if (!seat) seat = await org.findOrCreateSeatForEmployee(employee);

  const snapshot = assignmentSnapshot(employee);
  snapshot.position = seat._id;
  snapshot.location = employment.location;
  snapshot.orgRole = seat.orgRole || employee.orgRole;
  snapshot.gradeCode = employee.grade || (grade && grade.code) || '';

  const assignment = await Assignment.create({
    employee: employee._id,
    employment: employment._id,
    person: person._id,
    position: seat._id,
    job: seat.job,
    grade: seat.grade,
    teamUnit: seat.team,
    event: 'hire',
    ...snapshot,
    effectiveFrom: startOfDay(employee.dateOfJoining),
    effectiveTo: null,
    status: 'active',
    changedFields: [],
    requiresApproval: false,
    requestedBy: userId || null,
  });

  employee.person = person._id;
  employee.employment = employment._id;
  employee.currentAssignment = assignment._id;
  employee.probationEndDate = probationEndDate;
  projectEmployment(employee, employment);
  projectAssignment(employee, assignment);
  await org.occupyPosition(seat, employee);
  await employee.save();
  return employee;
}

function mergeCompensation(current, incoming) {
  if (!incoming) return current;
  return {
    currency: incoming.currency !== undefined ? incoming.currency : current.currency,
    baseSalary: incoming.baseSalary !== undefined ? incoming.baseSalary : current.baseSalary,
    fixedAllowances:
      incoming.fixedAllowances !== undefined ? incoming.fixedAllowances : current.fixedAllowances,
  };
}

async function applyEmployeePatch(employee, payload, user) {
  await ensureWorkforce(employee);

  const identity = pick(payload, IDENTITY_FIELDS);
  const contact = pick(payload, CONTACT_FIELDS);
  const contract = pick(payload, EMPLOYMENT_FIELDS);
  const assignmentPatch = pick(payload, ASSIGNMENT_FIELDS);

  if (Object.keys(identity).length) {
    const person = await Person.findById(employee.person);
    person.set(identity);
    await person.save();
    projectPerson(employee, person);
  }

  if (Object.keys(contact).length || Object.keys(contract).length) {
    const employment = await Employment.findById(employee.employment);
    employment.set(Object.assign({}, contact, contract));
    await employment.save();
    projectEmployment(employee, employment);
  }

  let pendingAssignment = null;
  let activatedAssignment = null;
  let scheduledAssignment = null;

  if (Object.keys(assignmentPatch).length) {
    const current = assignmentSnapshot(employee);
    const next = {
      designation: assignmentPatch.designation !== undefined ? assignmentPatch.designation : current.designation,
      department: assignmentPatch.department !== undefined ? assignmentPatch.department : current.department,
      team: assignmentPatch.team !== undefined ? assignmentPatch.team : current.team,
      reportsTo: assignmentPatch.reportsTo !== undefined ? assignmentPatch.reportsTo : current.reportsTo,
      shiftType: assignmentPatch.shiftType !== undefined ? assignmentPatch.shiftType : current.shiftType,
      restDays: assignmentPatch.restDays !== undefined ? assignmentPatch.restDays : current.restDays,
      location: assignmentPatch.location !== undefined ? assignmentPatch.location : current.location,
      orgRole: assignmentPatch.orgRole !== undefined ? assignmentPatch.orgRole : current.orgRole,
      gradeCode: assignmentPatch.grade !== undefined ? assignmentPatch.grade : current.gradeCode,
      position: assignmentPatch.position !== undefined ? assignmentPatch.position : current.position,
      compensation: mergeCompensation(current.compensation, assignmentPatch.compensation),
    };

    if (assignmentPatch.position) {
      const seat = await org.assertPositionAvailable(assignmentPatch.position, employee._id);
      next.designation = seat.title;
      next.orgRole = seat.orgRole || next.orgRole;
      next.position = seat._id;
      if (seat.grade) {
        const grade = await Grade.findById(seat.grade);
        if (grade) next.gradeCode = grade.code;
      }
    }

    const changedFields = diffAssignment(current, next);
    if (changedFields.length) {
      const existingPending = await Assignment.findOne({ employee: employee._id, status: 'pending' });
      if (existingPending) {
        throw ApiError.conflict('A change is already waiting for approval on this record');
      }

      const from = startOfDay(payload.effectiveFrom);
      const today = startOfDay();
      if (from < today && !payload.allowRetroactive) {
        throw ApiError.badRequest(
          'Retroactive changes need an impact check — set allowRetroactive and a reason before posting into a closed period'
        );
      }

      let seat = null;
      if (next.position) seat = await Position.findById(next.position);
      else seat = await org.findOrCreateSeatForEmployee(Object.assign({}, employee, next));

      const needsApproval = requiresChecker(changedFields);
      const event = inferEvent(changedFields, payload.event);
      const assignment = await Assignment.create({
        employee: employee._id,
        employment: employee.employment,
        person: employee.person,
        position: seat && seat._id,
        job: seat && seat.job,
        grade: seat && seat.grade,
        teamUnit: seat && seat.team,
        event,
        eventReason: payload.eventReason || '',
        designation: next.designation,
        department: next.department,
        team: next.team,
        reportsTo: next.reportsTo,
        shiftType: next.shiftType,
        restDays: next.restDays,
        location: next.location,
        orgRole: next.orgRole,
        gradeCode: next.gradeCode,
        compensation: next.compensation,
        effectiveFrom: from,
        effectiveTo: null,
        status: needsApproval ? 'pending' : from > today ? 'scheduled' : 'active',
        changedFields,
        requiresApproval: needsApproval,
        reason: String(payload.reason || '').trim(),
        requestedBy: user && user._id,
      });

      if (needsApproval) {
        pendingAssignment = assignment;
      } else if (from > today) {
        scheduledAssignment = assignment;
      } else {
        activatedAssignment = await activateAssignment(employee, assignment);
      }
    }
  }

  if (employee.isModified()) await employee.save();

  return { employee, pendingAssignment, activatedAssignment, scheduledAssignment };
}

async function decideAssignment(assignment, user, status, note) {
  if (assignment.status !== 'pending') {
    throw ApiError.conflict('This assignment change has already been decided');
  }
  if (status !== 'approved' && status !== 'rejected' && status !== 'cancelled') {
    throw ApiError.badRequest('Decision must be approved, rejected or cancelled');
  }

  if (status === 'rejected' && !String(note || '').trim()) {
    throw ApiError.badRequest('A rejection needs a short note');
  }

  assignment.decidedBy = user._id;
  assignment.decidedAt = new Date();
  assignment.decisionNote = String(note || '').trim();

  if (status === 'rejected' || status === 'cancelled') {
    assignment.status = status === 'cancelled' ? 'cancelled' : 'rejected';
    await assignment.save();
    return assignment;
  }

  const employee = await Employee.findById(assignment.employee);
  if (!employee) throw ApiError.notFound('Employee not found');
  return postAssignment(employee, assignment);
}

async function separateEmployee(employee, payload, user) {
  await ensureWorkforce(employee);
  const lastWorkingDay = startOfDay(payload.lastWorkingDay || payload.terminationDate);
  const terminationDate = startOfDay(payload.terminationDate || payload.lastWorkingDay);
  if (terminationDate < startOfDay(employee.dateOfJoining)) {
    throw ApiError.badRequest('Termination cannot precede the hire date');
  }

  const employment = await Employment.findById(employee.employment);
  employment.employmentStatus = payload.employmentStatus || 'resigned';
  employment.lastWorkingDay = lastWorkingDay;
  employment.terminationDate = terminationDate;
  employment.separationType = payload.separationType || 'resignation';
  employment.separationReason = payload.reason || '';
  employment.rehireEligible = payload.rehireEligible !== false;
  await employment.save();
  projectEmployment(employee, employment);

  const active = await Assignment.findOne({ employee: employee._id, status: 'active' });
  if (active) {
    active.status = 'superseded';
    active.effectiveTo = lastWorkingDay;
    active.event = active.event || 'separation';
    await active.save();
  }
  await Assignment.updateMany(
    { employee: employee._id, status: 'scheduled' },
    { $set: { status: 'cancelled', decisionNote: 'Cancelled by separation' } }
  );

  if (employee.currentPosition) await org.vacatePosition(employee.currentPosition, employee._id);
  employee.currentAssignment = null;
  await employee.save();

  try {
    await require('./assets.service').queueRecovery(employee, user);
  } catch (err) {
    logger.warn('Asset recovery on separation failed:', err.message);
  }

  webhooks.emit('employee.separated', {
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    lastWorkingDay,
    terminationDate,
    separationType: employment.separationType,
    reason: employment.separationReason || '',
  });

  return employee;
}

async function rehireEmployee(employee, payload, user) {
  await ensureWorkforce(employee);
  if (['resigned', 'terminated'].indexOf(employee.employmentStatus) === -1) {
    throw ApiError.badRequest('Only a separated employee can be rehired');
  }

  const previous = await Employment.findById(employee.employment);
  if (previous) {
    previous.isCurrent = false;
    await previous.save();
  }

  const joining = startOfDay(payload.dateOfJoining);
  const employment = await Employment.create({
    person: employee.person,
    employee: employee._id,
    employeeCode: employee.employeeCode,
    email: payload.email || employee.email,
    phone: employee.phone,
    address: employee.address,
    employmentType: payload.employmentType || employee.employmentType,
    employmentStatus: 'probation',
    dateOfJoining: joining,
    originalHireDate: previous && previous.originalHireDate ? previous.originalHireDate : employee.dateOfJoining,
    probationEndDate: await addDays(joining, 90),
    annualLeaveDays: payload.annualLeaveDays != null ? payload.annualLeaveDays : employee.annualLeaveDays,
    location: payload.location || employee.location,
    legalEntity: employee.legalEntity,
    employeeCategory: payload.employeeCategory || employee.employeeCategory,
    payGroup: employee.payGroup,
    isCurrent: true,
    userAccount: employee.userAccount,
  });

  employee.employment = employment._id;
  employee.employmentStatus = 'probation';
  employee.dateOfJoining = joining;
  employee.lastWorkingDay = null;
  projectEmployment(employee, employment);

  if (payload.position) payload.event = 'rehire';
  const result = await applyEmployeePatch(
    employee,
    Object.assign({}, payload, {
      employmentStatus: 'probation',
      dateOfJoining: joining,
      event: 'rehire',
      effectiveFrom: joining,
    }),
    user
  );
  return result.employee;
}

async function assignmentAsOf(employeeId, asOf) {
  const date = startOfDay(asOf);
  return Assignment.findOne({
    employee: employeeId,
    status: { $in: ['active', 'superseded', 'scheduled'] },
    effectiveFrom: { $lte: date },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: date } }],
  }).sort({ effectiveFrom: -1, createdAt: -1 });
}

async function loadHistory(employeeId) {
  return Assignment.find({ employee: employeeId }).sort({ effectiveFrom: -1, createdAt: -1 });
}

function presentAssignment(doc, showCompensation) {
  if (!doc) return null;
  const json = typeof doc.toJSON === 'function' ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  json.employee = json.employee ? String(json.employee._id || json.employee) : null;
  json.position = json.position ? String(json.position._id || json.position) : null;
  json.job = json.job ? String(json.job._id || json.job) : null;
  json.grade = json.grade ? String(json.grade._id || json.grade) : null;
  json.requestedBy = json.requestedBy ? String(json.requestedBy._id || json.requestedBy) : null;
  json.decidedBy = json.decidedBy ? String(json.decidedBy._id || json.decidedBy) : null;
  if (json.reportsTo && json.reportsTo._id) {
    json.reportsTo = {
      id: String(json.reportsTo._id),
      firstName: json.reportsTo.firstName,
      lastName: json.reportsTo.lastName,
      employeeCode: json.reportsTo.employeeCode,
      designation: json.reportsTo.designation,
    };
  } else if (json.reportsTo) {
    json.reportsTo = String(json.reportsTo);
  }
  if (!showCompensation) {
    json.compensation = { restricted: true };
  }
  const shift = require('../config/shiftRegistry').get(json.shiftType);
  json.shift = {
    type: json.shiftType,
    label: shift.label || json.shiftType,
    startTime: shift.startTime || null,
    endTime: shift.endTime || null,
  };
  const allowances = (json.compensation && json.compensation.fixedAllowances) || [];
  if (showCompensation && json.compensation && !json.compensation.restricted) {
    json.totalAllowances = allowances.reduce((sum, item) => sum + (item.amount || 0), 0);
    json.grossSalary = (json.compensation.baseSalary || 0) + json.totalAllowances;
  }
  return json;
}

module.exports = {
  pick,
  startOfDay,
  dayBefore,
  assignmentSnapshot,
  diffAssignment,
  requiresChecker,
  inferEvent,
  findOrCreatePosition,
  ensureWorkforce,
  activateAssignment,
  postAssignment,
  materializeCurrent,
  createHire,
  applyEmployeePatch,
  decideAssignment,
  separateEmployee,
  rehireEmployee,
  assignmentAsOf,
  loadHistory,
  presentAssignment,
  IDENTITY_FIELDS,
  CONTACT_FIELDS,
  EMPLOYMENT_FIELDS,
  ASSIGNMENT_FIELDS,
};
