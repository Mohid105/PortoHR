'use strict';

const test = require('node:test');
const assert = require('node:assert');
const z = require('../src/utils/zoned');

const PK = 'Asia/Karachi'; // UTC+5, no daylight saving

test('the local day is decided by the company clock, not UTC', () => {
  // 02:00 on 5 Oct in Karachi is 21:00 on 4 Oct in UTC.
  const punch = new Date('2026-10-04T21:00:00Z');
  assert.strictEqual(z.dateKey(punch, PK), '2026-10-05');
  assert.strictEqual(z.dateKey(punch, 'UTC'), '2026-10-04');
  assert.strictEqual(z.clock(punch, PK), '02:00');
  assert.strictEqual(z.minutesOfDay(punch, PK), 120);
});

test('a wall-clock time converts back to the right instant', () => {
  assert.strictEqual(z.zonedTime('2026-10-05', '09:00', PK).toISOString(), '2026-10-05T04:00:00.000Z');
  assert.strictEqual(z.zonedTime('2026-10-05', '00:30', PK).toISOString(), '2026-10-04T19:30:00.000Z');
});

test('daylight saving does not shift a wall-clock time', () => {
  // New York springs forward on 8 Mar 2026: 09:00 is UTC-4 afterwards, UTC-5 before.
  assert.strictEqual(z.zonedTime('2026-03-07', '09:00', 'America/New_York').toISOString(), '2026-03-07T14:00:00.000Z');
  assert.strictEqual(z.zonedTime('2026-03-09', '09:00', 'America/New_York').toISOString(), '2026-03-09T13:00:00.000Z');
});

test('date helpers', () => {
  assert.strictEqual(z.addDays('2026-10-31', 1), '2026-11-01');
  assert.strictEqual(z.addDays('2026-01-01', -1), '2025-12-31');
  assert.strictEqual(z.weekdayOf('2026-10-04'), 0); // Sunday
  assert.strictEqual(z.isValidTimeZone('Mars/Olympus'), false);
});
