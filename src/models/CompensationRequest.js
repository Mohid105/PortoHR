'use strict';

const mongoose = require('mongoose');
const { CURRENCIES } = require('../config/hr');
const { REQUEST_STATUSES, COMPENSATION_TYPE_VALUES } = require('../config/finance');

/** Amounts are integer minor units (cents), matching Payroll. */
const compensationRequestSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: [true, 'A claim must belong to an employee'],
      index: true,
    },

    snapshot: {
      employeeCode: String,
      fullName: String,
      designation: String,
      department: String,
    },

    currency: { type: String, enum: CURRENCIES, default: 'USD' },

    type: {
      type: String,
      required: [true, 'Claim type is required'],
      enum: { values: COMPENSATION_TYPE_VALUES, message: '{VALUE} is not a claimable type' },
      index: true,
    },

    amount: {
      type: Number,
      required: [true, 'Claim amount is required'],
      min: [1, 'Claim amount must be greater than zero'],
    },

    /**
     * A link to, or reference for, the supporting document. There is no file
     * storage in this deployment, so the claim carries the reference and the
     * approver follows it — required for claim types that reimburse spend.
     */
    receiptProof: { type: String, trim: true, default: '', maxlength: 300 },

    note: { type: String, trim: true, default: '', maxlength: 300 },

    status: {
      type: String,
      enum: { values: REQUEST_STATUSES, message: '{VALUE} is not a recognised status' },
      default: 'pending',
      index: true,
    },

    decisionNote: { type: String, trim: true, default: '', maxlength: 300 },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, transform: (_doc, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  }
);

compensationRequestSchema.index({ status: 1, createdAt: -1 });

compensationRequestSchema.virtual('isPending').get(function isPending() {
  return this.status === 'pending';
});

module.exports = mongoose.model('CompensationRequest', compensationRequestSchema);
