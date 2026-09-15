'use strict';

const mongoose = require('mongoose');
const { SOURCES } = require('../config/recruitment');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const candidateSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 50 },
    lastName: { type: String, required: true, trim: true, maxlength: 50 },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, trim: true, default: '', maxlength: 30 },
    source: { type: String, enum: SOURCES, default: 'career_site' },
    resumeUrl: { type: String, trim: true, default: '', maxlength: 300 },
    tags: { type: [String], default: [] },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

candidateSchema.index({ email: 1 });
candidateSchema.virtual('fullName').get(function fullName() {
  return `${this.firstName} ${this.lastName}`.trim();
});

module.exports = mongoose.model('Candidate', candidateSchema);
