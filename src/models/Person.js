'use strict';

const mongoose = require('mongoose');
const { GENDERS } = require('../config/hr');
const { MARITAL_STATUSES, NATIONALITIES, ID_TYPES } = require('../config/org');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const nationalIdSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ID_TYPES, default: 'cnic' },
    number: { type: String, trim: true, default: '' },
    issuingCountry: { type: String, trim: true, default: 'PK' },
    issuedOn: { type: Date, default: null },
    expiresOn: { type: Date, default: null },
  },
  { _id: false }
);

/**
 * Immutable identity. Legal name and demographics are not rewritten when
 * someone moves team or gets a raise — those events belong on Assignment.
 * The person code stays stable across separation and rehire.
 */
const personSchema = new mongoose.Schema(
  {
    personCode: { type: String, unique: true, sparse: true, uppercase: true, trim: true },
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
      maxlength: [50, 'First name cannot exceed 50 characters'],
    },
    middleName: { type: String, trim: true, default: '', maxlength: 50 },
    lastName: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true,
      maxlength: [50, 'Last name cannot exceed 50 characters'],
    },
    preferredName: { type: String, trim: true, default: '', maxlength: 80 },
    fatherName: { type: String, trim: true, default: '', maxlength: 80 },
    dateOfBirth: { type: Date, default: null },
    gender: { type: String, enum: [...GENDERS, ''], default: '' },
    maritalStatus: { type: String, enum: [...MARITAL_STATUSES, ''], default: '' },
    nationality: { type: String, enum: [...NATIONALITIES, ''], default: '' },
    personalEmail: { type: String, lowercase: true, trim: true, default: '' },
    mobile: { type: String, trim: true, default: '', maxlength: 30 },
    nationalIds: { type: [nationalIdSchema], default: [] },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

personSchema.virtual('fullName').get(function fullName() {
  return `${this.firstName} ${this.lastName}`.trim();
});

personSchema.pre('validate', function setPersonCode(next) {
  if (!this.personCode && this._id) {
    this.personCode = `PER-${String(this._id).slice(-6).toUpperCase()}`;
  }
  next();
});

module.exports = mongoose.model('Person', personSchema);
