'use strict';

const mongoose = require('mongoose');
const { QUALIFICATION_TYPES } = require('../config/org');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const qualificationSchema = new mongoose.Schema(
  {
    person: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true, index: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    type: { type: String, enum: QUALIFICATION_TYPES, default: 'education' },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    institution: { type: String, trim: true, default: '' },
    issuedOn: { type: Date, default: null },
    expiresOn: { type: Date, default: null },
    notes: { type: String, trim: true, default: '', maxlength: 300 },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

module.exports = mongoose.model('Qualification', qualificationSchema);
