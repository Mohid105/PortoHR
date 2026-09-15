'use strict';

const mongoose = require('mongoose');
const { CURRENCIES } = require('../config/hr');
const { REQUEST_STATUSES, LOAN } = require('../config/finance');

/**
 * Amounts are integer minor units (cents), matching Payroll. The controller
 * converts to major units on the way out.
 */
const loanSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: [true, 'A loan request must belong to an employee'],
      index: true,
    },

    /** Who the request looked like when it was raised, for the approval queue. */
    snapshot: {
      employeeCode: String,
      fullName: String,
      designation: String,
      department: String,
    },

    currency: { type: String, enum: CURRENCIES, default: 'USD' },

    amount: {
      type: Number,
      required: [true, 'Loan amount is required'],
      min: [1, 'Loan amount must be greater than zero'],
    },

    reason: {
      type: String,
      required: [true, 'A reason is required'],
      trim: true,
      minlength: [LOAN.minReasonLength, `Please give at least ${LOAN.minReasonLength} characters of context`],
      maxlength: [LOAN.maxReasonLength, `Reason cannot exceed ${LOAN.maxReasonLength} characters`],
    },

    repaymentMonths: {
      type: Number,
      required: [true, 'Repayment period is required'],
      min: [LOAN.minRepaymentMonths, `Repayment must be at least ${LOAN.minRepaymentMonths} month`],
      max: [LOAN.maxRepaymentMonths, `Repayment cannot exceed ${LOAN.maxRepaymentMonths} months`],
    },

    /**
     * Instalments are stored rather than derived so the schedule shown at
     * approval is the schedule on record. The final one absorbs the rounding
     * remainder, so the instalments always sum to exactly the principal.
     */
    monthlyInstalment: { type: Number, default: 0, min: 0 },
    finalInstalment: { type: Number, default: 0, min: 0 },

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

// Serves both the approval queue and an employee's own history.
loanSchema.index({ status: 1, createdAt: -1 });

loanSchema.virtual('isPending').get(function isPending() {
  return this.status === 'pending';
});

module.exports = mongoose.model('Loan', loanSchema);
