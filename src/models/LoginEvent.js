'use strict';

const mongoose = require('mongoose');
const { SECURITY } = require('../config/security');

/** One sign-in attempt, successful or not. Expires on its own. */
const loginEventSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    email: { type: String, lowercase: true, trim: true, default: '', maxlength: 160 },
    success: { type: Boolean, default: false },
    reason: {
      type: String,
      enum: ['ok', 'bad_password', 'unknown_user', 'locked', 'deactivated'],
      default: 'ok',
    },
    ip: { type: String, default: '', maxlength: 64 },
    userAgent: { type: String, default: '', maxlength: 200 },
    createdAt: { type: Date, default: Date.now, expires: SECURITY.eventRetentionDays * 86400 },
  },
  { toJSON: { virtuals: true, transform: (_doc, ret) => { delete ret.__v; return ret; } } }
);

loginEventSchema.index({ createdAt: -1 });

module.exports = mongoose.model('LoginEvent', loginEventSchema);
