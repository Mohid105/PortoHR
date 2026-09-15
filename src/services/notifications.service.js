'use strict';

const NotificationLog = require('../models/NotificationLog');
const NotificationTemplate = require('../models/NotificationTemplate');
const User = require('../models/User');

function present(doc) {
  if (!doc) return null;
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  return json;
}

function applyTokens(text, tokens) {
  return String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_all, key) => {
    if (tokens[key] === undefined || tokens[key] === null) return '';
    return String(tokens[key]);
  });
}

async function userForEmployee(employee) {
  if (!employee) return null;
  if (employee.userAccount) {
    const linked = await User.findById(employee.userAccount);
    if (linked) return linked;
  }
  return User.findOne({
    $or: [{ email: employee.email }, { employeeId: employee.employeeCode }],
  });
}

function outboundChannel(channel) {
  return channel === 'email' || channel === 'sms';
}

function destinationFor(user, channel) {
  if (channel === 'email') return user.email || '';
  if (channel === 'sms') return user.phone || '';
  return '';
}

async function writeLog(user, fields) {
  if (!user) return null;
  const channel = fields.channel || 'in_app';
  const queued = outboundChannel(channel);
  const row = await NotificationLog.create({
    user: user._id,
    channel,
    templateCode: fields.templateCode || '',
    title: fields.title,
    body: fields.body || '',
    status: queued ? 'queued' : 'delivered',
    destination: fields.destination || destinationFor(user, channel),
    lastError: queued
      ? process.env.SMTP_HOST
        ? 'SMTP_HOST is set but PortoHR has no mailer — held in the outbox'
        : 'No SMTP_HOST — held in the outbox'
      : '',
    sentAt: queued ? null : new Date(),
  });
  return present(row);
}

async function dispatch(code, user, tokens) {
  const template = await NotificationTemplate.findOne({ code, active: true });
  const title = template ? applyTokens(template.subject || template.name, tokens || {}) : code;
  const body = template ? applyTokens(template.body, tokens || {}) : '';
  return writeLog(user, {
    channel: (template && template.channel) || 'in_app',
    templateCode: code,
    title,
    body,
  });
}

async function notifyEmployee(code, employee, tokens) {
  const user = await userForEmployee(employee);
  if (!user) return null;
  return dispatch(code, user, tokens);
}

async function listForUser(user, query) {
  const filter = { user: user._id, channel: 'in_app' };
  if (query && query.unread === 'true') filter.readAt = null;
  const rows = await NotificationLog.find(filter).sort({ createdAt: -1 }).limit(80);
  const unread = await NotificationLog.countDocuments({ user: user._id, channel: 'in_app', readAt: null });
  return { unread, notifications: rows.map(present) };
}

async function markRead(user, id) {
  const row = await NotificationLog.findOne({ _id: id, user: user._id });
  if (!row) return null;
  if (!row.readAt) {
    row.readAt = new Date();
    await row.save();
  }
  return present(row);
}

async function markAllRead(user) {
  await NotificationLog.updateMany({ user: user._id, channel: 'in_app', readAt: null }, { $set: { readAt: new Date() } });
  return listForUser(user);
}

async function listOutbox() {
  const rows = await NotificationLog.find({ channel: { $in: ['email', 'sms'] } })
    .populate('user', 'email firstName lastName')
    .sort({ createdAt: -1 })
    .limit(80);
  return rows.map((row) => {
    const json = present(row);
    json.userName = row.user
      ? `${row.user.firstName || ''} ${row.user.lastName || ''}`.trim() || row.user.email
      : '';
    json.userEmail = row.user && row.user.email ? row.user.email : '';
    if (json.user && typeof json.user === 'object') json.user = String(json.user._id || json.user.id || json.user);
    return json;
  });
}

module.exports = {
  present,
  writeLog,
  dispatch,
  notifyEmployee,
  listForUser,
  markRead,
  markAllRead,
  listOutbox,
  userForEmployee,
};
