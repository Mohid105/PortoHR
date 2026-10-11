'use strict';

const mongoose = require('mongoose');

/** One line of a new starter's onboarding checklist. */
const hireTaskSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    key: { type: String, required: true },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    owner: { type: String, enum: ['hr', 'manager', 'it', 'finance', 'employee'], default: 'hr' },
    status: { type: String, enum: ['pending', 'done'], default: 'pending', index: true },
    dueOn: { type: Date, default: null },
    doneAt: { type: Date, default: null },
    doneBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    note: { type: String, trim: true, default: '', maxlength: 300 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, transform: (_doc, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  }
);

hireTaskSchema.index({ employee: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('HireTask', hireTaskSchema);
