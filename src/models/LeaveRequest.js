'use strict';

const mongoose = require('mongoose');
const { LEAVE_TYPE_CODES, REQUEST_STATUSES, HALF_DAYS } = require('../config/leave');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const leaveRequestSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: [true, 'A leave request must belong to an employee'],
      index: true,
    },

    snapshot: {
      employeeCode: String,
      fullName: String,
      designation: String,
      department: String,
      team: String,
    },

    leaveType: {
      type: String,
      required: [true, 'Leave type is required'],
      enum: { values: LEAVE_TYPE_CODES, message: '{VALUE} is not a recognised leave type' },
      index: true,
    },

    fromDate: { type: Date, required: [true, 'Start date is required'] },
    toDate: { type: Date, required: [true, 'End date is required'] },
    halfDay: {
      type: String,
      enum: { values: HALF_DAYS, message: '{VALUE} is not a recognised half-day option' },
      default: '',
    },

    /** Working days actually charged, excluding rest days and holidays. */
    days: {
      type: Number,
      required: [true, 'Leave duration is required'],
      min: [0.5, 'Leave must cover at least half a day'],
    },

    reason: {
      type: String,
      required: [true, 'A reason is required'],
      trim: true,
      minlength: [8, 'Please give at least 8 characters of context'],
      maxlength: [400, 'Reason cannot exceed 400 characters'],
    },

    status: {
      type: String,
      enum: { values: REQUEST_STATUSES, message: '{VALUE} is not a recognised status' },
      default: 'pending',
      index: true,
    },

    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decisionNote: { type: String, trim: true, default: '', maxlength: 300 },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

leaveRequestSchema.index({ employee: 1, fromDate: 1, toDate: 1 });
leaveRequestSchema.index({ status: 1, createdAt: 1 });

leaveRequestSchema.virtual('isPending').get(function isPending() {
  return this.status === 'pending';
});

module.exports = mongoose.model('LeaveRequest', leaveRequestSchema);
