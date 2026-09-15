'use strict';

const mongoose = require('mongoose');
const { SHIFT_TYPES } = require('../config/hr');
const { SHIFT_STATUSES } = require('../config/attendance');

const attendanceSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: [true, 'Attendance must belong to an employee'],
      index: true,
    },

    /** UTC midnight of the calendar day this record covers. */
    date: { type: Date, required: [true, 'Attendance date is required'] },

    timeIn: { type: Date, default: null },
    timeOut: { type: Date, default: null },

    /**
     * The shift is snapshotted at clock-in. Moving someone onto a new roster
     * later must not silently rewrite what their past days were measured against.
     */
    shiftType: { type: String, enum: SHIFT_TYPES, default: 'general' },
    expectedHours: { type: Number, default: 0, min: 0 },

    hoursWorked: { type: Number, default: 0, min: [0, 'Hours worked cannot be negative'] },
    overtimeHours: { type: Number, default: 0, min: [0, 'Overtime cannot be negative'] },
    shortfallHours: { type: Number, default: 0, min: [0, 'Shortfall cannot be negative'] },

    shiftStatus: {
      type: String,
      enum: { values: SHIFT_STATUSES, message: '{VALUE} is not a recognised attendance status' },
      default: 'present',
      index: true,
    },

    notes: { type: String, trim: true, default: '', maxlength: 200 },

    /** Set when HR overrides a day rather than the employee clocking it. */
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    /** Set when an approved leave request posted this day, so cancellation can unwind it. */
    leaveRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'LeaveRequest', default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, transform: (_doc, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  }
);

// One record per employee per day; also the index that serves the month query.
attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });

attendanceSchema.virtual('isOpen').get(function isOpen() {
  return Boolean(this.timeIn && !this.timeOut);
});

module.exports = mongoose.model('Attendance', attendanceSchema);
