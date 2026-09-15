'use strict';

const mongoose = require('mongoose');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

/** Technical audit of create/update/approve/reject/export actions. */
const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorName: { type: String, default: '' },
    role: { type: String, default: '' },
    action: { type: String, required: true, trim: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    objectType: { type: String, default: '' },
    objectId: { type: String, default: '' },
    summary: { type: String, trim: true, default: '', maxlength: 400 },
    previousValue: { type: mongoose.Schema.Types.Mixed, default: null },
    newValue: { type: mongoose.Schema.Types.Mixed, default: null },
    ip: { type: String, default: '' },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

auditLogSchema.index({ employee: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
