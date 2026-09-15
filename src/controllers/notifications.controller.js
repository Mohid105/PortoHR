'use strict';

const notifications = require('../services/notifications.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

const list = asyncHandler(async (req, res) => {
  const payload = await notifications.listForUser(req.user, req.query || {});
  res.json({ success: true, ...payload });
});

const markRead = asyncHandler(async (req, res) => {
  const row = await notifications.markRead(req.user, req.params.id);
  if (!row) throw ApiError.notFound('Notification not found');
  res.json({ success: true, notification: row });
});

const markAllRead = asyncHandler(async (req, res) => {
  const payload = await notifications.markAllRead(req.user);
  res.json({ success: true, ...payload });
});

module.exports = { list, markRead, markAllRead };
