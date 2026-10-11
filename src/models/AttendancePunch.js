'use strict';

const mongoose = require('mongoose');

/**
 * One raw clock event: a tap on a biometric device, a web clock-in, a manual
 * entry. Punches are never edited or deleted — a wrong one is voided with a
 * reason — and the day's attendance record is rebuilt from the live ones.
 */
const punchSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    /** The instant of the punch (UTC). */
    at: { type: Date, required: true },
    /** What the device or form said it was; the engine pairs punches by order regardless. */
    direction: { type: String, enum: ['in', 'out', 'auto'], default: 'auto' },
    source: { type: String, enum: ['web', 'web_offline', 'import', 'manual', 'regularization', 'device'], default: 'web' },
    deviceId: { type: String, trim: true, default: '', maxlength: 60 },
    note: { type: String, trim: true, default: '', maxlength: 200 },
    batch: { type: String, default: '', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    voided: { type: Boolean, default: false },
    voidedReason: { type: String, trim: true, default: '', maxlength: 200 },
    voidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    voidedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, transform: (_doc, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  }
);

punchSchema.index({ employee: 1, at: 1 });

module.exports = mongoose.model('AttendancePunch', punchSchema);
