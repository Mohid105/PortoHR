'use strict';

const mongoose = require('mongoose');

const json = {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
};

const CATEGORIES = ['general', 'policy', 'event', 'urgent'];

const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 140 },
    body: { type: String, required: true, trim: true, maxlength: 4000 },
    category: { type: String, enum: CATEGORIES, default: 'general' },
    pinned: { type: Boolean, default: false },
    publishedAt: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date, default: null },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    authorName: { type: String, default: '' },
  },
  { timestamps: true, toJSON: json, toObject: { virtuals: true } }
);

module.exports = mongoose.model('Announcement', announcementSchema);
module.exports.CATEGORIES = CATEGORIES;
