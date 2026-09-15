'use strict';

/**
 * Reference data shared by the Employee schema and the Core HR UI. The form
 * dropdowns are populated from GET /api/employees/meta, so options can never
 * drift out of sync with what the schema will accept.
 */

const DEPARTMENTS = [
  'Human Resources',
  'Engineering',
  'Finance',
  'Sales',
  'Marketing',
  'Operations',
  'Customer Support',
  'Legal',
];

const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'intern'];

const EMPLOYMENT_TYPE_LABELS = {
  full_time: 'Full time',
  part_time: 'Part time',
  contract: 'Contract',
  intern: 'Intern',
};

const EMPLOYMENT_STATUSES = ['probation', 'confirmed', 'notice_period', 'resigned', 'terminated'];

const EMPLOYMENT_STATUS_LABELS = {
  probation: 'Probation',
  confirmed: 'Confirmed',
  notice_period: 'Notice period',
  resigned: 'Resigned',
  terminated: 'Terminated',
};

const SHIFT_TYPES = ['general', 'morning', 'evening', 'night', 'rotational'];

/**
 * `expectedHours` is the paid working time a full day owes: the window length
 * minus the unpaid break. Attendance measures against this, so it is the number
 * that decides overtime and short days.
 */
const SHIFT_DEFINITIONS = {
  general: { label: 'General', startTime: '09:00', endTime: '18:00', breakMinutes: 60, expectedHours: 8 },
  morning: { label: 'Morning', startTime: '06:00', endTime: '14:00', breakMinutes: 30, expectedHours: 7.5 },
  evening: { label: 'Evening', startTime: '14:00', endTime: '22:00', breakMinutes: 30, expectedHours: 7.5 },
  night: { label: 'Night', startTime: '22:00', endTime: '06:00', breakMinutes: 30, expectedHours: 7.5 },
  rotational: { label: 'Rotational', startTime: null, endTime: null, breakMinutes: 30, expectedHours: 8 },
};

const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const WEEKDAY_LABELS = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
};

const GENDERS = ['female', 'male', 'other', 'undisclosed'];

const CURRENCIES = ['USD', 'EUR', 'GBP', 'PKR', 'AED', 'INR'];

const LOCATIONS = ['Karachi HQ', 'Lahore', 'Islamabad', 'Remote'];

const { orgMeta } = require('./org');

/** Shape consumed by the Core HR form dropdowns. */
function metaPayload() {
  const asOptions = (values, labels) =>
    values.map((value) => ({ value, label: (labels && labels[value]) || value }));

  return Object.assign(
    {
      departments: DEPARTMENTS,
      employmentTypes: asOptions(EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS),
      employmentStatuses: asOptions(EMPLOYMENT_STATUSES, EMPLOYMENT_STATUS_LABELS),
      shiftTypes: SHIFT_TYPES.map((value) => Object.assign({ value }, SHIFT_DEFINITIONS[value])),
      weekdays: asOptions(WEEKDAYS, WEEKDAY_LABELS),
      genders: GENDERS,
      currencies: CURRENCIES,
      locations: LOCATIONS,
    },
    orgMeta()
  );
}

module.exports = {
  DEPARTMENTS,
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABELS,
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_STATUS_LABELS,
  SHIFT_TYPES,
  SHIFT_DEFINITIONS,
  WEEKDAYS,
  WEEKDAY_LABELS,
  GENDERS,
  CURRENCIES,
  LOCATIONS,
  metaPayload,
};
