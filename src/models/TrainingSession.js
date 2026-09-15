'use strict';

const mongoose = require('mongoose');
const { SESSION_STATUSES } = require('../config/lms');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const trainingSessionSchema = new mongoose.Schema(
  {
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, required: true },
    location: { type: String, trim: true, default: '', maxlength: 80 },
    instructorName: { type: String, trim: true, default: '', maxlength: 80 },
    capacity: { type: Number, default: 20, min: 1, max: 200 },
    status: {
      type: String,
      enum: SESSION_STATUSES,
      default: 'scheduled',
      index: true,
    },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

module.exports = mongoose.model('TrainingSession', trainingSessionSchema);
