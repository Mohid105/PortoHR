'use strict';

/**
 * Country-pack labels for filings, licenses and policy acknowledgements.
 * Statutory membership itself stays on Core HR; this module tracks the calendar.
 */

const COUNTRIES = ['PK'];

const COUNTRY_LABELS = {
  PK: 'Pakistan',
};

const FILING_FREQUENCIES = ['monthly', 'quarterly', 'annual'];

const FREQUENCY_LABELS = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
};

const FILING_CATEGORIES = ['tax', 'social_security', 'pension', 'labour', 'other'];

const FILING_CATEGORY_LABELS = {
  tax: 'Tax / NTN',
  social_security: 'Social security',
  pension: 'Pension / EOBI',
  labour: 'Labour return',
  other: 'Other',
};

const FILING_STATUSES = ['upcoming', 'due', 'overdue', 'filed'];

const FILING_STATUS_LABELS = {
  upcoming: 'Upcoming',
  due: 'Due soon',
  overdue: 'Overdue',
  filed: 'Filed',
};

const LICENSE_KINDS = ['labour', 'company', 'work_visa', 'professional', 'other'];

const LICENSE_KIND_LABELS = {
  labour: 'Labour / establishment',
  company: 'Company / SECP',
  work_visa: 'Work visa / permit',
  professional: 'Professional licence',
  other: 'Other',
};

const LICENSE_SCOPES = ['company', 'employee'];

const LICENSE_SCOPE_LABELS = {
  company: 'Company',
  employee: 'Employee',
};

const LICENSE_STATUSES = ['active', 'expired', 'revoked'];

const LICENSE_STATUS_LABELS = {
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked',
};

const POLICY_STATUSES = ['draft', 'published', 'archived'];

const POLICY_STATUS_LABELS = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

const RETENTION_CATEGORIES = ['personnel', 'payroll', 'attendance', 'employee_relations', 'learning'];

const RETENTION_CATEGORY_LABELS = {
  personnel: 'Personnel file',
  payroll: 'Payroll',
  attendance: 'Attendance',
  employee_relations: 'Employee relations',
  learning: 'Learning records',
};

const RETENTION_ACTIONS = ['archive', 'anonymize', 'delete'];

const RETENTION_ACTION_LABELS = {
  archive: 'Archive',
  anonymize: 'Anonymize',
  delete: 'Delete',
};

/** Demo clock is 13 Sep 2026 — a 45-day window surfaces the seeded renewals. */
const ALERT_DAYS = 45;
const DUE_SOON_DAYS = 14;

function asOptions(values, labels) {
  return values.map((value) => ({ value, label: labels[value] || value }));
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function dateOnly(value) {
  const day = new Date(value);
  day.setHours(0, 0, 0, 0);
  return day;
}

function addDays(value, days) {
  const day = dateOnly(value);
  day.setDate(day.getDate() + days);
  return day;
}

function filingStatus(dueOn, filedOn, today = new Date()) {
  if (filedOn) return 'filed';
  const due = dateOnly(dueOn);
  const now = dateOnly(today);
  if (due < now) return 'overdue';
  if (due <= addDays(now, DUE_SOON_DAYS)) return 'due';
  return 'upcoming';
}

function expiryStatus(expiresOn, status, today = new Date()) {
  if (status === 'revoked') return 'revoked';
  if (!expiresOn) return status || 'active';
  if (dateOnly(expiresOn) < dateOnly(today)) return 'expired';
  return status || 'active';
}

function dueDatesForYear(rule, year) {
  let months = Array.isArray(rule.dueMonths) && rule.dueMonths.length ? rule.dueMonths.slice() : null;
  if (!months) {
    if (rule.frequency === 'monthly') months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    else if (rule.frequency === 'quarterly') months = [1, 4, 7, 10];
    else months = [Number(rule.dueMonth) || 12];
  }
  return months.map((month) => {
    const m = Number(month);
    const cap = daysInMonth(year, m);
    const day = Math.min(Math.max(Number(rule.dueDay) || 15, 1), cap);
    return new Date(year, m - 1, day);
  });
}

function metaPayload() {
  return {
    countries: asOptions(COUNTRIES, COUNTRY_LABELS),
    frequencies: asOptions(FILING_FREQUENCIES, FREQUENCY_LABELS),
    filingCategories: asOptions(FILING_CATEGORIES, FILING_CATEGORY_LABELS),
    filingStatuses: asOptions(FILING_STATUSES, FILING_STATUS_LABELS),
    licenseKinds: asOptions(LICENSE_KINDS, LICENSE_KIND_LABELS),
    licenseScopes: asOptions(LICENSE_SCOPES, LICENSE_SCOPE_LABELS),
    licenseStatuses: asOptions(LICENSE_STATUSES, LICENSE_STATUS_LABELS),
    policyStatuses: asOptions(POLICY_STATUSES, POLICY_STATUS_LABELS),
    retentionCategories: asOptions(RETENTION_CATEGORIES, RETENTION_CATEGORY_LABELS),
    retentionActions: asOptions(RETENTION_ACTIONS, RETENTION_ACTION_LABELS),
    alertDays: ALERT_DAYS,
    dueSoonDays: DUE_SOON_DAYS,
  };
}

module.exports = {
  COUNTRIES,
  COUNTRY_LABELS,
  FILING_FREQUENCIES,
  FREQUENCY_LABELS,
  FILING_CATEGORIES,
  FILING_CATEGORY_LABELS,
  FILING_STATUSES,
  FILING_STATUS_LABELS,
  LICENSE_KINDS,
  LICENSE_KIND_LABELS,
  LICENSE_SCOPES,
  LICENSE_SCOPE_LABELS,
  LICENSE_STATUSES,
  LICENSE_STATUS_LABELS,
  POLICY_STATUSES,
  POLICY_STATUS_LABELS,
  RETENTION_CATEGORIES,
  RETENTION_CATEGORY_LABELS,
  RETENTION_ACTIONS,
  RETENTION_ACTION_LABELS,
  ALERT_DAYS,
  DUE_SOON_DAYS,
  dueDatesForYear,
  filingStatus,
  expiryStatus,
  dateOnly,
  addDays,
  metaPayload,
};
