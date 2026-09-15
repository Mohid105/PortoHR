'use strict';

const Loan = require('../models/Loan');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { toMinor, toMajor } = require('../utils/money');
const { LOAN, metaPayload } = require('../config/finance');
const { createWorkflow } = require('../services/requestWorkflow');
const { instalments } = require('../services/loanMath');

function formatMoney(minor, currency) {
  return `${currency} ${toMajor(minor).toFixed(2)}`;
}

function buildPayload(body, employee) {
  const currency = (employee.compensation && employee.compensation.currency) || 'USD';

  const requested = Number(body.amount);
  if (!isFinite(requested) || requested <= 0) {
    throw ApiError.badRequest('Enter a loan amount greater than zero');
  }

  const amount = toMinor(requested);
  const floor = toMinor(LOAN.minAmount);
  if (amount < floor) {
    throw ApiError.badRequest(`The smallest loan we process is ${formatMoney(floor, currency)}`);
  }

  // The ceiling is a multiple of gross pay, so it scales with the applicant.
  const ceiling = toMinor(employee.grossSalary) * LOAN.maxSalaryMultiple;
  if (amount > ceiling) {
    throw ApiError.badRequest(
      `A loan cannot exceed ${LOAN.maxSalaryMultiple} months of gross salary, which is ${formatMoney(ceiling, currency)} for you`
    );
  }

  const months = Number(body.repaymentMonths);
  if (!Number.isInteger(months) || months < LOAN.minRepaymentMonths || months > LOAN.maxRepaymentMonths) {
    throw ApiError.badRequest(
      `Repayment must be a whole number of months between ${LOAN.minRepaymentMonths} and ${LOAN.maxRepaymentMonths}`
    );
  }

  const reason = String(body.reason || '').trim();
  if (reason.length < LOAN.minReasonLength) {
    throw ApiError.badRequest(`Please describe what the loan is for in at least ${LOAN.minReasonLength} characters`);
  }
  if (reason.length > LOAN.maxReasonLength) {
    throw ApiError.badRequest(`Reason cannot exceed ${LOAN.maxReasonLength} characters`);
  }

  return Object.assign({ amount, reason, repaymentMonths: months }, instalments(amount, months));
}

const meta = asyncHandler(async (_req, res) => {
  res.json({ success: true, meta: metaPayload() });
});

const workflow = createWorkflow({ Model: Loan, label: 'Loan request', buildPayload, event: 'loan' });

module.exports = Object.assign({ meta }, workflow);
