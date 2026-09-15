'use strict';

const mongoose = require('mongoose');
const { LOOKUP_CATEGORIES } = require('../config/admin');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const lookupValueSchema = new mongoose.Schema(
  {
    category: { type: String, enum: LOOKUP_CATEGORIES, required: true, index: true },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
    label: { type: String, required: true, trim: true, maxlength: 80 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

lookupValueSchema.index({ category: 1, code: 1 }, { unique: true });

module.exports = mongoose.model('LookupValue', lookupValueSchema);
