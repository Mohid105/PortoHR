'use strict';

const mongoose = require('mongoose');
const { SCORE_MIN, SCORE_MAX, COMPLETION_MIN, COMPLETION_MAX, STATUSES, NOTES_MAX, PERIOD_RE } = require('../config/pms');

const snapshotSchema = new mongoose.Schema(
  {
    employeeCode: String,
    fullName: String,
    designation: String,
    department: String,
    team: String,
  },
  { _id: false }
);

const scoreRange = {
  type: Number,
  default: null,
  min: [SCORE_MIN, `Score must be at least ${SCORE_MIN}`],
  max: [SCORE_MAX, `Score cannot exceed ${SCORE_MAX}`],
};

/**
 * One line per assigned KPI so the supervisor view can render self vs manager
 * scores without joining live KPI documents that may later change.
 */
const kpiScoreSchema = new mongoose.Schema(
  {
    kpi: { type: mongoose.Schema.Types.ObjectId, ref: 'Kpi', required: true },
    selfScore: scoreRange,
    selfNotes: { type: String, trim: true, default: '', maxlength: NOTES_MAX },
    supervisorScore: scoreRange,
    supervisorNotes: { type: String, trim: true, default: '', maxlength: NOTES_MAX },
    completion: {
      type: Number,
      default: 0,
      min: [COMPLETION_MIN, 'Completion cannot be negative'],
      max: [COMPLETION_MAX, 'Completion cannot exceed 100'],
    },
  },
  { _id: false }
);

const appraisalSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: [true, 'An appraisal must belong to an employee'],
      index: true,
    },

    period: {
      type: String,
      required: [true, 'Period is required'],
      match: [PERIOD_RE, 'Period must be in YYYY-H1 or YYYY-H2 format'],
    },

    snapshot: snapshotSchema,
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    status: {
      type: String,
      enum: { values: STATUSES, message: '{VALUE} is not a recognised appraisal status' },
      default: 'assigned',
      index: true,
    },

    selfAssessmentScore: scoreRange,
    selfAssessmentNotes: { type: String, trim: true, default: '', maxlength: NOTES_MAX },
    selfSubmittedAt: { type: Date, default: null },

    supervisorScore: scoreRange,
    supervisorNotes: { type: String, trim: true, default: '', maxlength: NOTES_MAX },
    finalRating: scoreRange,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },

    kpiScores: { type: [kpiScoreSchema], default: [] },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

appraisalSchema.index({ employee: 1, period: 1 }, { unique: true });

module.exports = mongoose.model('Appraisal', appraisalSchema);
