'use strict';

const mongoose = require('mongoose');

/** A report definition someone chose to keep. It stores the question, never the answer. */
const savedReportSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ownerName: { type: String, default: '', maxlength: 80 },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, default: '', maxlength: 300 },
    dataset: { type: String, required: true, trim: true, maxlength: 40 },
    definition: { type: mongoose.Schema.Types.Mixed, required: true },
    shared: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, transform: (_doc, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  }
);

savedReportSchema.index({ shared: 1, dataset: 1 });

module.exports = mongoose.model('SavedReport', savedReportSchema);
