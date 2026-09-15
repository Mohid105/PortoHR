'use strict';

const webhooks = require('../services/webhooks.service');
const asyncHandler = require('../utils/asyncHandler');

/** POST /api/integrations/inbox — HMAC-verified inbound webhook (no session). */
const receiveInbox = asyncHandler(async (req, res) => {
  const result = await webhooks.receiveInbox(req.headers, req.body || {});
  res.status(result.status).json({
    success: result.ok,
    message: result.message || (result.ok ? 'Accepted' : 'Rejected'),
    delivery: result.delivery,
  });
});

module.exports = { receiveInbox };
