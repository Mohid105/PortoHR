'use strict';

const mongoose = require('mongoose');
const { LOCATIONS } = require('../config/hr');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

/**
 * A non-working calendar day. An empty location means the holiday applies to
 * every site; a set location scopes it to that office.
 */
const holidaySchema = new mongoose.Schema(
  {
    date: { type: Date, required: [true, 'Holiday date is required'] },
    name: {
      type: String,
      required: [true, 'Holiday name is required'],
      trim: true,
      maxlength: [80, 'Holiday name cannot exceed 80 characters'],
    },
    location: {
      type: String,
      enum: { values: ['', ...LOCATIONS], message: '{VALUE} is not a recognised location' },
      default: '',
    },
    isOptional: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

holidaySchema.index({ date: 1, location: 1 }, { unique: true });

module.exports = mongoose.model('Holiday', holidaySchema);
