'use strict';

const mongoose = require('mongoose');
const { ASSIGNMENT_STATUSES, CONDITIONS } = require('../config/assets');

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
  positionTitle: String,
};

/**
 * Custody of a catalogue item. Requested rows may exist without HR having
 * handed the kit over yet; recovery rows are the separation checklist.
 */
const assetAssignmentSchema = new mongoose.Schema(
  {
    asset: { type: mongoose.Schema.Types.ObjectId, ref: 'Asset', required: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    position: { type: mongoose.Schema.Types.ObjectId, ref: 'Position', default: null },
    snapshot: snapshotShape,
    status: { type: String, enum: ASSIGNMENT_STATUSES, default: 'requested', index: true },
    conditionOut: { type: String, enum: [...CONDITIONS, ''], default: 'good' },
    conditionIn: { type: String, enum: [...CONDITIONS, ''], default: '' },
    issuedOn: { type: Date, default: null },
    acknowledgedOn: { type: Date, default: null },
    dueOn: { type: Date, default: null },
    returnedOn: { type: Date, default: null },
    recoveryQueuedOn: { type: Date, default: null },
    note: { type: String, trim: true, default: '', maxlength: 500 },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    returnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

assetAssignmentSchema.index({ employee: 1, status: 1 });
assetAssignmentSchema.index(
  { asset: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['requested', 'issued', 'acknowledged', 'recovery'] } } }
);

module.exports = mongoose.model('AssetAssignment', assetAssignmentSchema);
