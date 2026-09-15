'use strict';

/**
 * Performance cycle rules. Scores are 1–5; completion is 0–100. Periods are
 * calendar halves (`YYYY-H1` / `YYYY-H2`) so a review always has a named window
 * rather than an ad-hoc date range.
 */

const SCORE_MIN = 1;
const SCORE_MAX = 5;

const WEIGHT_MIN = 1;
const WEIGHT_MAX = 100;

const COMPLETION_MIN = 0;
const COMPLETION_MAX = 100;

const PERIOD_RE = /^\d{4}-H[12]$/;

const STATUSES = ['assigned', 'self_submitted', 'reviewed'];

const STATUS_LABELS = {
  assigned: 'Awaiting self-assessment',
  self_submitted: 'Awaiting review',
  reviewed: 'Reviewed',
};

const SCORE_LABELS = {
  1: 'Unsatisfactory',
  2: 'Needs improvement',
  3: 'Meets expectations',
  4: 'Exceeds expectations',
  5: 'Outstanding',
};

const TITLE_MIN = 3;
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 500;
const TARGET_MAX = 120;
const NOTES_MAX = 2000;

function currentPeriod(date = new Date()) {
  const year = date.getFullYear();
  const half = date.getMonth() < 6 ? 'H1' : 'H2';
  return `${year}-${half}`;
}

function availablePeriods(date = new Date()) {
  const year = date.getFullYear();
  const periods = [];
  for (let offset = -1; offset <= 1; offset += 1) {
    periods.push(`${year + offset}-H1`, `${year + offset}-H2`);
  }
  return periods;
}

function periodLabel(period) {
  const [year, half] = String(period).split('-');
  if (!year || !half) return period;
  return half === 'H1' ? `${year} first half` : `${year} second half`;
}

function isValidPeriod(value) {
  return PERIOD_RE.test(String(value || '').trim());
}

function metaPayload() {
  const now = currentPeriod();
  return {
    currentPeriod: now,
    periods: availablePeriods().map((value) => ({
      value,
      label: periodLabel(value),
      current: value === now,
    })),
    statuses: STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] })),
    scores: Object.keys(SCORE_LABELS).map((key) => ({
      value: Number(key),
      label: SCORE_LABELS[key],
    })),
    scoreMin: SCORE_MIN,
    scoreMax: SCORE_MAX,
    weightMin: WEIGHT_MIN,
    weightMax: WEIGHT_MAX,
  };
}

module.exports = {
  SCORE_MIN,
  SCORE_MAX,
  WEIGHT_MIN,
  WEIGHT_MAX,
  COMPLETION_MIN,
  COMPLETION_MAX,
  PERIOD_RE,
  STATUSES,
  STATUS_LABELS,
  SCORE_LABELS,
  TITLE_MIN,
  TITLE_MAX,
  DESCRIPTION_MAX,
  TARGET_MAX,
  NOTES_MAX,
  currentPeriod,
  availablePeriods,
  periodLabel,
  isValidPeriod,
  metaPayload,
};
