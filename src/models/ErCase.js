'use strict';

const mongoose = require('mongoose');
const {
  CASE_TYPES,
  CASE_STATUSES,
  PARTY_ROLES,
  ACTION_TYPES,
  DECISION_OUTCOMES,
  NOTE_VISIBILITY,
  CLASSIFICATIONS,
} = require('../config/grievance');

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

const partySchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    role: { type: String, enum: PARTY_ROLES, required: true },
    snapshot: snapshotShape,
  },
  { _id: false }
);

const eventSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    actorName: { type: String, default: '' },
    action: { type: String, required: true },
    note: { type: String, trim: true, default: '', maxlength: 800 },
    visibility: { type: String, enum: NOTE_VISIBILITY, default: 'parties' },
  },
  { _id: false }
);

const noteSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    authorName: { type: String, default: '' },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
  },
  { _id: false }
);

const documentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    url: { type: String, trim: true, default: '', maxlength: 300 },
    classification: { type: String, enum: CLASSIFICATIONS, default: 'restricted' },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

/**
 * A confidential ER case. Investigation notes never belong on the Core HR
 * personnel file — only an authorized status summary is exposed to parties.
 */
const erCaseSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    type: { type: String, enum: CASE_TYPES, required: true },
    status: { type: String, enum: CASE_STATUSES, default: 'intake', index: true },
    summary: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, default: '', maxlength: 4000 },
    department: { type: String, trim: true, default: '' },
    subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    complainant: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },
    snapshot: snapshotShape,
    parties: { type: [partySchema], default: [] },
    timeline: { type: [eventSchema], default: [] },
    investigationNotes: { type: [noteSchema], default: [] },
    documents: { type: [documentSchema], default: [] },
    hearing: {
      scheduledOn: { type: Date, default: null },
      location: { type: String, trim: true, default: '' },
      outcome: { type: String, trim: true, default: '' },
    },
    decision: {
      outcome: { type: String, enum: [...DECISION_OUTCOMES, ''], default: '' },
      actionType: { type: String, enum: ACTION_TYPES, default: 'none' },
      note: { type: String, trim: true, default: '', maxlength: 800 },
      coreHrNote: { type: String, trim: true, default: '', maxlength: 200 },
      decidedAt: { type: Date, default: null },
      decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    },
    appealReason: { type: String, trim: true, default: '', maxlength: 800 },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

erCaseSchema.index({ status: 1, createdAt: -1 });
erCaseSchema.index({ department: 1, type: 1 });

module.exports = mongoose.model('ErCase', erCaseSchema);
