'use strict';

const mongoose = require('mongoose');
const { PLAN_CATEGORIES, PLAN_STATUSES } = require('../config/benefits');
const { CURRENCIES } = require('../config/hr');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const benefitPlanSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    summary: { type: String, trim: true, default: '', maxlength: 500 },
    category: { type: String, enum: PLAN_CATEGORIES, required: true, index: true },
    provider: { type: String, trim: true, default: '', maxlength: 80 },
    currency: { type: String, enum: CURRENCIES, default: 'USD' },
    eligibleGrades: { type: [String], default: [] },
    status: { type: String, enum: PLAN_STATUSES, default: 'published', index: true },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

module.exports = mongoose.model('BenefitPlan', benefitPlanSchema);
