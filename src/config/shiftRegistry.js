'use strict';

/**
 * The shifts in force, held in memory so the payroll and attendance engines
 * can stay synchronous and pure. HR edits shifts in the database; the shift
 * service refreshes this registry after every change and at start-up. Until
 * the first refresh the built-in defaults apply.
 */

const { SHIFT_DEFINITIONS } = require('./hr');

const DEFAULT_GRACE_IN = 10;
const DEFAULT_GRACE_OUT = 10;
const DEFAULT_PRE_WINDOW = 240;
const DEFAULT_POST_WINDOW = 360;

function toMinutes(hhmm) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Fills in everything derived, so callers never recompute it. */
function normalise(code, raw) {
  const start = toMinutes(raw.startTime);
  const end = toMinutes(raw.endTime);
  const fixed = start !== null && end !== null;
  const overnight = fixed && end <= start;
  const breakMinutes = Number.isFinite(Number(raw.breakMinutes)) ? Number(raw.breakMinutes) : 0;
  const windowMinutes = fixed ? (overnight ? end + 1440 - start : end - start) : 0;
  const derived = fixed ? Math.round(((windowMinutes - breakMinutes) / 60) * 100) / 100 : 8;
  return {
    type: code,
    code,
    label: raw.label || raw.name || code,
    startTime: fixed ? raw.startTime : null,
    endTime: fixed ? raw.endTime : null,
    startMin: start,
    endMin: end,
    fixed,
    overnight,
    breakMinutes,
    expectedHours: Number(raw.expectedHours) > 0 ? Number(raw.expectedHours) : derived,
    graceInMinutes: raw.graceInMinutes !== undefined ? Number(raw.graceInMinutes) : DEFAULT_GRACE_IN,
    graceOutMinutes: raw.graceOutMinutes !== undefined ? Number(raw.graceOutMinutes) : DEFAULT_GRACE_OUT,
    preWindowMinutes: raw.preWindowMinutes !== undefined ? Number(raw.preWindowMinutes) : DEFAULT_PRE_WINDOW,
    postWindowMinutes: raw.postWindowMinutes !== undefined ? Number(raw.postWindowMinutes) : DEFAULT_POST_WINDOW,
    color: raw.color || '',
    active: raw.active !== false,
  };
}

const defaults = {};
Object.keys(SHIFT_DEFINITIONS).forEach((code) => {
  defaults[code] = normalise(code, SHIFT_DEFINITIONS[code]);
});

let current = Object.assign({}, defaults);

function set(list) {
  const next = {};
  (list || []).forEach((row) => {
    next[row.code] = normalise(row.code, row);
  });
  // Never leave the registry empty: employees still reference the built-ins.
  current = Object.keys(next).length ? next : Object.assign({}, defaults);
}

function get(code) {
  return current[code] || defaults[code] || defaults.rotational;
}

function has(code) {
  return Boolean(current[code]);
}

function all() {
  return Object.keys(current).map((code) => current[code]);
}

function codes() {
  return Object.keys(current);
}

module.exports = { normalise, set, get, has, all, codes, defaults, toMinutes };
