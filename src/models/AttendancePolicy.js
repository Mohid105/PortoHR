'use strict';

const mongoose = require('mongoose');

/** The company-wide attendance rules. One document, created on first use. */
const policySchema = new mongoose.Schema(
  {
    key: { type: String, default: 'default', unique: true },

    /** Punches closer together than this are treated as a double tap and ignored. */
    minPunchGapMinutes: { type: Number, default: 2, min: 0, max: 60 },
    /** A punch pair must span at least this long to count as a worked period. */
    minSpanMinutes: { type: Number, default: 10, min: 0, max: 120 },
    /** An IN with no OUT after this many hours is a missed punch, not a long shift. */
    autoCloseHours: { type: Number, default: 16, min: 4, max: 48 },

    overtime: {
      enabled: { type: Boolean, default: true },
      /** Time beyond the shift's hours that is ignored before overtime starts. */
      thresholdMinutes: { type: Number, default: 15, min: 0, max: 240 },
      /** Overtime is counted in whole blocks of this size (rounded down). */
      roundToMinutes: { type: Number, default: 15, min: 1, max: 60 },
      /** Every hour worked on a weekly rest day is overtime. */
      restDayAllOvertime: { type: Boolean, default: true },
    },

    late: {
      /** Every N late arrivals cost `penaltyDays` of pay. 0 switches the rule off. */
      penaltyEveryNLates: { type: Number, default: 0, min: 0, max: 31 },
      penaltyDays: { type: Number, default: 0.5, min: 0, max: 5 },
    },

    webPunch: {
      allowed: { type: Boolean, default: true },
      /** A person may take back their own web punch for this many minutes. 0 switches undo off. */
      undoMinutes: { type: Number, default: 10, min: 0, max: 60 },
      /** How old an offline-queued punch may be and still be accepted. */
      backfillHours: { type: Number, default: 24, min: 0, max: 72 },
    },

    regularization: {
      /** Corrections can be requested for days up to this far back. */
      maxBackDays: { type: Number, default: 30, min: 1, max: 120 },
      /** Per person per month. 0 means unlimited. */
      maxPerMonth: { type: Number, default: 0, min: 0, max: 31 },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, transform: (_doc, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  }
);

module.exports = mongoose.model('AttendancePolicy', policySchema);
