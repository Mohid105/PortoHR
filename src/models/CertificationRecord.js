'use strict';

const mongoose = require('mongoose');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const certificationRecordSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    enrollment: { type: mongoose.Schema.Types.ObjectId, ref: 'Enrollment', default: null },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    issuedAt: { type: Date, required: true },
    expiresAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

certificationRecordSchema.index({ employee: 1, course: 1, issuedAt: -1 });

module.exports = mongoose.model('CertificationRecord', certificationRecordSchema);
