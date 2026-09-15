'use strict';

const mongoose = require('mongoose');
const { ASSET_CATEGORIES, ASSET_STATUSES } = require('../config/assets');
const { CURRENCIES } = require('../config/hr');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

/**
 * One catalogue row. Custody lives on AssetAssignment; this document only
 * tracks whether the item is free, out, in the workshop, or written off.
 */
const assetSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    category: { type: String, enum: ASSET_CATEGORIES, required: true, index: true },
    status: { type: String, enum: ASSET_STATUSES, default: 'available', index: true },
    serial: { type: String, trim: true, default: '', maxlength: 80 },
    barcode: { type: String, trim: true, uppercase: true, default: '', maxlength: 40 },
    location: { type: String, trim: true, default: '', maxlength: 80 },
    notes: { type: String, trim: true, default: '', maxlength: 500 },
    purchaseDate: { type: Date, default: null },
    purchaseValue: { type: Number, default: 0, min: 0 },
    residualValue: { type: Number, default: 0, min: 0 },
    usefulLifeMonths: { type: Number, default: 36, min: 1, max: 240 },
    currency: { type: String, enum: CURRENCIES, default: 'USD' },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

assetSchema.index(
  { barcode: 1 },
  { unique: true, partialFilterExpression: { barcode: { $type: 'string', $gt: '' } } }
);
assetSchema.index({ category: 1, status: 1 });

module.exports = mongoose.model('Asset', assetSchema);
