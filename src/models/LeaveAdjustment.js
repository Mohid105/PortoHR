'use strict';

const mongoose = require('mongoose');
const { LEAVE_TYPE_CODES } = require('../config/leave');

/**
 * A manual credit (or debit) to one person's leave balance for a year: days of
 * compensatory leave earned, a correction, an opening balance on migration.
 */
const leaveAdjustmentSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    leaveType: { type: String, enum: LEAVE_TYPE_CODES, required: true },
    year: { type: Number, required: true, min: 2000, max: 2100 },
    days: { type: Number, required: true, min: -365, max: 365 },
    reason: { type: String, required: true, trim: true, minlength: 4, maxlength: 200 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, transform: (_doc, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  }
);

leaveAdjustmentSchema.index({ employee: 1, leaveType: 1, year: 1 });

module.exports = mongoose.model('LeaveAdjustment', leaveAdjustmentSchema);
