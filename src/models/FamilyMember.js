'use strict';

const mongoose = require('mongoose');
const { RELATIONSHIPS } = require('../config/org');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const contactSchema = new mongoose.Schema(
  {
    person: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    relationship: { type: String, enum: RELATIONSHIPS, default: 'other' },
    phone: { type: String, trim: true, default: '', maxlength: 30 },
    email: { type: String, lowercase: true, trim: true, default: '' },
    isEmergency: { type: Boolean, default: true },
    isDependent: { type: Boolean, default: false },
    isNominee: { type: Boolean, default: false },
    dateOfBirth: { type: Date, default: null },
    occupation: { type: String, trim: true, default: '' },
    benefitEligible: { type: Boolean, default: false },
    effectiveFrom: { type: Date, default: Date.now },
    effectiveTo: { type: Date, default: null },
    status: { type: String, enum: ['active', 'ended'], default: 'active' },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

module.exports = mongoose.model('FamilyMember', contactSchema);
