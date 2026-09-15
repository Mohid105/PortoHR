'use strict';

const mongoose = require('mongoose');
const { POLICY_STATUSES } = require('../config/compliance');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const policyDocumentSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    summary: { type: String, trim: true, default: '', maxlength: 400 },
    body: { type: String, trim: true, default: '', maxlength: 8000 },
    version: { type: Number, default: 1, min: 1 },
    status: { type: String, enum: POLICY_STATUSES, default: 'draft', index: true },
    requiresAck: { type: Boolean, default: true },
    dueWithinDays: { type: Number, default: 14, min: 1, max: 90 },
    publishedAt: { type: Date, default: null },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

module.exports = mongoose.model('PolicyDocument', policyDocumentSchema);
