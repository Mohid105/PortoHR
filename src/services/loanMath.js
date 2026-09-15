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

module.exports = { instalments };
