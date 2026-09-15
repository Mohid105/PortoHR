'use strict';

/**
 * Voluntary benefit plans sit on top of Core HR statutory schemes. Changing
 * the open-enrollment window here is a policy edit, not a screen change.
 */

const PLAN_CATEGORIES = ['medical', 'life', 'retirement', 'wellness'];

const CATEGORY_LABELS = {
  medical: 'Medical',
  life: 'Life insurance',
  retirement: 'Retirement',
  wellness: 'Wellness',
};

const PLAN_STATUSES = ['draft', 'published', 'closed'];

const PLAN_STATUS_LABELS = {
  draft: 'Draft',
  published: 'Published',
  closed: 'Closed',
};

const ENROLLMENT_STATUSES = ['pending', 'active', 'ended', 'rejected'];

const ENROLLMENT_STATUS_LABELS = {
  pending: 'Pending approval',
  active: 'Active',
  ended: 'Ended',
  rejected: 'Rejected',
};

const ENROLLMENT_SOURCES = ['auto', 'open_enrollment', 'life_event', 'hr'];

const SOURCE_LABELS = {
  auto: 'Grade default',
  open_enrollment: 'Open enrollment',
  life_event: 'Life event',
  hr: 'HR assignment',
};

const LIFE_EVENTS = ['marriage', 'birth', 'divorce', 'death_of_dependent', 'loss_of_coverage'];

const LIFE_EVENT_LABELS = {
  marriage: 'Marriage',
  birth: 'Birth / adoption',
  divorce: 'Divorce / separation',
  death_of_dependent: 'Death of a dependent',
  loss_of_coverage: 'Loss of other coverage',
};

/** 2026 window is open on the demo clock (13 Sep 2026). */
const OPEN_ENROLLMENT = {
  year: 2026,
  startsOn: '2026-09-01',
  endsOn: '2026-09-30',
};

function asOptions(values, labels) {
  return values.map((value) => ({ value, label: labels[value] || value }));
}

function inOpenEnrollment(date = new Date()) {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  const start = new Date(`${OPEN_ENROLLMENT.startsOn}T00:00:00`);
  const end = new Date(`${OPEN_ENROLLMENT.endsOn}T23:59:59`);
  return day >= start && day <= end;
}

function metaPayload() {
  return {
    categories: asOptions(PLAN_CATEGORIES, CATEGORY_LABELS),
    planStatuses: asOptions(PLAN_STATUSES, PLAN_STATUS_LABELS),
    enrollmentStatuses: asOptions(ENROLLMENT_STATUSES, ENROLLMENT_STATUS_LABELS),
    sources: asOptions(ENROLLMENT_SOURCES, SOURCE_LABELS),
    lifeEvents: asOptions(LIFE_EVENTS, LIFE_EVENT_LABELS),
    openEnrollment: Object.assign({}, OPEN_ENROLLMENT, { open: inOpenEnrollment() }),
  };
}

module.exports = {
  PLAN_CATEGORIES,
  CATEGORY_LABELS,
  PLAN_STATUSES,
  PLAN_STATUS_LABELS,
  ENROLLMENT_STATUSES,
  ENROLLMENT_STATUS_LABELS,
  ENROLLMENT_SOURCES,
  SOURCE_LABELS,
  LIFE_EVENTS,
  LIFE_EVENT_LABELS,
  OPEN_ENROLLMENT,
  inOpenEnrollment,
  metaPayload,
};
