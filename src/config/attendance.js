'use strict';

/** Statuses that are actually stored on an attendance record. */
const SHIFT_STATUSES = ['present', 'short_day', 'absent', 'on_leave'];

/**
 * Statuses the API derives for days that have no record of their own — a rest
 * day, a day before the employee joined, a day still to come, or a shift that
 * has been clocked into but not out of yet.
 */
const DERIVED_STATUSES = ['in_progress', 'rest_day', 'upcoming', 'not_employed'];

const STATUS_LABELS = {
  present: 'Present',
  short_day: 'Short day',
  absent: 'Absent',
  on_leave: 'On leave',
  in_progress: 'Clocked in',
  rest_day: 'Rest day',
  upcoming: 'Upcoming',
  not_employed: 'Before joining',
};

/**
 * Tolerance either side of the expected hours. Inside this band a day counts as
 * a clean "present" — without it every day would be a few minutes over or under.
 */
const GRACE_HOURS = 0.25;

/** Used when a shift has no fixed window, e.g. rotational. */
const DEFAULT_EXPECTED_HOURS = 8;

/** An open shift older than this can no longer be closed by the employee. */
const MAX_OPEN_SHIFT_HOURS = 24;

function metaPayload() {
  return {
    statuses: SHIFT_STATUSES.concat(DERIVED_STATUSES).map((value) => ({
      value,
      label: STATUS_LABELS[value],
      stored: SHIFT_STATUSES.indexOf(value) !== -1,
    })),
    graceHours: GRACE_HOURS,
  };
}

module.exports = {
  SHIFT_STATUSES,
  DERIVED_STATUSES,
  STATUS_LABELS,
  GRACE_HOURS,
  DEFAULT_EXPECTED_HOURS,
  MAX_OPEN_SHIFT_HOURS,
  metaPayload,
};
