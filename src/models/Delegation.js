'use strict';

const mongoose = require('mongoose');
const { ROLE_VALUES } = require('../config/roles');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const snapshotShape = {
  employeeCode: String,
  fullName: String,
  designation: String,
  department: String,
};

const delegationSchema = new mongoose.Schema(
  {
    grantor: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    grantorRole: { type: String, enum: ROLE_VALUES, required: true },
    grantorSnapshot: snapshotShape,
    delegate: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    delegateSnapshot: snapshotShape,
    fromOn: { type: Date, required: true },
    toOn: { type: Date, required: true },
    status: { type: String, enum: ['active', 'cancelled', 'expired'], default: 'active', index: true },
    note: { type: String, trim: true, default: '', maxlength: 300 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

delegationSchema.index({ delegate: 1, status: 1, fromOn: 1, toOn: 1 });

module.exports = mongoose.model('Delegation', delegationSchema);
