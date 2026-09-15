'use strict';

const mongoose = require('mongoose');
const { LICENSE_KINDS, LICENSE_SCOPES, LICENSE_STATUSES } = require('../config/compliance');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const licenseSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    kind: { type: String, enum: LICENSE_KINDS, required: true },
    scope: { type: String, enum: LICENSE_SCOPES, default: 'company' },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },
    snapshot: {
      employeeCode: String,
      fullName: String,
      designation: String,
      department: String,
    },
    issuer: { type: String, trim: true, default: '', maxlength: 80 },
    reference: { type: String, trim: true, default: '', maxlength: 80 },
    issuedOn: { type: Date, default: null },
    expiresOn: { type: Date, default: null, index: true },
    documentUrl: { type: String, trim: true, default: '', maxlength: 300 },
    status: { type: String, enum: LICENSE_STATUSES, default: 'active', index: true },
    notes: { type: String, trim: true, default: '', maxlength: 400 },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

module.exports = mongoose.model('License', licenseSchema);
