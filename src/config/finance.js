'use strict';

/**
 * Rules for the two self-service request types. Limits live here rather than in
 * the controllers so that changing what staff may ask for is a config edit.
 */

/** Both request types share one lifecycle: raised, then decided once. */
const REQUEST_STATUSES = ['pending', 'approved', 'rejected'];

const STATUS_LABELS = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

const LOAN = {
  minAmount: 100,
  /** Ceiling expressed as a multiple of the applicant's monthly gross salary. */
  maxSalaryMultiple: 6,
  minRepaymentMonths: 1,
  maxRepaymentMonths: 24,
  minReasonLength: 10,
  maxReasonLength: 300,
};

const COMPENSATION_TYPES = [
  {
    value: 'travel_allowance',
    label: 'Travel Allowance',
    /** Money already spent, so proof of the expense is required. */
    requiresReceipt: true,
    maxAmount: 5000,
    hint: 'Reimbursement for travel you have already paid for. Attach the receipt reference.',
  },
  {
    value: 'annual_benefit',
    label: 'Annual Benefit',
    requiresReceipt: false,
    maxAmount: 10000,
    hint: 'Your yearly benefit entitlement. No receipt needed.',
  },
];

const COMPENSATION_TYPE_VALUES = COMPENSATION_TYPES.map((type) => type.value);

function compensationType(value) {
  return COMPENSATION_TYPES.filter((type) => type.value === value)[0] || null;
}

function metaPayload() {
  return {
    statuses: REQUEST_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] })),
    loan: LOAN,
    compensationTypes: COMPENSATION_TYPES,
  };
}

module.exports = {
  REQUEST_STATUSES,
  STATUS_LABELS,
  LOAN,
  COMPENSATION_TYPES,
  COMPENSATION_TYPE_VALUES,
  compensationType,
  metaPayload,
};
