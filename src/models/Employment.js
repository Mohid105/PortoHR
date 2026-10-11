'use strict';

const mongoose = require('mongoose');
const { EMPLOYMENT_TYPES, EMPLOYMENT_STATUSES } = require('../config/hr');
const { EMPLOYEE_CATEGORIES, PAY_GROUPS, SEPARATION_TYPES } = require('../config/org');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

/**
 * One contractual relationship with the company. Rehire creates a second
 * Employment on the same Person; Employee.employment points at the current one.
 */
const employmentSchema = new mongoose.Schema(
  {
    person: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Person',
      required: [true, 'Employment must belong to a person'],
      index: true,
    },
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: [true, 'Employment must belong to a directory record'],
    },
    employeeCode: {
      type: String,
      required: [true, 'Employee code is required'],
      trim: true,
      uppercase: true,
      match: [/^[A-Z0-9-]{3,20}$/, 'Employee code may only contain letters, numbers and hyphens'],
    },
    email: {
      type: String,
      required: [true, 'Work email is required'],
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address'],
    },
    phone: { type: String, trim: true, default: '', maxlength: [30, 'Phone number cannot exceed 30 characters'] },
    address: { type: String, trim: true, default: '', maxlength: 200 },
    legalEntity: { type: String, trim: true, default: 'PortoHR (Pvt) Ltd' },
    location: { type: String, trim: true, maxlength: 80, default: 'Karachi HQ' },
    employeeCategory: { type: String, enum: [...EMPLOYEE_CATEGORIES, ''], default: 'non_executive' },
    payGroup: { type: String, enum: [...PAY_GROUPS, ''], default: 'monthly_intl' },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, default: 'full_time' },
    employmentStatus: {
      type: String,
      enum: { values: EMPLOYMENT_STATUSES, message: '{VALUE} is not a recognised status' },
      default: 'probation',
      index: true,
    },
    originalHireDate: { type: Date, default: null },
    dateOfJoining: { type: Date, required: [true, 'Date of joining is required'] },
    probationEndDate: { type: Date, default: null },
    confirmationDate: { type: Date, default: null },
    annualLeaveDays: {
      type: Number,
      default: 20,
      min: [0, 'Leave entitlement cannot be negative'],
      max: [365, 'Leave entitlement cannot exceed 365 days'],
    },
    lastWorkingDay: { type: Date, default: null },
    terminationDate: { type: Date, default: null },
    separationType: { type: String, enum: [...SEPARATION_TYPES, ''], default: '' },
    separationReason: { type: String, trim: true, default: '', maxlength: 300 },
    rehireEligible: { type: Boolean, default: true },
    isCurrent: { type: Boolean, default: true, index: true },
    userAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

employmentSchema.index({ employee: 1, isCurrent: 1 });
employmentSchema.index({ employeeCode: 1, isCurrent: 1 });

module.exports = mongoose.model('Employment', employmentSchema);
