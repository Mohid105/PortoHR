'use strict';

const mongoose = require('mongoose');
const { POSITION_STATUSES, ORG_ROLES } = require('../config/org');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

/**
 * An approved seat in the organization. Each active employee occupies one
 * position; the title catalogue lives on Job so two seats can share a profile.
 */
const positionSchema = new mongoose.Schema(
  {
    positionCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
    title: {
      type: String,
      required: [true, 'Position title is required'],
      trim: true,
      maxlength: [80, 'Position title cannot exceed 80 characters'],
    },
    /** Kept for older title-catalogue rows; no longer unique. */
    titleKey: { type: String, lowercase: true, trim: true, default: '' },
    job: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', default: null },
    grade: { type: mongoose.Schema.Types.ObjectId, ref: 'Grade', default: null },
    team: { type: mongoose.Schema.Types.ObjectId, ref: 'OrgUnit', default: null },
    orgRole: { type: String, enum: [...ORG_ROLES, ''], default: 'worker' },
    reportsToPosition: { type: mongoose.Schema.Types.ObjectId, ref: 'Position', default: null },
    location: { type: String, trim: true, default: '' },
    costCenter: { type: String, trim: true, default: '' },
    fte: { type: Number, default: 1, min: 0.1, max: 2 },
    status: { type: String, enum: POSITION_STATUSES, default: 'approved', index: true },
    incumbent: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    effectiveFrom: { type: Date, default: Date.now },
    effectiveTo: { type: Date, default: null },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

positionSchema.pre('validate', function setTitleKey(next) {
  if (this.title) this.titleKey = this.title.trim().toLowerCase();
  next();
});

positionSchema.index({ team: 1, status: 1 });
positionSchema.index({ incumbent: 1 });

module.exports = mongoose.model('Position', positionSchema);
