'use strict';

/**
 * Leave types, accrual defaults and lifecycle labels. Changing an entitlement
 * here is a policy edit, not a code hunt through the request controller.
 */

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
    color: 'sky',
    hint: 'Planned time off against the annual entitlement on the employment record.',
  },
  {
    code: 'sick',
    label: 'Sick leave',
    paid: true,
    entitlementFromEmployment: false,
    defaultEntitlement: 10,
    carryForwardDays: 0,
    requiresApproval: true,
    color: 'amber',
    hint: 'Unplanned medical absence. Supporting notes help the approver.',
  },
  {
    code: 'casual',
    label: 'Casual leave',
    paid: true,
    entitlementFromEmployment: false,
    defaultEntitlement: 10,
    carryForwardDays: 0,
    requiresApproval: true,
    color: 'violet',
    hint: 'Short personal leave for errands or family matters.',
  },
  {
    code: 'lwp',
    label: 'Leave without pay',
    paid: false,
    entitlementFromEmployment: false,
    defaultEntitlement: 30,
    carryForwardDays: 0,
    requiresApproval: true,
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
      hint: type.hint,
    })),
    statuses: REQUEST_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] })),
    halfDays: HALF_DAYS.map((value) => ({ value, label: HALF_DAY_LABELS[value] })),
  };
}

module.exports = {
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
