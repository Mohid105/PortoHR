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

const notificationTemplateSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    channel: { type: String, enum: NOTIFICATION_CHANNELS, default: 'in_app' },
    subject: { type: String, trim: true, default: '', maxlength: 120 },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

module.exports = mongoose.model('NotificationTemplate', notificationTemplateSchema);
