'use strict';

const mongoose = require('mongoose');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const planOptionSchema = new mongoose.Schema(
  {
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'BenefitPlan', required: true, index: true },
    code: { type: String, required: true, uppercase: true, trim: true, maxlength: 20 },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    summary: { type: String, trim: true, default: '', maxlength: 300 },
    employerAmount: { type: Number, required: true, min: 0 },
    employeeAmount: { type: Number, required: true, min: 0 },
    maxDependents: { type: Number, default: 0, min: 0, max: 12 },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

planOptionSchema.index({ plan: 1, code: 1 }, { unique: true });

module.exports = mongoose.model('PlanOption', planOptionSchema);
