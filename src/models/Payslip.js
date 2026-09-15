'use strict';

const mongoose = require('mongoose');
const { CURRENCIES, SHIFT_TYPES } = require('../config/hr');
const { PAYSLIP_STATUSES } = require('../config/payroll');

/**
 * EVERY money field on this model is an integer number of minor units (cents).
 * The controller converts to major units on the way out; nothing else should.
 */
const money = { type: Number, default: 0, min: 0 };

const lineSchema = new mongoose.Schema(
  { label: { type: String, required: true, trim: true }, amount: money },
  { _id: false }
);

const payslipSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: [true, 'A payslip must belong to an employee'],
      index: true,
    },

    /** Pay period as YYYY-MM. */
    month: {
      type: String,
      required: [true, 'Pay period is required'],
      match: [/^\d{4}-(0[1-9]|1[0-2])$/, 'Pay period must be in YYYY-MM format'],
      index: true,
    },

    currency: { type: String, enum: CURRENCIES, default: 'USD' },

    /**
     * The Core HR values as they stood when the payroll was run. A payslip is a
     * financial record: a later salary revision must not silently restate what
     * someone was paid last March.
     */
    snapshot: {
      employeeCode: String,
      fullName: String,
      designation: String,
      department: String,
      team: String,
      employmentType: String,
      shiftType: { type: String, enum: SHIFT_TYPES },
      dateOfJoining: Date,
      contractedBasic: money,
      contractedAllowances: { type: [lineSchema], default: [] },
      contractedGross: money,
    },

    period: {
      calendarDays: { type: Number, default: 0 },
      workingDays: { type: Number, default: 0 },
      employedWorkingDays: { type: Number, default: 0 },
      isComplete: { type: Boolean, default: true },
    },

    attendance: {
      presentDays: { type: Number, default: 0 },
      shortDays: { type: Number, default: 0 },
      absentDays: { type: Number, default: 0 },
      leaveDays: { type: Number, default: 0 },
      lwpDays: { type: Number, default: 0 },
      restDays: { type: Number, default: 0 },
      recordedDays: { type: Number, default: 0 },
      inProgressDays: { type: Number, default: 0 },
      hoursWorked: { type: Number, default: 0 },
      overtimeHours: { type: Number, default: 0 },
      shortfallHours: { type: Number, default: 0 },
    },

    rates: {
      hoursPerDay: { type: Number, default: 8 },
      perDayWage: money,
      hourlyRate: money,
      overtimeRate: money,
      overtimeMultiplier: { type: Number, default: 1.5 },
      prorationFactor: { type: Number, default: 1 },
    },

    earnings: {
      basic: money,
      allowances: { type: [lineSchema], default: [] },
      totalAllowances: money,
      overtimePay: money,
      gross: money,
    },

    deductions: {
      absence: money,
      shortDay: money,
      lwp: money,
      attendanceTotal: money,
      socialSecurity: money,
      socialSecurityBase: money,
      socialSecurityRate: { type: Number, default: 0 },
      incomeTax: money,
      total: money,
    },

    /** Kept so an employee can see exactly how their tax figure was reached. */
    incomeTaxDetail: {
      annualTaxable: { type: Number, default: 0 },
      annualTax: { type: Number, default: 0 },
      bands: {
        type: [
          new mongoose.Schema(
            {
              from: Number,
              to: { type: Number, default: null },
              rate: Number,
              taxable: Number,
              tax: Number,
            },
            { _id: false }
          ),
        ],
        default: [],
      },
    },

    taxableGross: money,
    netPay: money,

    /** Anything the run wants the reviewer to notice before approving. */
    warnings: { type: [String], default: [] },

    status: {
      type: String,
      enum: { values: PAYSLIP_STATUSES, message: '{VALUE} is not a recognised payslip status' },
      default: 'draft',
      index: true,
    },

    /** Which rule set produced these numbers. */
    engineVersion: { type: String, default: '' },

    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    generatedAt: { type: Date, default: Date.now },
    finalisedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, transform: (_doc, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  }
);

// One payslip per employee per month, and the index that serves the month view.
payslipSchema.index({ employee: 1, month: 1 }, { unique: true });
payslipSchema.index({ month: 1, status: 1 });

payslipSchema.virtual('isEditable').get(function isEditable() {
  return this.status === 'draft';
});

module.exports = mongoose.model('Payslip', payslipSchema);
