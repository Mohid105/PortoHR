'use strict';

const mongoose = require('mongoose');
const { CONNECTOR_KINDS } = require('../config/admin');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    if (ret.secret) ret.secret = ret.secret ? '••••••••' : '';
    return ret;
  },
};

const integrationConnectorSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: CONNECTOR_KINDS, required: true, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    enabled: { type: Boolean, default: false },
    endpoint: { type: String, trim: true, default: '', maxlength: 300 },
    rateLimitPerMin: { type: Number, default: 60, min: 1, max: 1000 },
    secret: { type: String, trim: true, default: '', maxlength: 120 },
    lastTestAt: { type: Date, default: null },
    lastTestNote: { type: String, trim: true, default: '', maxlength: 200 },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

module.exports = mongoose.model('IntegrationConnector', integrationConnectorSchema);
