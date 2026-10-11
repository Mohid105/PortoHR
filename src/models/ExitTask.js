'use strict';

const mongoose = require('mongoose');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

/** One line of an employee's clearance checklist when they leave. */
const exitTaskSchema = new mongoose.Schema(
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
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

exitTaskSchema.index({ employee: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('ExitTask', exitTaskSchema);
