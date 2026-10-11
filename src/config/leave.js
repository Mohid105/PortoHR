'use strict';

/**
 * Leave types, accrual defaults and lifecycle labels. Changing an entitlement
 * here is a policy edit, not a code hunt through the request controller.
 */

/**
 * Leave is granted to two groups, because many employers run separate policies
 * for factory/shift workers and for salaried staff. Anyone whose employee
 * category is "worker" is in the worker group; everyone else (including
 * employees with no category set) is staff.
 *
 * `appliesTo` decides who may take a type at all, and `entitlementByGroup`
 * overrides the default number of days per group. The figures follow a sample
 * of real leave records and standard Pakistani labour practice (workers:
 * 10 casual, 16 medical, 14 annual; staff: personal + annual). They are
 * policy, so adjust them to your own handbook.
 */
const LEAVE_GROUPS = ['worker', 'staff'];

function groupOf(employee) {
  return employee && employee.employeeCategory === 'worker' ? 'worker' : 'staff';
}

const LEAVE_TYPES = [
  {
    code: 'annual',
    label: 'Annual leave',
    paid: true,
    /** When set, entitlement is taken from the employment record rather than a fixed quota. */
    entitlementFromEmployment: true,
    defaultEntitlement: 20,
    carryForwardDays: 5,
    requiresApproval: true,
    appliesTo: ['worker', 'staff'],
    color: 'sky',
    hint: 'Planned time off against the annual entitlement on the employment record.',
  },
  {
    code: 'sick',
    label: 'Medical leave',
    paid: true,
    entitlementFromEmployment: false,
    defaultEntitlement: 10,
    entitlementByGroup: { worker: 16, staff: 10 },
    carryForwardDays: 0,
    requiresApproval: true,
    appliesTo: ['worker', 'staff'],
    color: 'amber',
    hint: 'Unplanned medical absence. Part-day absences can be entered in hours. Supporting notes help the approver.',
  },
  {
    code: 'casual',
    label: 'Casual leave',
    paid: true,
    entitlementFromEmployment: false,
    defaultEntitlement: 10,
    carryForwardDays: 0,
    requiresApproval: true,
    appliesTo: ['worker', 'staff'],
    color: 'violet',
    hint: 'Short personal leave for errands or family matters.',
  },
  {
    code: 'personal',
    label: 'Personal leave',
    paid: true,
    entitlementFromEmployment: false,
    defaultEntitlement: 20,
    carryForwardDays: 0,
    requiresApproval: true,
    appliesTo: ['staff'],
    color: 'teal',
    hint: 'Salaried staff leave for personal matters, in place of casual and medical leave.',
  },
  {
    code: 'special',
    label: 'Special case leave',
    paid: true,
    entitlementFromEmployment: false,
    defaultEntitlement: 30,
    carryForwardDays: 0,
    requiresApproval: true,
    appliesTo: ['worker', 'staff'],
    color: 'indigo',
    hint: 'Exceptional circumstances approved by HR, such as bereavement or pilgrimage.',
  },
  {
    code: 'compensatory',
    label: 'Compensatory leave',
    paid: true,
    entitlementFromEmployment: false,
    /** Earned, not granted: HR adds days as an adjustment when someone works a rest day. */
    defaultEntitlement: 0,
    carryForwardDays: 0,
    requiresApproval: true,
    appliesTo: ['worker', 'staff'],
    color: 'emerald',
    hint: 'Time off in return for working a rest day or holiday. HR credits the days.',
  },
  {
    code: 'lwp',
    label: 'Leave without pay',
    paid: false,
    entitlementFromEmployment: false,
    defaultEntitlement: 30,
    carryForwardDays: 0,
    requiresApproval: true,
    appliesTo: ['worker', 'staff'],
    color: 'rose',
    hint: 'Unpaid absence. Approved days are deducted in the next payroll run.',
  },
  {
    code: 'maternity',
    label: 'Maternity leave',
    paid: true,
    entitlementFromEmployment: false,
    defaultEntitlement: 90,
    carryForwardDays: 0,
    requiresApproval: true,
    appliesTo: ['worker', 'staff'],
    color: 'pink',
    hint: 'Statutory maternity leave. HR usually raises this on the employee’s behalf.',
  },
];

const LEAVE_TYPE_CODES = LEAVE_TYPES.map((type) => type.code);

const LEAVE_TYPE_BY_CODE = LEAVE_TYPES.reduce((acc, type) => {
  acc[type.code] = type;
  return acc;
}, {});

const REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];

const STATUS_LABELS = {
  pending: 'Pending approval',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

const HALF_DAYS = ['', 'morning', 'afternoon'];

const HALF_DAY_LABELS = {
  '': 'Full day',
  morning: 'Morning',
  afternoon: 'Afternoon',
};

function typeOf(code) {
  return LEAVE_TYPE_BY_CODE[code] || null;
}

function metaPayload() {
  return {
    types: LEAVE_TYPES.map((type) => ({
      value: type.code,
      label: type.label,
      paid: type.paid,
      defaultEntitlement: type.defaultEntitlement,
      carryForwardDays: type.carryForwardDays,
      appliesTo: type.appliesTo,
      hint: type.hint,
    })),
    statuses: REQUEST_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] })),
    halfDays: HALF_DAYS.map((value) => ({ value, label: HALF_DAY_LABELS[value] })),
  };
}

module.exports = {
  LEAVE_GROUPS,
  groupOf,
  LEAVE_TYPES,
  LEAVE_TYPE_CODES,
  LEAVE_TYPE_BY_CODE,
  REQUEST_STATUSES,
  STATUS_LABELS,
  HALF_DAYS,
  HALF_DAY_LABELS,
  typeOf,
  metaPayload,
};
