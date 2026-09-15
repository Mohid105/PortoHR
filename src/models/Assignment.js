'use strict';

const mongoose = require('mongoose');
const { DEPARTMENTS, SHIFT_TYPES, WEEKDAYS, CURRENCIES, LOCATIONS } = require('../config/hr');
const { ASSIGNMENT_STATUSES } = require('../config/workforce');
const { PERSONNEL_EVENTS, ORG_ROLES } = require('../config/org');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const allowanceSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      required: [true, 'Allowance name is required'],
      trim: true,
      maxlength: [60, 'Allowance name cannot exceed 60 characters'],
    },
    amount: {
      type: Number,
      required: [true, 'Allowance amount is required'],
      min: [0, 'Allowance amount cannot be negative'],
    },
  },
  { _id: false }
);

/**
 * One dated slice of placement and pay. Material changes insert a row; the
 * previous active row is closed the day before the new one begins. High-risk
 * events stay pending until a checker posts them. Future-dated rows stay
 * scheduled until their effective date.
 */
const assignmentSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: [true, 'An assignment must belong to an employee'],
    },
    employment: { type: mongoose.Schema.Types.ObjectId, ref: 'Employment', default: null },
    person: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', default: null },
    position: { type: mongoose.Schema.Types.ObjectId, ref: 'Position', default: null },
    job: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', default: null },
    grade: { type: mongoose.Schema.Types.ObjectId, ref: 'Grade', default: null },
    teamUnit: { type: mongoose.Schema.Types.ObjectId, ref: 'OrgUnit', default: null },
    reportsToPosition: { type: mongoose.Schema.Types.ObjectId, ref: 'Position', default: null },

    event: { type: String, enum: [...PERSONNEL_EVENTS, ''], default: '' },
    eventReason: { type: String, trim: true, default: '' },

    designation: {
      type: String,
      required: [true, 'Designation is required'],
      trim: true,
      maxlength: [80, 'Position title cannot exceed 80 characters'],
    },
    department: {
      type: String,
      required: [true, 'Department is required'],
      enum: { values: DEPARTMENTS, message: '{VALUE} is not a recognised department' },
    },
    team: { type: String, trim: true, default: '', maxlength: 60 },
    orgRole: { type: String, enum: [...ORG_ROLES, ''], default: '' },
    gradeCode: { type: String, trim: true, default: '' },
    location: { type: String, enum: [...LOCATIONS, ''], default: '' },
    costCenter: { type: String, trim: true, default: '' },
    reportsTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    shiftType: {
      type: String,
      enum: { values: SHIFT_TYPES, message: '{VALUE} is not a recognised shift' },
      default: 'general',
    },
    restDays: {
      type: [{ type: String, enum: WEEKDAYS }],
      default: ['saturday', 'sunday'],
    },
    compensation: {
      currency: { type: String, enum: CURRENCIES, default: 'USD' },
      baseSalary: { type: Number, required: [true, 'Base salary is required'], min: [0, 'Base salary cannot be negative'] },
      fixedAllowances: { type: [allowanceSchema], default: [] },
    },

    effectiveFrom: { type: Date, required: [true, 'Effective from is required'], index: true },
    effectiveTo: { type: Date, default: null },

    status: {
      type: String,
      enum: { values: ASSIGNMENT_STATUSES, message: '{VALUE} is not a recognised assignment status' },
      default: 'pending',
      index: true,
    },

    changedFields: { type: [String], default: [] },
    requiresApproval: { type: Boolean, default: false },
    reason: { type: String, trim: true, default: '', maxlength: 300 },

    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, trim: true, default: '', maxlength: 300 },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

assignmentSchema.index({ employee: 1, status: 1, effectiveFrom: -1 });
assignmentSchema.index({ employee: 1, effectiveFrom: -1 });
assignmentSchema.index({ employee: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });

module.exports = mongoose.model('Assignment', assignmentSchema);
