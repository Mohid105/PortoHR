'use strict';

const mongoose = require('mongoose');
const { ALLOCATION_STATUSES } = require('../config/assets');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const snapshotShape = {
  employeeCode: String,
  fullName: String,
  designation: String,
  department: String,
};

const accommodationAllocationSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    snapshot: snapshotShape,
    site: { type: String, required: true, trim: true, maxlength: 80 },
    room: { type: String, required: true, trim: true, maxlength: 40 },
    bed: { type: String, trim: true, default: '', maxlength: 20 },
    status: { type: String, enum: ALLOCATION_STATUSES, default: 'allocated', index: true },
    checkInOn: { type: Date, default: Date.now },
    checkOutOn: { type: Date, default: null },
    monthlyCharge: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'USD' },
    note: { type: String, trim: true, default: '', maxlength: 300 },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

accommodationAllocationSchema.index(
  { employee: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['requested', 'allocated'] } } }
);

module.exports = mongoose.model('AccommodationAllocation', accommodationAllocationSchema);
