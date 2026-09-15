'use strict';

/**
 * Every payroll figure is held as an integer number of minor units (cents).
 *
 * Binary floats cannot represent most decimal fractions exactly, so chaining
 * multiplications and divisions on major-unit numbers accumulates error that
 * eventually shows up as a payslip that does not add up. Working in integers
 * means the only place a fraction exists is inside a single rounding call.
 */

/**
 * Rounds a possibly-fractional count of minor units to a whole one, half away
 * from zero — the way a person doing the sum by hand would.
 *
 * The `toFixed` pass first is deliberate: a product such as 1.005 * 100 is
 * 100.49999999999999 in binary, and rounding that directly gives 100 when the
 * decimal answer is plainly 101.
 */
function roundMinor(value) {
  const number = Number(value);
  if (!isFinite(number)) return 0;

  const settled = Number(number.toFixed(6));
  return settled < 0 ? -Math.round(-settled) : Math.round(settled);
}

/** Major units (12.34) to minor units (1234). */
function toMinor(amount) {
  return roundMinor((Number(amount) || 0) * 100);
}

/** Minor units (1234) back to major units (12.34) for display. */
function toMajor(minor) {
  return Math.round(Number(minor) || 0) / 100;
}

function multiply(minor, factor) {
  return roundMinor((Number(minor) || 0) * (Number(factor) || 0));
}

function divide(minor, divisor) {
  const by = Number(divisor) || 0;
  return by === 0 ? 0 : roundMinor((Number(minor) || 0) / by);
}

function sum(values) {
  return (values || []).reduce((total, value) => total + (Number(value) || 0), 0);
}

module.exports = { roundMinor, toMinor, toMajor, multiply, divide, sum };
