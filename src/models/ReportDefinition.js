'use strict';

const mongoose = require('mongoose');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const reportDefinitionSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    category: { type: String, required: true, trim: true, maxlength: 40 },
    summary: { type: String, trim: true, default: '', maxlength: 400 },
    visibility: { type: String, enum: ['hr', 'manager', 'all'], default: 'manager' },
    cadence: { type: String, enum: ['none', 'monthly'], default: 'none' },
    lastRunAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

module.exports = mongoose.model('ReportDefinition', reportDefinitionSchema);
