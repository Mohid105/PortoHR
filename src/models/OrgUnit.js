'use strict';

const mongoose = require('mongoose');
const { ORG_LEVELS, ORG_STATUSES, TEAM_TYPES } = require('../config/org');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

/**
 * One node in Cluster → Department → Unit → Section → Team. Higher levels are
 * derived through parent so an employee only stores Position → Team.
 */
const orgUnitSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: ORG_LEVELS,
      index: true,
    },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    hierarchyCode: { type: String, trim: true, default: '', uppercase: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    teamType: { type: String, enum: [...TEAM_TYPES, ''], default: '' },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'OrgUnit', default: null },
    location: { type: String, trim: true, default: '' },
    defaultCostCenter: { type: String, trim: true, default: '' },
    status: { type: String, enum: ORG_STATUSES, default: 'active', index: true },
    effectiveFrom: { type: Date, default: Date.now },
    effectiveTo: { type: Date, default: null },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

orgUnitSchema.index({ type: 1, name: 1 });
orgUnitSchema.index({ parent: 1, status: 1 });

module.exports = mongoose.model('OrgUnit', orgUnitSchema);
