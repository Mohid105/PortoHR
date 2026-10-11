'use strict';

const mongoose = require('mongoose');

/**
 * Month-specific pay items that are neither on the contract nor on the time
 * clock: an incentive, a mess bill, a one-off recovery. Amounts are integer
 * minor units, like everything else in Payroll.
 */
const money = { type: Number, default: 0, min: 0 };

const payrollInputSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/, index: true },
    incentive: money,
    medicalAllowance: money,
    otherEarnings: money,
    messCharges: money,
    otherDeductions: money,
    /** Overrides the hours derived from attendance when the time office supplies a figure. */
    gazettedHolidayHours: { type: Number, default: null, min: 0 },
    note: { type: String, trim: true, default: '', maxlength: 200 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, transform: (_doc, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  }
);

payrollInputSchema.index({ employee: 1, month: 1 }, { unique: true });

module.exports = mongoose.model('PayrollInput', payrollInputSchema);
