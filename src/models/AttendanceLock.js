'use strict';

const mongoose = require('mongoose');

/** A closed attendance month: nothing in it can be punched, imported or corrected until it is reopened. */
const lockSchema = new mongoose.Schema(
  {
    month: { type: String, required: true, unique: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    lockedByName: { type: String, default: '' },
    note: { type: String, trim: true, default: '', maxlength: 200 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, transform: (_doc, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  }
);

module.exports = mongoose.model('AttendanceLock', lockSchema);
