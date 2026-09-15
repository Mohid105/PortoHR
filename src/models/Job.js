'use strict';

const mongoose = require('mongoose');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

/** Reusable job profile. Several positions can share one job. */
const jobSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    title: { type: String, required: true, trim: true, maxlength: 80 },
    titleKey: { type: String, required: true, unique: true, lowercase: true, trim: true },
    family: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

jobSchema.pre('validate', function setTitleKey(next) {
  if (this.title) this.titleKey = this.title.trim().toLowerCase();
  next();
});

module.exports = mongoose.model('Job', jobSchema);
