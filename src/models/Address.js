'use strict';

const mongoose = require('mongoose');
const { ADDRESS_TYPES } = require('../config/org');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const addressSchema = new mongoose.Schema(
  {
    person: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true, index: true },
    type: { type: String, enum: ADDRESS_TYPES, default: 'current' },
    line1: { type: String, trim: true, default: '', maxlength: 200 },
    line2: { type: String, trim: true, default: '', maxlength: 200 },
    city: { type: String, trim: true, default: '' },
    country: { type: String, trim: true, default: 'PK' },
    postalCode: { type: String, trim: true, default: '' },
    effectiveFrom: { type: Date, default: Date.now },
    effectiveTo: { type: Date, default: null },
    status: { type: String, enum: ['active', 'superseded'], default: 'active' },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

module.exports = mongoose.model('Address', addressSchema);
