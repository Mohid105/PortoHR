'use strict';

const mongoose = require('mongoose');
const { DELIVERY_MODES, COURSE_STATUSES } = require('../config/lms');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const courseSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    summary: { type: String, trim: true, default: '', maxlength: 600 },
    delivery: {
      type: String,
      enum: DELIVERY_MODES,
      default: 'elearning',
      index: true,
    },
    durationHours: { type: Number, default: 1, min: 0.5, max: 80 },
    competencies: { type: [String], default: [] },
    prerequisites: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Course' }], default: [] },
    mandatory: { type: Boolean, default: false, index: true },
    issuesCertificate: { type: Boolean, default: false },
    validityMonths: { type: Number, default: 0, min: 0, max: 120 },
    url: { type: String, trim: true, default: '', maxlength: 300 },
    provider: { type: String, trim: true, default: '', maxlength: 80 },
    status: {
      type: String,
      enum: COURSE_STATUSES,
      default: 'published',
      index: true,
    },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

courseSchema.index({ status: 1, title: 1 });

module.exports = mongoose.model('Course', courseSchema);
