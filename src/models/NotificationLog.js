'use strict';

const mongoose = require('mongoose');
const { NOTIFICATION_CHANNELS } = require('../config/admin');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const notificationLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    channel: { type: String, enum: NOTIFICATION_CHANNELS, default: 'in_app' },
    templateCode: { type: String, default: '', maxlength: 40 },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, trim: true, default: '', maxlength: 2000 },
    status: { type: String, enum: ['delivered', 'queued', 'failed'], default: 'delivered' },
    destination: { type: String, trim: true, default: '', maxlength: 120 },
    lastError: { type: String, trim: true, default: '', maxlength: 200 },
    sentAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

notificationLogSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('NotificationLog', notificationLogSchema);
