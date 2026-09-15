'use strict';

const mongoose = require('mongoose');
const { OFFER_STATUSES } = require('../config/recruitment');
const { CURRENCIES, EMPLOYMENT_TYPES } = require('../config/hr');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const offerSchema = new mongoose.Schema(
  {
    application: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', required: true, unique: true },
    requisition: { type: mongoose.Schema.Types.ObjectId, ref: 'Requisition', required: true },
    candidate: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', required: true },
    /** Hiring manager — used by the shared approval inbox. */
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    snapshot: {
      employeeCode: String,
      fullName: String,
      designation: String,
      department: String,
      candidateName: String,
      title: String,
    },
    currency: { type: String, enum: CURRENCIES, default: 'USD' },
    salary: { type: Number, required: [true, 'Offer salary is required'], min: [1, 'Salary must be greater than zero'] },
    startDate: { type: Date, required: [true, 'A start date is required'] },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, default: 'full_time' },
    letterBody: { type: String, trim: true, default: '', maxlength: 2000 },
    status: {
      type: String,
      enum: { values: OFFER_STATUSES, message: '{VALUE} is not a recognised offer status' },
      default: 'pending',
      index: true,
    },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decisionNote: { type: String, trim: true, default: '', maxlength: 300 },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    hiredEmployee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

module.exports = mongoose.model('Offer', offerSchema);
