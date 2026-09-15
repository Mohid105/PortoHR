'use strict';

const CompensationRequest = require('../models/CompensationRequest');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { toMinor, toMajor } = require('../utils/money');
const { compensationType, metaPayload } = require('../config/finance');
const { createWorkflow } = require('../services/requestWorkflow');

function formatMoney(minor, currency) {
  return `${currency} ${toMajor(minor).toFixed(2)}`;
}

/**
 * There is no file storage here, so proof is a reference the approver can
 * follow: a link, or an identifier for a document held elsewhere. A value that
 * looks like a link is checked as one so a mistyped URL is caught on entry.
 */
function normaliseReceipt(value) {
  const proof = String(value || '').trim();
  if (!proof) return '';

  if (/^\w+:\/\//.test(proof) && !/^https?:\/\/\S+$/i.test(proof)) {
    throw ApiError.badRequest('A receipt link must be a valid http or https URL');
  }
  if (proof.length < 3) {
    throw ApiError.badRequest('Give a usable receipt link or reference');
  }
  return proof;
}

function buildPayload(body, employee) {
  const currency = (employee.compensation && employee.compensation.currency) || 'USD';

  const type = compensationType(body.type);
  if (!type) throw ApiError.badRequest('Choose a claim type');

  const requested = Number(body.amount);
  if (!isFinite(requested) || requested <= 0) {
    throw ApiError.badRequest('Enter a claim amount greater than zero');
  }

  const amount = toMinor(requested);
  const ceiling = toMinor(type.maxAmount);
  if (amount > ceiling) {
    throw ApiError.badRequest(
      `A ${type.label} claim cannot exceed ${formatMoney(ceiling, currency)}`
    );
  }

  const receiptProof = normaliseReceipt(body.receiptProof);
  if (type.requiresReceipt && !receiptProof) {
    throw ApiError.badRequest(`A ${type.label} claim needs a receipt link or reference`);
  }

  const note = String(body.note || '').trim();
  if (note.length > 300) throw ApiError.badRequest('Note cannot exceed 300 characters');

  return { type: type.value, amount, receiptProof, note };
}

const meta = asyncHandler(async (_req, res) => {
  res.json({ success: true, meta: metaPayload() });
});

const workflow = createWorkflow({
  Model: CompensationRequest,
  label: 'Compensation claim',
  buildPayload,
  event: 'compensation',
});

module.exports = Object.assign({ meta }, workflow);
