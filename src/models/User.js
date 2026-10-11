'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES, ROLE_VALUES } = require('../config/roles');

const userSchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      required: [true, 'Employee ID is required'],
      unique: true,
      trim: true,
      uppercase: true,
    },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false,
    },
    role: {
      type: String,
      enum: { values: ROLE_VALUES, message: '{VALUE} is not a supported role' },
      default: ROLES.EMPLOYEE,
      index: true,
    },
    designation: { type: String, trim: true, default: '' },
    department: { type: String, trim: true, default: '' },
    reportsTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
    mustChangePassword: { type: Boolean, default: false },
    failedLogins: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    /** Bumped to end every session this account has open, on every device. */
    tokenVersion: { type: Number, default: 0 },
    passwordChangedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

userSchema.virtual('fullName').get(function fullName() {
  return `${this.firstName} ${this.lastName}`.trim();
});

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  if (!this.isNew) this.passwordChangedAt = new Date();
  return next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
