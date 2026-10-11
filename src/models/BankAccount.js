'use strict';

const mongoose = require('mongoose');
const { PAYMENT_METHODS } = require('../config/org');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const bankAccountSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    person: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', default: null },
    method: { type: String, enum: PAYMENT_METHODS, default: 'bank_transfer' },
    bankName: { type: String, trim: true, default: '' },
    branch: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    accountTitle: { type: String, trim: true, default: '' },
    accountNumber: { type: String, trim: true, default: '' },
    iban: { type: String, trim: true, default: '' },
    effectiveFrom: { type: Date, default: Date.now },
    effectiveTo: { type: Date, default: null },
    status: { type: String, enum: ['pending', 'active', 'superseded', 'rejected'], default: 'pending' },
    reason: { type: String, trim: true, default: '' },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, trim: true, default: '' },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

bankAccountSchema.index({ employee: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });

module.exports = mongoose.model('BankAccount', bankAccountSchema);
