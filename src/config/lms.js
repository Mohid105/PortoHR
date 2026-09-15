'use strict';

/**
 * Learning catalogue labels. Changing a delivery mode or enrollment status
 * here is a policy edit, not a hunt through the LMS screens.
 */

const DELIVERY_MODES = ['instructor_led', 'elearning', 'external'];

const DELIVERY_LABELS = {
  instructor_led: 'Instructor-led',
  elearning: 'E-learning',
  external: 'External',
};

const COURSE_STATUSES = ['draft', 'published', 'archived'];

const COURSE_STATUS_LABELS = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

const ENROLLMENT_STATUSES = ['pending', 'enrolled', 'completed', 'rejected', 'cancelled', 'no_show'];

const ENROLLMENT_STATUS_LABELS = {
  pending: 'Pending approval',
  enrolled: 'Enrolled',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};

const ENROLLMENT_SOURCES = ['self', 'manager', 'hr', 'mandatory'];

const SOURCE_LABELS = {
  self: 'Self request',
  manager: 'Manager nomination',
  hr: 'HR assignment',
  mandatory: 'Mandatory',
};

const SESSION_STATUSES = ['scheduled', 'completed', 'cancelled'];

const SESSION_STATUS_LABELS = {
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const CERT_STATUSES = ['valid', 'expiring', 'expired'];

const CERT_STATUS_LABELS = {
  valid: 'Valid',
  expiring: 'Expiring soon',
  expired: 'Expired',
};

const EXPIRING_WITHIN_DAYS = 45;

function asOptions(values, labels) {
  return values.map((value) => ({ value, label: labels[value] || value }));
}

function metaPayload() {
  return {
    deliveryModes: asOptions(DELIVERY_MODES, DELIVERY_LABELS),
    courseStatuses: asOptions(COURSE_STATUSES, COURSE_STATUS_LABELS),
    enrollmentStatuses: asOptions(ENROLLMENT_STATUSES, ENROLLMENT_STATUS_LABELS),
    sources: asOptions(ENROLLMENT_SOURCES, SOURCE_LABELS),
    sessionStatuses: asOptions(SESSION_STATUSES, SESSION_STATUS_LABELS),
    certStatuses: asOptions(CERT_STATUSES, CERT_STATUS_LABELS),
    expiringWithinDays: EXPIRING_WITHIN_DAYS,
  };
}

module.exports = {
  DELIVERY_MODES,
  DELIVERY_LABELS,
  COURSE_STATUSES,
  COURSE_STATUS_LABELS,
  ENROLLMENT_STATUSES,
  ENROLLMENT_STATUS_LABELS,
  ENROLLMENT_SOURCES,
  SOURCE_LABELS,
  SESSION_STATUSES,
  SESSION_STATUS_LABELS,
  CERT_STATUSES,
  CERT_STATUS_LABELS,
  EXPIRING_WITHIN_DAYS,
  metaPayload,
};
