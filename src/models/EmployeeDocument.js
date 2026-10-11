'use strict';

const mongoose = require('mongoose');
const { DOCUMENT_TYPES, DOCUMENT_STATUSES, CONFIDENTIALITY } = require('../config/org');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

/**
 * Digital personnel-file index. Each row can hold an uploaded file (stored in
 * GridFS) and/or a reference; versions are new rows so a replace never
 * overwrites history.
 */
const documentSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    person: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', default: null },
    type: { type: String, enum: DOCUMENT_TYPES, required: true },
    title: { type: String, trim: true, default: '' },
    reference: { type: String, trim: true, default: '', maxlength: 300 },
    documentDate: { type: Date, default: Date.now },
    issuedOn: { type: Date, default: null },
    expiresOn: { type: Date, default: null },
    version: { type: Number, default: 1, min: 1 },
    verificationStatus: { type: String, enum: DOCUMENT_STATUSES, default: 'unverified' },
    confidentiality: { type: String, enum: CONFIDENTIALITY, default: 'general' },
    notes: { type: String, trim: true, default: '', maxlength: 300 },
    /** The stored file, once one has been attached (GridFS). Immutable: a replacement is a new version. */
    file: {
      id: { type: mongoose.Schema.Types.ObjectId, default: null },
      name: { type: String, default: '' },
      size: { type: Number, default: 0 },
      contentType: { type: String, default: '' },
      uploadedAt: { type: Date, default: null },
    },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

documentSchema.index({ employee: 1, type: 1, version: -1 });
documentSchema.index({ expiresOn: 1 });

module.exports = mongoose.model('EmployeeDocument', documentSchema);
