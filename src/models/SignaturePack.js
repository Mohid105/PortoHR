'use strict';

const mongoose = require('mongoose');
const { KINDS, STATUSES } = require('../config/esign');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const snapshotShape = {
  employeeCode: String,
  fullName: String,
  designation: String,
  department: String,
};

/**
 * A document sent for a named employee's signature. Body and bodyHash are
 * immutable after send; the signature and contentHash are the only later write.
 */
const signaturePackSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      match: [/^SIG-\d+$/, 'Pack code must look like SIG-1001'],
    },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    snapshot: snapshotShape,
    kind: { type: String, enum: KINDS, default: 'generic' },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    body: { type: String, required: true, trim: true, maxlength: 8000 },
    bodyHash: { type: String, required: true },
    dueOn: { type: Date, default: null },
    status: { type: String, enum: STATUSES, default: 'sent', index: true },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    sentAt: { type: Date, default: Date.now },
    typedName: { type: String, trim: true, default: '', maxlength: 120 },
    signatureImage: { type: String, default: '', maxlength: 120000 },
    strokeCount: { type: Number, default: 0 },
    contentHash: { type: String, default: '' },
    signedAt: { type: Date, default: null },
    signedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    ip: { type: String, default: '', maxlength: 80 },
    userAgent: { type: String, default: '', maxlength: 300 },
    declinedAt: { type: Date, default: null },
    declineReason: { type: String, trim: true, default: '', maxlength: 400 },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

signaturePackSchema.index({ employee: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('SignaturePack', signaturePackSchema);
