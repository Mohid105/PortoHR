'use strict';

const mongoose = require('mongoose');
const { COUNTRIES, FILING_FREQUENCIES, FILING_CATEGORIES } = require('../config/compliance');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

/**
 * A statutory filing cadence for the tenant country pack. Membership numbers
 * live on Core HR StatutoryEnrollment; this row only says when to file.
 */
const complianceRuleSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    country: { type: String, enum: COUNTRIES, default: 'PK' },
    category: { type: String, enum: FILING_CATEGORIES, required: true },
    authority: { type: String, trim: true, default: '', maxlength: 80 },
    frequency: { type: String, enum: FILING_FREQUENCIES, required: true },
    dueDay: { type: Number, default: 15, min: 1, max: 31 },
    dueMonth: { type: Number, default: null, min: 1, max: 12 },
    dueMonths: { type: [Number], default: [] },
    summary: { type: String, trim: true, default: '', maxlength: 400 },
    status: { type: String, enum: ['published', 'archived'], default: 'published' },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

module.exports = mongoose.model('ComplianceRule', complianceRuleSchema);
