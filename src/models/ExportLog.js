'use strict';

const mongoose = require('mongoose');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const exportLogSchema = new mongoose.Schema(
  {
    reportCode: { type: String, required: true, trim: true, index: true },
    reportName: { type: String, default: '', maxlength: 80 },
    format: { type: String, default: 'json' },
    rowCount: { type: Number, default: 0 },
    filters: { type: mongoose.Schema.Types.Mixed, default: {} },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorName: { type: String, default: '', maxlength: 80 },
    role: { type: String, default: '' },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

exportLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ExportLog', exportLogSchema);
