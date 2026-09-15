'use strict';

const mongoose = require('mongoose');
const { WEIGHT_MIN, WEIGHT_MAX, TITLE_MIN, TITLE_MAX, DESCRIPTION_MAX, PERIOD_RE } = require('../config/pms');

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

const objectiveSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: [true, 'An objective must belong to an employee'],
      index: true,
    },

    /** Review window as YYYY-H1 or YYYY-H2. */
    period: {
      type: String,
      required: [true, 'Period is required'],
      match: [PERIOD_RE, 'Period must be in YYYY-H1 or YYYY-H2 format'],
      index: true,
    },

    title: {
      type: String,
      required: [true, 'Objective title is required'],
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

    weight: {
      type: Number,
      required: [true, 'Weight is required'],
      min: [WEIGHT_MIN, `Weight must be at least ${WEIGHT_MIN}`],
      max: [WEIGHT_MAX, `Weight cannot exceed ${WEIGHT_MAX}`],
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

objectiveSchema.index({ employee: 1, period: 1 });

module.exports = mongoose.model('Objective', objectiveSchema);
