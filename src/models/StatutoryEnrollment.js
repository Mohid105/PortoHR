'use strict';

const mongoose = require('mongoose');
const { STATUTORY_SCHEMES } = require('../config/org');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const statutorySchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    person: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', default: null },
    scheme: { type: String, enum: STATUTORY_SCHEMES, required: true },
    covered: { type: Boolean, default: true },
    membershipNumber: { type: String, trim: true, default: '' },
    effectiveFrom: { type: Date, default: Date.now },
    effectiveTo: { type: Date, default: null },
    status: { type: String, enum: ['pending', 'active', 'ended', 'rejected'], default: 'pending' },
    reason: { type: String, trim: true, default: '' },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, trim: true, default: '' },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

statutorySchema.index({ employee: 1, scheme: 1, status: 1 });

module.exports = mongoose.model('StatutoryEnrollment', statutorySchema);
