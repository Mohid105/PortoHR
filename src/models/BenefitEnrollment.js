'use strict';

const mongoose = require('mongoose');
const { ENROLLMENT_STATUSES, ENROLLMENT_SOURCES, LIFE_EVENTS } = require('../config/benefits');
const { CURRENCIES } = require('../config/hr');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

/**
 * An employee's election on a benefit plan. `employee` is the learner of the
 * coverage so the shared approval inbox can scope life-event requests.
 */
const benefitEnrollmentSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    snapshot: {
      employeeCode: String,
      fullName: String,
      designation: String,
      department: String,
      grade: String,
    },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'BenefitPlan', required: true, index: true },
    option: { type: mongoose.Schema.Types.ObjectId, ref: 'PlanOption', required: true },
    dependents: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FamilyMember' }], default: [] },
    source: { type: String, enum: ENROLLMENT_SOURCES, default: 'open_enrollment' },
    lifeEvent: { type: String, enum: [...LIFE_EVENTS, ''], default: '' },
    evidenceUrl: { type: String, trim: true, default: '', maxlength: 300 },
    reason: { type: String, trim: true, default: '', maxlength: 400 },
    currency: { type: String, enum: CURRENCIES, default: 'USD' },
    employerAmount: { type: Number, required: true, min: 0 },
    employeeAmount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ENROLLMENT_STATUSES,
      default: 'pending',
      index: true,
    },
    replaces: { type: mongoose.Schema.Types.ObjectId, ref: 'BenefitEnrollment', default: null },
    effectiveFrom: { type: Date, default: Date.now },
    effectiveTo: { type: Date, default: null },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decisionNote: { type: String, trim: true, default: '', maxlength: 300 },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

benefitEnrollmentSchema.index(
  { employee: 1, plan: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } }
);
benefitEnrollmentSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model('BenefitEnrollment', benefitEnrollmentSchema);
