'use strict';

const mongoose = require('mongoose');
const { REQUISITION_STATUSES } = require('../config/recruitment');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

/**
 * A request to fill an approved vacant seat. `employee` is the hiring manager
 * so the shared approval inbox can scope it the same way as other requests.
 */
const requisitionSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    position: { type: mongoose.Schema.Types.ObjectId, ref: 'Position', required: true },
    title: { type: String, required: true, trim: true, maxlength: 80 },
    department: { type: String, trim: true, default: '' },
    location: { type: String, trim: true, maxlength: 80, default: '' },
    openings: { type: Number, default: 1, min: 1, max: 20 },
    filledCount: { type: Number, default: 0, min: 0 },
    hiringManager: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    reason: {
      type: String,
      required: [true, 'A headcount reason is required'],
      trim: true,
      minlength: [8, 'Please give at least 8 characters of context'],
      maxlength: 400,
    },
    snapshot: {
      employeeCode: String,
      fullName: String,
      designation: String,
      department: String,
    },
    status: {
      type: String,
      enum: { values: REQUISITION_STATUSES, message: '{VALUE} is not a recognised requisition status' },
      default: 'pending',
      index: true,
    },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decisionNote: { type: String, trim: true, default: '', maxlength: 300 },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

requisitionSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Requisition', requisitionSchema);
