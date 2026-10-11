'use strict';

const mongoose = require('mongoose');

/** Puts one employee on a different shift for a stretch of days (rotations, cover, temporary changes). */
const rosterSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    /** First and last day, as UTC midnight of the calendar date, inclusive. */
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    shift: { type: String, required: true, trim: true, maxlength: 24 },
    note: { type: String, trim: true, default: '', maxlength: 200 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, transform: (_doc, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  }
);

rosterSchema.index({ employee: 1, from: 1, to: 1 });

module.exports = mongoose.model('ShiftRoster', rosterSchema);
