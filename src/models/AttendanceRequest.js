'use strict';

const mongoose = require('mongoose');

const TYPES = ['missed_punch', 'correction', 'on_duty', 'work_from_home'];

/** An employee's request to fix or explain a day, decided by a manager or HR. */
const requestSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    snapshot: { employeeCode: String, fullName: String, designation: String, department: String },
    /** The shift day being corrected, UTC midnight of that calendar date. */
    date: { type: Date, required: true },
    type: { type: String, enum: TYPES, required: true },
    /** Local clock times, 'HH:MM'. Either may be empty for a missed punch. */
    timeIn: { type: String, default: '', match: [/^(|([01]?\d|2[0-3]):[0-5]\d)$/, 'Use a 24-hour time such as 09:00'] },
    timeOut: { type: String, default: '', match: [/^(|([01]?\d|2[0-3]):[0-5]\d)$/, 'Use a 24-hour time such as 18:00'] },
    /** The time out falls on the following calendar day (night shifts). */
    outNextDay: { type: Boolean, default: false },
    /** Discard the punches already on that day before applying these. */
    replace: { type: Boolean, default: false },
    reason: { type: String, required: true, trim: true, minlength: 8, maxlength: 300 },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, trim: true, default: '', maxlength: 300 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, transform: (_doc, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  }
);

requestSchema.index({ employee: 1, date: 1 });
requestSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model('AttendanceRequest', requestSchema);
module.exports.TYPES = TYPES;
