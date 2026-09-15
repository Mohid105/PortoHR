'use strict';

const mongoose = require('mongoose');
const { CURRENCIES } = require('../config/hr');
const { ARREARS_STATUSES } = require('../config/payroll');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

/** Signed cents — a recovery (negative delta) is a valid arrears outcome. */
const signedMoney = { type: Number, default: 0 };

const snapshotShape = {
  employeeCode: String,
  fullName: String,
  designation: String,
  department: String,
};

/**
 * A closed-period correction. The original payslip is never rewritten; this
 * row is the only place the delta lives.
 */
const arrearsAdjustmentSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    sourcePayslip: { type: mongoose.Schema.Types.ObjectId, ref: 'Payslip', required: true },
    sourceMonth: {
      type: String,
      required: true,
      match: [/^\d{4}-(0[1-9]|1[0-2])$/, 'Pay period must be in YYYY-MM format'],
      index: true,
    },
    settlementMonth: { type: String, default: '' },
    currency: { type: String, enum: CURRENCIES, default: 'USD' },
    snapshot: snapshotShape,
    reason: { type: String, trim: true, default: '', maxlength: 400 },
    whatIf: { type: mongoose.Schema.Types.Mixed, default: null },
    originalGross: signedMoney,
    originalNet: signedMoney,
    recomputedGross: signedMoney,
    recomputedNet: signedMoney,
    deltaGross: signedMoney,
    deltaNet: signedMoney,
    status: { type: String, enum: ARREARS_STATUSES, default: 'simulated', index: true },
    simulatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    simulatedAt: { type: Date, default: Date.now },
    postedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

arrearsAdjustmentSchema.index({ employee: 1, sourceMonth: 1, status: 1 });

module.exports = mongoose.model('ArrearsAdjustment', arrearsAdjustmentSchema);
