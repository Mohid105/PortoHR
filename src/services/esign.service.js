'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const SignaturePack = require('../models/SignaturePack');
const ApiError = require('../utils/ApiError');
const { ROLES } = require('../config/roles');
const { KIND_LABELS, STATUS_LABELS, TRANSITIONS, KINDS } = require('../config/esign');
const notifications = require('./notifications.service');

function asId(value) {
  return String((value && (value._id || value.id || value)) || '');
}

function snapshotOf(employee) {
  if (!employee) return { employeeCode: '', fullName: '', designation: '', department: '' };
  return {
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    designation: employee.designation,
    department: employee.department,
  };
}

function isoDay(value) {
  if (!value) return '';
  const day = new Date(value);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function hashBody(title, body) {
  return sha256(`${title}\n${body}`);
}

function hashContent(fields) {
  return sha256(
    JSON.stringify({
      code: fields.code,
      title: fields.title,
      body: fields.body,
      bodyHash: fields.bodyHash,
      employee: String(fields.employee),
      typedName: fields.typedName,
      signedAt: fields.signedAt,
    })
  );
}

async function nextCode() {
  const rows = await SignaturePack.find({ code: /^SIG-/ }).select('code').lean();
  let max = 1000;
  rows.forEach((row) => {
    const n = Number(String(row.code).replace(/\D/g, ''));
    if (n > max) max = n;
  });
  return `SIG-${max + 1}`;
}

function canSee(user, viewer, pack) {
  if (user.role === ROLES.HR_ADMIN) return true;
  return Boolean(viewer && String(pack.employee) === String(viewer._id));
}

function present(pack, options) {
  if (!pack) return null;
  const json = pack.toJSON ? pack.toJSON() : pack;
  const detail = options && options.detail;
  const bodyUnchanged = json.bodyHash === hashBody(json.title, json.body);
  const result = {
    id: String(json.id || json._id),
    code: json.code,
    employee: asId(json.employee),
    snapshot: json.snapshot || {},
    kind: json.kind,
    kindLabel: KIND_LABELS[json.kind] || json.kind,
    title: json.title,
    body: json.body,
    bodyHash: json.bodyHash,
    bodyUnchanged,
    dueOn: isoDay(json.dueOn),
    status: json.status,
    statusLabel: STATUS_LABELS[json.status] || json.status,
    sentAt: json.sentAt ? new Date(json.sentAt).toISOString() : '',
    typedName: json.typedName || '',
    strokeCount: json.strokeCount || 0,
    contentHash: json.contentHash || '',
    signedAt: json.signedAt ? new Date(json.signedAt).toISOString() : '',
    ip: json.ip || '',
    userAgent: json.userAgent || '',
    declineReason: json.declineReason || '',
    declinedAt: json.declinedAt ? new Date(json.declinedAt).toISOString() : '',
    cancelledAt: json.cancelledAt ? new Date(json.cancelledAt).toISOString() : '',
  };
  if (detail) result.signatureImage = json.signatureImage || '';
  return result;
}

function parseDueOn(value) {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  const parts = text.split('-').map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw ApiError.badRequest('Due date must be a calendar date');
  }
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

async function send(user, body) {
  if (!mongoose.isValidObjectId(body.employee)) throw ApiError.notFound('Employee not found');
  const employee = await Employee.findById(body.employee);
  if (!employee) throw ApiError.notFound('Employee not found');

  const kind = KINDS.indexOf(body.kind) === -1 ? 'generic' : body.kind;
  const title = String(body.title || '').trim();
  const text = String(body.body || '').trim();
  if (!title) throw ApiError.badRequest('A title is required');
  if (!text) throw ApiError.badRequest('Document text is required');

  const pack = await SignaturePack.create({
    code: await nextCode(),
    employee: employee._id,
    snapshot: snapshotOf(employee),
    kind,
    title,
    body: text,
    bodyHash: hashBody(title, text),
    dueOn: parseDueOn(body.dueOn),
    status: 'sent',
    sentBy: user._id,
    sentAt: new Date(),
  });

  await notifications.notifyEmployee('esign_sent', employee, {
    title,
    code: pack.code,
    signer: employee.fullName,
  });

  return present(pack, { detail: true });
}

async function list(user, viewer, query) {
  const filter = {};
  if (user.role !== ROLES.HR_ADMIN) {
    if (!viewer) return [];
    filter.employee = viewer._id;
  } else if (query.employee) {
    if (!mongoose.isValidObjectId(query.employee)) throw ApiError.notFound('Employee not found');
    filter.employee = query.employee;
  }
  if (query.status) filter.status = query.status;
  const rows = await SignaturePack.find(filter).sort({ createdAt: -1 }).limit(100);
  return rows.map((row) => present(row));
}

async function getOne(user, viewer, id, detail) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Signature pack not found');
  const pack = await SignaturePack.findById(id);
  if (!pack || !canSee(user, viewer, pack)) throw ApiError.notFound('Signature pack not found');
  return present(pack, { detail: Boolean(detail) });
}

