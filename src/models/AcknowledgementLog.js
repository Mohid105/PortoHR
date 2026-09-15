'use strict';

const mongoose = require('mongoose');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const acknowledgementLogSchema = new mongoose.Schema(
  {
    policy: { type: mongoose.Schema.Types.ObjectId, ref: 'PolicyDocument', required: true, index: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    snapshot: {
      employeeCode: String,
      fullName: String,
      designation: String,
      department: String,
    },
    version: { type: Number, required: true },
    acknowledgedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

acknowledgementLogSchema.index({ policy: 1, employee: 1, version: 1 }, { unique: true });

module.exports = mongoose.model('AcknowledgementLog', acknowledgementLogSchema);
