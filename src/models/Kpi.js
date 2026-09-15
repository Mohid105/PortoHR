'use strict';

const mongoose = require('mongoose');
const {
  WEIGHT_MIN,
  WEIGHT_MAX,
  COMPLETION_MIN,
  COMPLETION_MAX,
  TITLE_MIN,
  TITLE_MAX,
  DESCRIPTION_MAX,
  TARGET_MAX,
  PERIOD_RE,
} = require('../config/pms');

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

const kpiSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: [true, 'A KPI must belong to an employee'],
      index: true,
    },

    /** Optional parent objective in the same period. */
    objective: { type: mongoose.Schema.Types.ObjectId, ref: 'Objective', default: null },

    period: {
      type: String,
      required: [true, 'Period is required'],
      match: [PERIOD_RE, 'Period must be in YYYY-H1 or YYYY-H2 format'],
      index: true,
    },

    title: {
      type: String,
      required: [true, 'KPI title is required'],
      trim: true,
      minlength: [TITLE_MIN, `Title must be at least ${TITLE_MIN} characters`],
      maxlength: [TITLE_MAX, `Title cannot exceed ${TITLE_MAX} characters`],
    },

    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: [DESCRIPTION_MAX, `Description cannot exceed ${DESCRIPTION_MAX} characters`],
    },

    /** Qualitative or numeric target as written by the manager, e.g. "95% uptime". */
    target: {
      type: String,
      trim: true,
      default: '',
      maxlength: [TARGET_MAX, `Target cannot exceed ${TARGET_MAX} characters`],
    },

    weight: {
      type: Number,
      required: [true, 'Weight is required'],
      min: [WEIGHT_MIN, `Weight must be at least ${WEIGHT_MIN}`],
      max: [WEIGHT_MAX, `Weight cannot exceed ${WEIGHT_MAX}`],
    },

    /**
     * 0–100 progress toward the target. Updated when the employee self-assesses;
     * the appraisal also freezes a copy on each KPI score line.
     */
    completion: {
      type: Number,
      default: 0,
      min: [COMPLETION_MIN, 'Completion cannot be negative'],
      max: [COMPLETION_MAX, 'Completion cannot exceed 100'],
    },

    snapshot: snapshotSchema,
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
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

kpiSchema.index({ employee: 1, period: 1 });

module.exports = mongoose.model('Kpi', kpiSchema);