async function loadOwned(user, viewer, id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Signature pack not found');
  const pack = await SignaturePack.findById(id);
  if (!pack) throw ApiError.notFound('Signature pack not found');
  if (!canSee(user, viewer, pack)) throw ApiError.notFound('Signature pack not found');
  return pack;
}

function assertTransition(pack, next) {
  const allowed = TRANSITIONS[pack.status] || [];
  if (allowed.indexOf(next) === -1) {
    throw ApiError.conflict(
      allowed.length
        ? `A ${STATUS_LABELS[pack.status].toLowerCase()} pack can only move to: ${allowed.join(', ')}`
        : `A ${STATUS_LABELS[pack.status].toLowerCase()} pack cannot be changed`
    );
  }
}

function assertSigner(viewer, pack) {
  if (!viewer || String(pack.employee) !== String(viewer._id)) {
    throw ApiError.forbidden('Only the named employee can sign this document');
  }
}

async function sign(user, viewer, id, body, meta) {
  const pack = await loadOwned(user, viewer, id);
  assertSigner(viewer, pack);
  assertTransition(pack, 'signed');

  const typedName = String((body && body.typedName) || '').trim();
  if (typedName.length < 3) throw ApiError.badRequest('Type your full name to sign');
  if (!(body && body.declare)) {
    throw ApiError.badRequest('You must confirm that this is your signature');
  }
  const strokes = Number((body && body.strokeCount) || 0);
  if (!isFinite(strokes) || strokes < 1) {
    throw ApiError.badRequest('Draw your signature before submitting');
  }
  const image = String((body && body.signatureImage) || '');
  if (!/^data:image\/png;base64,/.test(image) || image.length < 80) {
    throw ApiError.badRequest('A drawn signature is required');
  }
  if (image.length > 120000) throw ApiError.badRequest('Signature image is too large — try a shorter stroke');

  const signedAt = new Date();
  pack.status = 'signed';
  pack.typedName = typedName;
  pack.signatureImage = image;
  pack.strokeCount = strokes;
  pack.signedAt = signedAt;
  pack.signedBy = user._id;
  pack.ip = String((meta && meta.ip) || '').slice(0, 80);
  pack.userAgent = String((meta && meta.userAgent) || '').slice(0, 300);
  pack.contentHash = hashContent({
    code: pack.code,
    title: pack.title,
    body: pack.body,
    bodyHash: pack.bodyHash,
    employee: pack.employee,
    typedName,
    signedAt: signedAt.toISOString(),
  });
  await pack.save();
  return present(pack, { detail: true });
}

async function decline(user, viewer, id, body) {
  const pack = await loadOwned(user, viewer, id);
  assertSigner(viewer, pack);
  assertTransition(pack, 'declined');
  const reason = String((body && body.reason) || '').trim();
  if (!reason) throw ApiError.badRequest('A reason is required to decline');
  pack.status = 'declined';
  pack.declinedAt = new Date();
  pack.declineReason = reason;
  await pack.save();
  return present(pack);
}

async function cancel(user, id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Signature pack not found');
  const pack = await SignaturePack.findById(id);
  if (!pack) throw ApiError.notFound('Signature pack not found');
  assertTransition(pack, 'cancelled');
  pack.status = 'cancelled';
  pack.cancelledBy = user._id;
  pack.cancelledAt = new Date();
  await pack.save();
  return present(pack);
}

module.exports = {
  send,
  list,
  getOne,
  sign,
  decline,
  cancel,
  present,
  hashBody,
  hashContent,
};
