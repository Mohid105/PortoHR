'use strict';

/**
 * Wall-clock time in a named timezone, without depending on the timezone the
 * server happens to run in (a VPS is usually UTC; a company is not). All
 * attendance logic goes through here so "which day was this punch" has one
 * answer everywhere.
 */

const formatters = new Map();

function formatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    );
  }
  return formatters.get(timeZone);
}

/** { year, month, day, hour, minute, second } as shown on a clock in `timeZone`. */
function parts(date, timeZone) {
  const out = {};
  formatter(timeZone)
    .formatToParts(new Date(date))
    .forEach((p) => {
      if (p.type !== 'literal') out[p.type] = Number(p.value);
    });
  return out;
}

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' of the local calendar day. */
function dateKey(date, timeZone) {
  const p = parts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Minutes since local midnight. */
function minutesOfDay(date, timeZone) {
  const p = parts(date, timeZone);
  return p.hour * 60 + p.minute;
}

/** How far `timeZone` is ahead of UTC at the given instant, in milliseconds. */
function offsetMs(utcMs, timeZone) {
  const p = parts(utcMs, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
}

/** The UTC instant at which the clock in `timeZone` shows `dateKeyStr` + `hhmm`. */
function zonedTime(dateKeyStr, hhmm, timeZone) {
  const [y, m, d] = dateKeyStr.split('-').map(Number);
  const [hh, mm] = String(hhmm || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0, 0);
  let result = guess - offsetMs(guess, timeZone);
  // One more pass settles the answer across a daylight-saving change.
  result = guess - offsetMs(result, timeZone);
  return new Date(result);
}

/** dateKey plus a number of days (negative allowed). */
function addDays(dateKeyStr, days) {
  const [y, m, d] = dateKeyStr.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** 0 = Sunday ... 6 = Saturday, for a dateKey. */
function weekdayOf(dateKeyStr) {
  const [y, m, d] = dateKeyStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 'HH:MM' on the local clock. */
function clock(date, timeZone) {
  const p = parts(date, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone }).format(new Date());
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = { parts, dateKey, minutesOfDay, zonedTime, addDays, weekdayOf, clock, isValidTimeZone, offsetMs };
