'use strict';

/**
 * Payroll rules, gathered in one place so that changing a statutory rate never
 * means hunting through the calculation engine.
 *
 * The profile below follows a Pakistani fixed-rate (monthly salaried) payroll:
 * a 26-day month, double-rate overtime, gazetted-holiday work paid separately,
 * EOBI and provident-fund contributions, and slab-based salaried income tax.
 * Verified against a real salary sheet and payslip: salary / 26 per day,
 * per day / 8 per hour, and overtime at 2x that hourly rate.
 *
 * STATUTORY FIGURES (tax slabs, EOBI) change with every Finance Act. They are
 * the best known values, not legal advice — confirm them with your tax adviser
 * before running real payroll, and edit them here (nothing else hard-codes them).
 */

/** Bumped whenever the rules below change, and stamped onto every payslip. */
const ENGINE_VERSION = '2.0.0';

const PAYROLL = {
  /**
   * EOBI, provident fund and the income-tax slabs are denominated in this
   * currency. An employee paid in another currency gets none of them (with a
   * note on the payslip) rather than a wrong figure.
   */
  statutoryCurrency: 'PKR',

  /** Multiplier applied to the hourly rate for overtime hours. */
  overtimeMultiplier: 2,

  /**
   * Categories that earn no overtime or gazetted-holiday pay: salaried
   * executives and management. An employee with no category set is treated as
   * eligible, so existing records keep behaving as before.
   */
  overtimeExcludedCategories: ['executive', 'management'],

  /** Hours worked on a gazetted (public) holiday are paid at this multiple of the hourly rate. */
  gazettedHolidayMultiplier: 2,

  /**
   * How the hourly rate is derived from the daily rate.
   *  'shift' — divide by the hours the employee's own shift owes (7.5 or 8).
   *  'fixed' — divide by `standardHoursPerDay` for everyone.
   */
  hourlyRateBasis: 'fixed',
  standardHoursPerDay: 8,

  /**
   * How the daily rate is derived from a month's salary.
   *  'fixed_divisor' — always divide by `monthDivisor` (26): each absent day
   *                    costs 1/26 of the month whatever the calendar says.
   *  'working_days'  — divide by the days actually rostered that month.
   */
  perDayBasis: 'fixed_divisor',
  monthDivisor: 26,

  /** EOBI employee contribution: a flat rate on a fixed wage base. */
  socialSecurity: {
    label: 'EOBI (employee)',
    rate: 0.01,
    /** The wage the contribution is calculated on (not a cap on pay). */
    monthlyCeiling: 31000,
    /** When true the contribution is rate x ceiling for anyone earning above zero. */
    flatOnCeiling: true,
  },

  /** Employee provident-fund contribution, for employees enrolled in the scheme. */
  providentFund: {
    label: 'Provident fund (employee)',
    employeeRate: 0.1,
    /** The contribution is taken off before income tax is worked out. */
    taxDeductible: true,
  },

  incomeTax: {
    label: 'Income tax',
    /**
     * The supplied worker payslip shows no tax despite roughly 160,000 earned in
     * the month, because overtime and gazetted-holiday pay were left out of the
     * tax base. Set to false to tax them as well.
     */
    excludeOvertime: true,
    /**
     * Progressive annual bands (salaried individuals, tax year 2025-26). Each
     * band's rate applies only to the portion of income inside it.
     * `upTo: null` is the open-ended top band. A surcharge for very high
     * earners is not modelled. Monthly tax is one twelfth of the annual figure.
     */
    annualBands: [
      { upTo: 600000, rate: 0 },
      { upTo: 1200000, rate: 0.01 },
      { upTo: 2200000, rate: 0.11 },
      { upTo: 3200000, rate: 0.23 },
      { upTo: 4100000, rate: 0.3 },
      { upTo: null, rate: 0.35 },
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
    gazettedHolidayMultiplier: PAYROLL.gazettedHolidayMultiplier,
    monthDivisor: PAYROLL.perDayBasis === 'fixed_divisor' ? PAYROLL.monthDivisor : null,
    providentFund: PAYROLL.providentFund,
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
