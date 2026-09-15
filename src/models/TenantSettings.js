'use strict';

const mongoose = require('mongoose');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const tenantSettingsSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    legalEntity: { type: String, trim: true, default: 'PortoHR (Pvt) Ltd', maxlength: 80 },
    country: { type: String, trim: true, default: 'PK', maxlength: 4 },
    locale: { type: String, trim: true, default: 'en-PK', maxlength: 12 },
    timezone: { type: String, trim: true, default: 'Asia/Karachi', maxlength: 40 },
    currency: { type: String, trim: true, default: 'PKR', maxlength: 6 },
    fyStartMonth: { type: Number, default: 7, min: 1, max: 12 },
    supportEmail: { type: String, trim: true, default: 'hr@portohr.test', maxlength: 80 },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

module.exports = mongoose.model('TenantSettings', tenantSettingsSchema);
