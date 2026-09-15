'use strict';

/**
 * Payroll rules, gathered in one place so that changing a statutory rate never
 * means hunting through the calculation engine.
 *
 * The tax bands and contribution rates below are ILLUSTRATIVE. They are shaped
 * like a real progressive income tax and a capped social security contribution,
 * but they are not any particular country's schedule — replace them with your
 * jurisdiction's before running real payroll.
 */

/** Bumped whenever the rules below change, and stamped onto every payslip. */
const ENGINE_VERSION = '1.0.0';

const PAYROLL = {
  /** Statutory multiplier applied to the hourly rate for overtime hours. */
  overtimeMultiplier: 1.5,

  /**
   * How the hourly rate is derived from the daily rate.
   *  'shift' — divide by the hours the employee's own shift owes (7.5 or 8).
   *  'fixed' — divide by `standardHoursPerDay` for everyone.
   * 'shift' is the accurate choice: paying a 7.5-hour employee's overtime at a
   * rate divided by 8 would quietly underpay them by 6.25%.
   */
  hourlyRateBasis: 'shift',
  standardHoursPerDay: 8,

  /**
   * The daily rate divides a full month's salary by the days the employee is
   * actually rostered to work that month, so a 20-working-day February and a
   * 23-working-day March each produce a correct day's pay.
   */
  perDayBasis: 'working_days',

  socialSecurity: {
    label: 'Social security',
    rate: 0.07,
    /** Contributions are only charged on earnings up to this monthly amount. */
    monthlyCeiling: 6000,
  },

  incomeTax: {
    label: 'Income tax',
    /**
     * Progressive annual bands. Each band's rate applies only to the portion of
     * income falling inside it. `upTo: null` is the top, open-ended band.
     * Monthly tax is one twelfth of the tax on the annualised figure.
     */
    annualBands: [
      { upTo: 12000, rate: 0 },
      { upTo: 24000, rate: 0.05 },
      { upTo: 48000, rate: 0.1 },
      { upTo: 96000, rate: 0.2 },
      { upTo: null, rate: 0.3 },
    ],
  },
};

const PAYSLIP_STATUSES = ['draft', 'finalised', 'paid'];

const STATUS_LABELS = {
  draft: 'Draft',
  finalised: 'Finalised',
  paid: 'Paid',
};

/**
 * Allowed status moves. A draft can be corrected and regenerated freely; once
 * finalised it is an approved figure and must be explicitly reopened before it
 * can change again.
 */
const STATUS_TRANSITIONS = {
  draft: ['finalised'],
  finalised: ['paid', 'draft'],
  paid: [],
};

const ARREARS_STATUSES = ['simulated', 'posted', 'paid', 'cancelled'];

const ARREARS_STATUS_LABELS = {
  simulated: 'Simulated',
  posted: 'Posted',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

const ARREARS_TRANSITIONS = {
  simulated: ['posted', 'cancelled'],
  posted: ['paid', 'cancelled'],
  paid: [],
  cancelled: [],
};

function metaPayload() {
  return {
    engineVersion: ENGINE_VERSION,
    overtimeMultiplier: PAYROLL.overtimeMultiplier,
    hourlyRateBasis: PAYROLL.hourlyRateBasis,
    standardHoursPerDay: PAYROLL.standardHoursPerDay,
    socialSecurity: PAYROLL.socialSecurity,
    incomeTax: PAYROLL.incomeTax,
    statuses: PAYSLIP_STATUSES.map((value) => ({
      value,
      label: STATUS_LABELS[value],
      next: STATUS_TRANSITIONS[value],
    })),
    arrearsStatuses: ARREARS_STATUSES.map((value) => ({
      value,
      label: ARREARS_STATUS_LABELS[value],
      next: ARREARS_TRANSITIONS[value],
    })),
  };
}

module.exports = {
  ENGINE_VERSION,
  PAYROLL,
  PAYSLIP_STATUSES,
  STATUS_LABELS,
  STATUS_TRANSITIONS,
  ARREARS_STATUSES,
  ARREARS_STATUS_LABELS,
  ARREARS_TRANSITIONS,
  metaPayload,
};
