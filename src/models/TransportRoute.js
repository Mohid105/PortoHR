'use strict';

const mongoose = require('mongoose');

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

const seatSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    snapshot: snapshotShape,
    status: { type: String, enum: ['requested', 'allocated', 'cancelled'], default: 'allocated' },
    seat: { type: String, trim: true, default: '', maxlength: 20 },
    effectiveFrom: { type: Date, default: Date.now },
    effectiveTo: { type: Date, default: null },
    note: { type: String, trim: true, default: '', maxlength: 200 },
  },
  { timestamps: true }
);

const transportRouteSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    origin: { type: String, required: true, trim: true, maxlength: 80 },
    destination: { type: String, required: true, trim: true, maxlength: 80 },
    departsAt: { type: String, required: true, trim: true, maxlength: 8 },
    capacity: { type: Number, required: true, min: 1, max: 80 },
    vehicleLabel: { type: String, trim: true, default: '', maxlength: 80 },
    active: { type: Boolean, default: true },
    allocations: { type: [seatSchema], default: [] },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

module.exports = mongoose.model('TransportRoute', transportRouteSchema);
