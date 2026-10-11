'use strict';

const mongoose = require('mongoose');

/** An award or recognition: a service award, an appreciation letter, a bonus. */
const rewardSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    authority: { type: String, trim: true, default: '', maxlength: 100 },
    reward: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, default: '', maxlength: 300 },
    awardedOn: { type: Date, default: Date.now },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, transform: (_doc, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  }
);

module.exports = mongoose.model('EmployeeReward', rewardSchema);
