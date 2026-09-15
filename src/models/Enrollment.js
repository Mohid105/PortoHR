'use strict';

const mongoose = require('mongoose');
const { ENROLLMENT_STATUSES, ENROLLMENT_SOURCES } = require('../config/lms');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

/**
 * One person's place on a course. `employee` is the learner so the shared
 * approval inbox can scope self-requests the same way as leave.
 */
const enrollmentSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      index: true,
    },
    snapshot: {
      employeeCode: String,
      fullName: String,
      designation: String,
      department: String,
    },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    session: { type: mongoose.Schema.Types.ObjectId, ref: 'TrainingSession', default: null },
    source: { type: String, enum: ENROLLMENT_SOURCES, default: 'self' },
    status: {
      type: String,
      enum: ENROLLMENT_STATUSES,
      default: 'pending',
      index: true,
    },
    dueDate: { type: Date, default: null },
    attended: { type: Boolean, default: null },
    completedAt: { type: Date, default: null },
    feedbackScore: { type: Number, default: null, min: 1, max: 5 },
    feedbackNote: { type: String, trim: true, default: '', maxlength: 400 },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decisionNote: { type: String, trim: true, default: '', maxlength: 300 },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

enrollmentSchema.index(
  { employee: 1, course: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['pending', 'enrolled'] } } }
);
enrollmentSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model('Enrollment', enrollmentSchema);
