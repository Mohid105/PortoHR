'use strict';

/**
 * Splits a principal (minor units) into whole-cent instalments. The last one
 * absorbs the remainder so the schedule always sums back to exactly the amount
 * borrowed rather than a cent or two either side of it.
 */
function instalments(amount, months) {
  const period = Math.max(1, Number(months) || 1);
  const principal = Math.max(0, Math.round(Number(amount) || 0));
  const monthly = Math.floor(principal / period);
  return {
    monthlyInstalment: monthly,
    finalInstalment: principal - monthly * (period - 1),
  };
}

function monthIndex(value) {
  const d = new Date(value);
  return d.getFullYear() * 12 + d.getMonth();
}

/**
 * The instalment of an approved loan that falls due in `month` (YYYY-MM), in
 * minor units, or 0. Recovery starts the month after approval and runs for the
 * agreed number of months; the last instalment absorbs the rounding remainder.
 */
function instalmentDue(loan, month) {
  if (!loan || loan.status !== 'approved' || !loan.decidedAt) return 0;
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!match) return 0;
  const target = Number(match[1]) * 12 + (Number(match[2]) - 1);
  const n = target - monthIndex(loan.decidedAt);
  if (n < 1 || n > loan.repaymentMonths) return 0;
  return n === loan.repaymentMonths ? loan.finalInstalment : loan.monthlyInstalment;
}

/**
 * What is still owed on an approved loan once the instalments due up to and
 * including `month` have been recovered through payroll, in minor units.
 */
function outstandingAfter(loan, month) {
  if (!loan || loan.status !== 'approved' || !loan.decidedAt) return 0;
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!match) return 0;
  const target = Number(match[1]) * 12 + (Number(match[2]) - 1);
  const recovered = Math.min(loan.repaymentMonths, Math.max(0, target - monthIndex(loan.decidedAt)));
  const total = loan.monthlyInstalment * (loan.repaymentMonths - 1) + loan.finalInstalment;
  const paid = recovered >= loan.repaymentMonths ? total : loan.monthlyInstalment * recovered;
  return Math.max(0, total - paid);
}

module.exports = { instalments, instalmentDue, outstandingAfter };
