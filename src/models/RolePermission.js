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

const rolePermissionSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ROLE_VALUES, required: true, unique: true },
    modules: { type: [String], default: [] },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

module.exports = mongoose.model('RolePermission', rolePermissionSchema);
