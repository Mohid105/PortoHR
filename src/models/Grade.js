'use strict';

const mongoose = require('mongoose');
const { GRADE_CATEGORIES } = require('../config/org');
const { CURRENCIES } = require('../config/hr');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

/** Compensation band. Positions inherit eligibility from grade, not from title. */
const gradeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    category: { type: String, enum: GRADE_CATEGORIES, default: 'management' },
    rank: { type: Number, required: true, min: 1, max: 99 },
    currency: { type: String, enum: CURRENCIES, default: 'PKR' },
    salaryMin: { type: Number, default: 0, min: 0 },
    salaryMid: { type: Number, default: 0, min: 0 },
    salaryMax: { type: Number, default: 0, min: 0 },
    probationDays: { type: Number, default: 90, min: 0 },
    noticeDays: { type: Number, default: 30, min: 0 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

module.exports = mongoose.model('Grade', gradeSchema);
