'use strict';

const mongoose = require('mongoose');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const onboardingTaskSchema = new mongoose.Schema(
  {
    application: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', required: true, index: true },
    offer: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer', default: null },
    hiredEmployee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    owner: { type: String, enum: ['hr', 'manager', 'hire', 'it'], default: 'hr' },
    status: { type: String, enum: ['pending', 'done'], default: 'pending', index: true },
    doneAt: { type: Date, default: null },
    doneBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

module.exports = mongoose.model('OnboardingTask', onboardingTaskSchema);
