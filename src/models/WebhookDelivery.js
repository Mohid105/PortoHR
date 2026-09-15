'use strict';

const mongoose = require('mongoose');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const webhookDeliverySchema = new mongoose.Schema(
  {
    direction: { type: String, enum: ['out', 'in'], default: 'out', index: true },
    event: { type: String, required: true, trim: true, maxlength: 80, index: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    endpoint: { type: String, trim: true, default: '', maxlength: 300 },
    status: {
      type: String,
      enum: ['queued', 'sent', 'failed', 'held', 'received', 'rejected'],
      default: 'queued',
      index: true,
    },
    attempts: { type: Number, default: 0, min: 0 },
    signature: { type: String, trim: true, default: '', maxlength: 80 },
    responseStatus: { type: Number, default: null },
    lastError: { type: String, trim: true, default: '', maxlength: 240 },
    deliveredAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

webhookDeliverySchema.index({ createdAt: -1 });

module.exports = mongoose.model('WebhookDelivery', webhookDeliverySchema);
