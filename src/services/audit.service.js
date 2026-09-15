'use strict';

const AuditLog = require('../models/AuditLog');

async function record(req, fields) {
  try {
    const user = req && req.user;
    await AuditLog.create({
      actor: user && user._id,
      actorName: user ? `${user.firstName} ${user.lastName}`.trim() : '',
      role: user && user.role,
      ip: req && (req.ip || ''),
      ...fields,
    });
  } catch (err) {
    // Audit must never fail the business transaction.
  }
}

function present(doc) {
  if (!doc) return null;
  const json = doc.toJSON ? doc.toJSON() : doc;
  json.id = String(json.id || json._id);
  return json;
}

module.exports = { record, present };
