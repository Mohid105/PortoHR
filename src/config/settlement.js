'use strict';

/**
 * Full-and-final settlement policy. The method follows a real final-settlement
 * bill: the last month's salary is pro-rated on a 26-day month, unavailed
 * annual leave is encashed at gross / 26 per day, leave taken beyond what had
 * accrued is recovered at the same rate, and any outstanding loan is deducted.
 */

const SETTLEMENT = {
  /** Gross / this = one day's pay, for pro-rating, encashment and recovery. */
  dayDivisor: 26,

  /** Leave types whose unused accrued balance is paid out on separation. */
  encashableLeaveTypes: ['annual'],

  /** Leave types that are not tracked against accrual (no recovery when overdrawn). */
  recoveryExemptLeaveTypes: ['lwp', 'maternity', 'special', 'compensatory'],

  /**
   * Entitlements accrue evenly across the year; on separation the entitlement
   * counts only for the part of the year served. Set false to treat the whole
   * year's entitlement as earned from 1 January.
   */
  accrueByMonth: true,

  /** An approved or paid settlement can no longer be edited, only reopened by status rules below. */
  statuses: ['draft', 'approved', 'paid'],
  transitions: { draft: ['approved'], approved: ['paid', 'draft'], paid: [] },
};

const STATUS_LABELS = { draft: 'Draft', approved: 'Approved', paid: 'Paid' };

module.exports = { SETTLEMENT, STATUS_LABELS };
