'use strict';

const mongoose = require('mongoose');
const { RETENTION_CATEGORIES, RETENTION_ACTIONS } = require('../config/compliance');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

/**
 * Policy only — this release does not run archival or anonymization jobs.
 */
const retentionRuleSchema = new mongoose.Schema(
  {
    category: { type: String, enum: RETENTION_CATEGORIES, required: true, unique: true },
    years: { type: Number, required: true, min: 1, max: 25 },
    action: { type: String, enum: RETENTION_ACTIONS, default: 'archive' },
    notes: { type: String, trim: true, default: '', maxlength: 300 },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

module.exports = mongoose.model('RetentionRule', retentionRuleSchema);
