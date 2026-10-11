'use strict';

const mongoose = require('mongoose');

const sub = (fields) => new mongoose.Schema(fields, { timestamps: true });
const text = (max) => ({ type: String, trim: true, default: '', maxlength: max });

/**
 * The classic personnel-file details that have no home elsewhere: legacy and unit codes,
 * division and section, a few personal dates, and hand-kept history (promotions, transfers,
 * discipline, training, nominated heirs). Promotions and transfers the system can see in the
 * assignment history are derived at read time and are not stored here.
 */
const personnelFileSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, unique: true },
    legacyCode: text(40),
    unitCode: text(40),
    division: text(80),
    section: text(80),
    joinedAs: text(80),
    marriageDate: { type: Date, default: null },
    approvalDate: { type: Date, default: null },
    pfEntitledDate: { type: Date, default: null },
    groupInsurance: text(80),
    postalAddress: text(300),
    contactNumber: text(30),
    promotions: [sub({ date: { type: Date, required: true }, oldDesignation: text(100), newDesignation: text(100) })],
    transfers: [sub({ date: { type: Date, required: true }, fromSection: text(100), toSection: text(100) })],
    discipline: [sub({ date: { type: Date, default: null }, description: text(400), decision: text(200) })],
    training: [sub({ from: { type: Date, default: null }, to: { type: Date, default: null }, institute: text(120), description: text(300) })],
    heirs: [sub({ fullName: text(80), fatherName: text(80), husbandName: text(80), relation: text(40), share: { type: Number, min: 0, max: 100, default: 0 } })],
  },
  { timestamps: true }
);

module.exports = mongoose.model('PersonnelFile', personnelFileSchema);
