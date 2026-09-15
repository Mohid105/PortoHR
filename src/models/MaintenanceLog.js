'use strict';

const mongoose = require('mongoose');
const { MAINTENANCE_STATUSES, MAINTENANCE_KINDS } = require('../config/assets');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const maintenanceLogSchema = new mongoose.Schema(
  {
    asset: { type: mongoose.Schema.Types.ObjectId, ref: 'Asset', required: true, index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    requesterName: { type: String, trim: true, default: '', maxlength: 80 },
    kind: { type: String, enum: MAINTENANCE_KINDS, default: 'repair' },
    status: { type: String, enum: MAINTENANCE_STATUSES, default: 'open', index: true },
    summary: { type: String, required: true, trim: true, maxlength: 160 },
    notes: { type: String, trim: true, default: '', maxlength: 800 },
    vendor: { type: String, trim: true, default: '', maxlength: 80 },
    cost: { type: Number, default: 0, min: 0 },
    scheduledOn: { type: Date, default: null },
    completedOn: { type: Date, default: null },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

maintenanceLogSchema.index({ status: 1, scheduledOn: 1 });

module.exports = mongoose.model('MaintenanceLog', maintenanceLogSchema);
