'use strict';

const mongoose = require('mongoose');
const shiftRegistry = require('../config/shiftRegistry');
const {
  EMPLOYMENT_TYPES,
  EMPLOYMENT_STATUSES,
  WEEKDAYS,
  GENDERS,
  CURRENCIES,
} = require('../config/hr');

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

const employeeSchema = new mongoose.Schema(
  {
    person: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', default: null },
    employment: { type: mongoose.Schema.Types.ObjectId, ref: 'Employment', default: null },
    currentAssignment: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', default: null },
    currentPosition: { type: mongoose.Schema.Types.ObjectId, ref: 'Position', default: null },

    // --- Basic info ---
    employeeCode: {
      type: String,
      required: [true, 'Employee code is required'],
      unique: true,
      trim: true,
      uppercase: true,
      match: [/^[A-Z0-9-]{3,20}$/, 'Employee code may only contain letters, numbers and hyphens'],
    },
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
      maxlength: [50, 'First name cannot exceed 50 characters'],
    },
    lastName: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true,
      maxlength: [50, 'Last name cannot exceed 50 characters'],
    },
    preferredName: { type: String, trim: true, default: '', maxlength: 80 },
    email: {
      type: String,
      required: [true, 'Work email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address'],
    },
    phone: {
      type: String,
      trim: true,
      default: '',
      maxlength: [30, 'Phone number cannot exceed 30 characters'],
    },
    dateOfBirth: { type: Date, default: null },
    gender: { type: String, enum: [...GENDERS, ''], default: '' },
    address: { type: String, trim: true, default: '', maxlength: 200 },

    // --- Placement ---
    designation: {
      type: String,
      required: [true, 'Designation is required'],
      trim: true,
      maxlength: [80, 'Designation cannot exceed 80 characters'],
    },
    department: {
      type: String,
      required: [true, 'Department is required'],
      maxlength: [80, 'Department cannot exceed 80 characters'],
      trim: true,
      index: true,
    },
    team: { type: String, trim: true, default: '', maxlength: 60 },
    orgRole: { type: String, trim: true, default: '' },
    grade: { type: String, trim: true, default: '' },
    location: { type: String, trim: true, maxlength: 80, default: '' },
    costCenter: { type: String, trim: true, default: '' },
    legalEntity: { type: String, trim: true, default: 'PortoHR (Pvt) Ltd' },
    employeeCategory: { type: String, trim: true, default: '' },
    payGroup: { type: String, trim: true, default: '' },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, default: 'full_time' },
    employmentStatus: {
      type: String,
      enum: { values: EMPLOYMENT_STATUSES, message: '{VALUE} is not a recognised status' },
      default: 'probation',
      index: true,
    },
    dateOfJoining: {
      type: Date,
      required: [true, 'Date of joining is required'],
      validate: {
        validator: (value) => !value || value <= new Date(Date.now() + 366 * 24 * 60 * 60 * 1000),
        message: 'Date of joining cannot be more than a year in the future',
      },
    },
    reportsTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    probationEndDate: { type: Date, default: null },
    confirmationDate: { type: Date, default: null },
    lastWorkingDay: { type: Date, default: null },

    // --- Schedule ---
    /** 'exempt' employees (senior staff) are counted present on working days without punching. */
    attendanceMode: { type: String, enum: ['punch', 'exempt'], default: 'punch' },

    /** The code of a shift defined in Attendance → Shifts. */
    shiftType: { type: String, trim: true, default: 'general', maxlength: 24 },
    restDays: {
      type: [{ type: String, enum: WEEKDAYS }],
      default: ['saturday', 'sunday'],
      validate: [
        {
          validator: (days) => days.length <= 3,
          message: 'An employee cannot have more than 3 rest days',
        },
        {
          validator: (days) => new Set(days).size === days.length,
          message: 'Rest days must not repeat',
        },
      ],
    },

    /** Paid leave days granted per calendar year; the Leave module counts usage against it. */
    annualLeaveDays: {
      type: Number,
      default: 20,
      min: [0, 'Leave entitlement cannot be negative'],
      max: [365, 'Leave entitlement cannot exceed 365 days'],
    },

    // --- Compensation ---
    compensation: {
      currency: { type: String, enum: CURRENCIES, default: 'USD' },
      baseSalary: {
        type: Number,
        required: [true, 'Base salary is required'],
        min: [0, 'Base salary cannot be negative'],
      },
      fixedAllowances: { type: [allowanceSchema], default: [] },
    },

    /** Optional link to the login account in the User collection. */
    userAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, transform: (_doc, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: true },
  }
);

employeeSchema.index({ lastName: 1, firstName: 1 });

employeeSchema.virtual('fullName').get(function fullName() {
  return `${this.firstName} ${this.lastName}`.trim();
});

employeeSchema.virtual('shift').get(function shift() {
  const definition = shiftRegistry.get(this.shiftType);
  return {
    type: this.shiftType,
    label: definition.label || this.shiftType,
    startTime: definition.startTime || null,
    endTime: definition.endTime || null,
  };
});

employeeSchema.virtual('totalAllowances').get(function totalAllowances() {
  const allowances = (this.compensation && this.compensation.fixedAllowances) || [];
  return allowances.reduce((sum, item) => sum + (item.amount || 0), 0);
});

employeeSchema.virtual('grossSalary').get(function grossSalary() {
  const base = (this.compensation && this.compensation.baseSalary) || 0;
  return base + this.totalAllowances;
});

module.exports = mongoose.model('Employee', employeeSchema);
