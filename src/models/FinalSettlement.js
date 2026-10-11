'use strict';

const mongoose = require('mongoose');
const { SETTLEMENT } = require('../config/settlement');

/**
 * A full-and-final settlement bill. Every amount is an integer number of minor
 * units. `netPayable` may be negative: it then means the employee owes the
 * company, which HR recovers outside payroll.
 */
const money = { type: Number, default: 0 };

const lineSchema = new mongoose.Schema(
  { label: { type: String, required: true, trim: true, maxlength: 80 }, amount: { type: Number, required: true, min: 0 } },
  { _id: false }
);

const leaveLineSchema = new mongoose.Schema(
  {
    leaveType: String,
    label: String,
    accruedDays: Number,
    takenDays: Number,
    balanceDays: Number,
  },
  { _id: false }
);

const settlementSchema = new mongoose.Schema(
  {
    requestNo: { type: String, required: true, unique: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    currency: { type: String, default: 'PKR' },

    snapshot: {
      employeeCode: String,
      fullName: String,
      fatherName: String,
      nationalId: String,
      designation: String,
      department: String,
      team: String,
      address: String,
      dateOfJoining: Date,
      dateOfRelieving: Date,
      quitReason: String,
      serviceYears: Number,
      serviceMonths: Number,
    },

    /** The days that explain the pro-rated last month. */
    days: {
      month: String,
      restDay: String,
      skipDays: { type: Number, default: 0 },
      absentDays: { type: Number, default: 0 },
      withoutPayLeaveDays: { type: Number, default: 0 },
      attendanceDays: { type: Number, default: 0 },
    },

    unadjustedGross: money,
    adjustedGross: money,
    longServiceAllowance: money,
    netSalaryPayable: money,

    perDayRate: money,
    leave: { type: [leaveLineSchema], default: [] },
    leaveEncashmentDays: { type: Number, default: 0 },
    leaveEncashment: money,
    additions: { type: [lineSchema], default: [] },
    finalSettlement: money,

    deductions: {
      longServiceDeduction: money,
      shortTermLoan: money,
      excessPaidSalary: money,
      excessLeaveDays: { type: Number, default: 0 },
      excessLeaveRecovery: money,
      others: { type: [lineSchema], default: [] },
      total: money,
    },
    netPayable: money,

    notes: { type: String, trim: true, default: '', maxlength: 400 },
    warnings: { type: [String], default: [] },

    status: { type: String, enum: SETTLEMENT.statuses, default: 'draft', index: true },
    preparedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    preparedByName: { type: String, default: '' },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedByName: { type: String, default: '' },
    approvedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    paymentRef: { type: String, trim: true, default: '', maxlength: 80 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, transform: (_doc, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  }
);

module.exports = mongoose.model('FinalSettlement', settlementSchema);
