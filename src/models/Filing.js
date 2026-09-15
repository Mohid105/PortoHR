'use strict';

const mongoose = require('mongoose');
const { FILING_STATUSES } = require('../config/compliance');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const filingSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    rule: { type: mongoose.Schema.Types.ObjectId, ref: 'ComplianceRule', required: true, index: true },
    dueOn: { type: Date, required: true, index: true },
    periodLabel: { type: String, trim: true, default: '' },
    status: { type: String, enum: FILING_STATUSES, default: 'upcoming', index: true },
    reference: { type: String, trim: true, default: '', maxlength: 80 },
    notes: { type: String, trim: true, default: '', maxlength: 400 },
    filedOn: { type: Date, default: null },
    filedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

filingSchema.index({ rule: 1, dueOn: 1 }, { unique: true });

module.exports = mongoose.model('Filing', filingSchema);
