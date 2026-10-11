'use strict';

const mongoose = require('mongoose');

/**
 * A working-time pattern. Employees reference one by `code`. A shift with no
 * start and end is flexible: only the hours owed matter, not when they fall.
 */
const timeOfDay = { type: String, trim: true, default: null, match: [/^([01]?\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time such as 09:00'] };

const shiftSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, lowercase: true, match: [/^[a-z0-9_-]{2,24}$/, 'Code may use letters, numbers, - and _ (2–24 characters)'] },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    startTime: timeOfDay,
    endTime: timeOfDay,
    breakMinutes: { type: Number, default: 0, min: 0, max: 240 },
    /** Paid hours a full day owes. Left at 0 to derive it from the window and the break. */
    expectedHours: { type: Number, default: 0, min: 0, max: 16 },
    graceInMinutes: { type: Number, default: 10, min: 0, max: 120 },
    graceOutMinutes: { type: Number, default: 10, min: 0, max: 120 },
    /** How early before the start / late after the end a punch still belongs to this shift's day. */
    preWindowMinutes: { type: Number, default: 240, min: 0, max: 720 },
    postWindowMinutes: { type: Number, default: 360, min: 0, max: 720 },
    color: { type: String, trim: true, default: '', maxlength: 20 },
    active: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, transform: (_doc, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  }
);

module.exports = mongoose.model('Shift', shiftSchema);
