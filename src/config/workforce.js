'use strict';

/**
 * Effective-dated assignments and the risk-based maker-checker gate from the
 * Core HR design: high-risk org/pay events always wait for a checker; medium
 * events (shift, manager) wait by default; low-risk contact updates post immediately.
 */

const { HIGH_ASSIGNMENT_FIELDS, MEDIUM_ASSIGNMENT_FIELDS, LOW_SELF_FIELDS } = require('./org');

const ASSIGNMENT_STATUSES = ['pending', 'scheduled', 'active', 'superseded', 'rejected', 'cancelled'];

const ASSIGNMENT_STATUS_LABELS = {
  pending: 'Pending approval',
  scheduled: 'Scheduled',
  active: 'Active',
  superseded: 'Superseded',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

/** Fields that live on Person and are not rewritten by an assignment change. */
const IDENTITY_FIELDS = [
  'firstName',
  'middleName',
  'lastName',
  'preferredName',
  'fatherName',
  'dateOfBirth',
  'gender',
  'maritalStatus',
  'nationality',
  'personalEmail',
  'mobile',
];

/** Official work contact lives on the employment record. */
const CONTACT_FIELDS = ['email', 'phone', 'address'];

/** Contract fields. Changing them does not open a new assignment row. */
const EMPLOYMENT_FIELDS = [
  'employmentType',
  'employmentStatus',
  'dateOfJoining',
  'annualLeaveDays',
  'employeeCategory',
  'legalEntity',
  'location',
  'payGroup',
  'probationEndDate',
  'confirmationDate',
  'originalHireDate',
];

/**
 * Placement and pay. Any change here writes a new Assignment rather than
 * mutating the live employee document.
 */
const ASSIGNMENT_FIELDS = [
  'designation',
  'department',
  'team',
  'shiftType',
  'restDays',
  'reportsTo',
  'reportsToPosition',
  'position',
  'grade',
  'orgRole',
  'location',
  'compensation',
];

/** High-risk assignment fields always require a checker before they go live. */
const CHECKER_FIELDS = HIGH_ASSIGNMENT_FIELDS.concat(MEDIUM_ASSIGNMENT_FIELDS);

module.exports = {
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_STATUS_LABELS,
  IDENTITY_FIELDS,
  CONTACT_FIELDS,
  EMPLOYMENT_FIELDS,
  ASSIGNMENT_FIELDS,
  CHECKER_FIELDS,
  HIGH_ASSIGNMENT_FIELDS,
  MEDIUM_ASSIGNMENT_FIELDS,
  LOW_SELF_FIELDS,
};
