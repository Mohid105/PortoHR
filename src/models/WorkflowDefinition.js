'use strict';

const mongoose = require('mongoose');
const { WORKFLOW_EVENTS, ACTOR_ROLES, WORKFLOW_STATUSES } = require('../config/admin');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const stepSchema = new mongoose.Schema(
  {
    order: { type: Number, required: true, min: 1 },
    actorRole: { type: String, enum: ACTOR_ROLES, required: true },
    thresholdAmount: { type: Number, default: 0, min: 0 },
    label: { type: String, trim: true, default: '', maxlength: 80 },
  },
  { _id: true }
);

const workflowDefinitionSchema = new mongoose.Schema(
  {
    event: { type: String, enum: WORKFLOW_EVENTS, required: true, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    summary: { type: String, trim: true, default: '', maxlength: 400 },
    status: { type: String, enum: WORKFLOW_STATUSES, default: 'draft', index: true },
    steps: { type: [stepSchema], default: [] },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

module.exports = mongoose.model('WorkflowDefinition', workflowDefinitionSchema);
