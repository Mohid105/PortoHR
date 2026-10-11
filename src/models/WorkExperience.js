'use strict';

const mongoose = require('mongoose');

/** Employment held before joining (or outside) this company. */
const workExperienceSchema = new mongoose.Schema(
  {
    person: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true, index: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    organization: { type: String, required: true, trim: true, maxlength: 120 },
    fromYear: { type: Number, default: null, min: 1950, max: 2100 },
    toYear: { type: Number, default: null, min: 1950, max: 2100 },
    designation: { type: String, trim: true, default: '', maxlength: 100 },
    leavingCause: { type: String, trim: true, default: '', maxlength: 120 },
    description: { type: String, trim: true, default: '', maxlength: 300 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, transform: (_doc, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  }
);

module.exports = mongoose.model('WorkExperience', workExperienceSchema);
