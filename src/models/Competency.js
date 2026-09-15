'use strict';

const mongoose = require('mongoose');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

/**
 * A reusable skill/competency that courses map to. Job-level gap reports
 * compare these codes against completed enrollments.
 */
const competencySchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 20 },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    category: { type: String, trim: true, default: 'general', maxlength: 40 },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

module.exports = mongoose.model('Competency', competencySchema);
