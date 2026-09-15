'use strict';

const mongoose = require('mongoose');
const { PIPELINE_STAGES, SOURCES } = require('../config/recruitment');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const interviewSchema = new mongoose.Schema(
  {
    scheduledAt: { type: Date, default: Date.now },
    interviewerName: { type: String, trim: true, default: '', maxlength: 80 },
    score: { type: Number, default: null, min: 1, max: 5 },
    notes: { type: String, trim: true, default: '', maxlength: 600 },
    recommendation: { type: String, enum: ['advance', 'hold', 'reject', ''], default: '' },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: true, timestamps: true }
);

const applicationSchema = new mongoose.Schema(
  {
    requisition: { type: mongoose.Schema.Types.ObjectId, ref: 'Requisition', required: true, index: true },
    candidate: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', required: true, index: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    stage: {
      type: String,
      enum: { values: PIPELINE_STAGES, message: '{VALUE} is not a recognised pipeline stage' },
      default: 'applied',
      index: true,
    },
    source: { type: String, enum: SOURCES, default: 'career_site' },
    coverNote: { type: String, trim: true, default: '', maxlength: 600 },
    score: { type: Number, default: null, min: 1, max: 5 },
    interviews: { type: [interviewSchema], default: [] },
    hiredEmployee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

applicationSchema.index({ requisition: 1, candidate: 1 }, { unique: true });

module.exports = mongoose.model('Application', applicationSchema);
