'use strict';

const mongoose = require('mongoose');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

/**
 * A point-in-time copy of the executive tiles so a later org change does not
 * rewrite what leadership saw on that morning.
 */
const kpiSnapshotSchema = new mongoose.Schema(
  {
    asOf: { type: Date, required: true, index: true },
    scope: { type: String, enum: ['company', 'team'], default: 'company' },
    label: { type: String, trim: true, default: '', maxlength: 80 },
    metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    generatedByName: { type: String, default: '', maxlength: 80 },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

kpiSnapshotSchema.index({ asOf: -1, createdAt: -1 });

module.exports = mongoose.model('KPISnapshot', kpiSnapshotSchema);
