'use strict';

const mongoose = require('mongoose');
const { LEAVE_TYPE_CODES } = require('../config/leave');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

/**
 * Catalogue of leave kinds a tenant may grant. Seeded from config; kept as a
 * collection so HR can later tune entitlements without a deploy.
 */
const leaveTypeSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      enum: { values: LEAVE_TYPE_CODES, message: '{VALUE} is not a recognised leave type' },
    },
    label: { type: String, required: true, trim: true, maxlength: 60 },
    paid: { type: Boolean, default: true },
    entitlementFromEmployment: { type: Boolean, default: false },
    defaultEntitlement: { type: Number, default: 0, min: 0, max: 365 },
    carryForwardDays: { type: Number, default: 0, min: 0, max: 365 },
    requiresApproval: { type: Boolean, default: true },
    hint: { type: String, trim: true, default: '', maxlength: 240 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

module.exports = mongoose.model('LeaveType', leaveTypeSchema);
