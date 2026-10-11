'use strict';

const test = require('node:test');
const assert = require('node:assert');
const engine = require('../src/services/attendanceEngine');
const registry = require('../src/config/shiftRegistry');
const z = require('../src/utils/zoned');

const TZ = 'Asia/Karachi';
const at = (day, hhmm) => ({ at: z.zonedTime(day, hhmm, TZ) });
const general = registry.get('general'); // 09:00-18:00, 60 min break, 8 h
const night = registry.get('night'); // 22:00-06:00, 30 min break, 7.5 h
const NOW = z.zonedTime('2026-10-10', '12:00', TZ);

test('a normal day: on time, full hours, no flags', () => {
  const day = engine.computeDay({ dayKey: '2026-10-05', punches: [at('2026-10-05', '08:58'), at('2026-10-05', '18:02')], shift: general, timeZone: TZ, now: NOW });
  assert.strictEqual(day.hoursWorked, 8.07);
  assert.strictEqual(day.overtimeHours, 0);
  assert.strictEqual(day.shortfallHours, 0);
  assert.strictEqual(day.lateMinutes, 0);
  assert.strictEqual(day.shiftStatus, 'present');
  assert.deepStrictEqual(day.flags, []);
});

test('late arrival beyond grace is flagged, within grace is not', () => {
  const grace = engine.computeDay({ dayKey: '2026-10-05', punches: [at('2026-10-05', '09:08'), at('2026-10-05', '18:10')], shift: general, timeZone: TZ, now: NOW });
  assert.strictEqual(grace.lateMinutes, 0);
  const late = engine.computeDay({ dayKey: '2026-10-05', punches: [at('2026-10-05', '09:40'), at('2026-10-05', '18:40')], shift: general, timeZone: TZ, now: NOW });
  assert.strictEqual(late.lateMinutes, 40);
  assert.ok(late.flags.includes('late'));
});

test('overtime counts only past the threshold, in whole blocks', () => {
  // 9:00-20:20 = 11h20 - 1h break = 10h20 -> 2h20 over -> 2h15 after rounding down to 15 min
  const day = engine.computeDay({ dayKey: '2026-10-05', punches: [at('2026-10-05', '09:00'), at('2026-10-05', '20:20')], shift: general, timeZone: TZ, now: NOW });
  assert.strictEqual(day.overtimeHours, 2.25);
  const small = engine.computeDay({ dayKey: '2026-10-05', punches: [at('2026-10-05', '09:00'), at('2026-10-05', '18:10')], shift: general, timeZone: TZ, now: NOW });
  assert.strictEqual(small.overtimeHours, 0);
});

test('leaving early makes a short day', () => {
  const day = engine.computeDay({ dayKey: '2026-10-05', punches: [at('2026-10-05', '09:00'), at('2026-10-05', '14:00')], shift: general, timeZone: TZ, now: NOW });
  assert.strictEqual(day.shiftStatus, 'short_day');
  assert.strictEqual(day.shortfallHours, 4);
  assert.ok(day.flags.includes('early_exit'));
});

test('a night shift spans midnight and still belongs to the day it began', () => {
  const day = engine.computeDay({
    dayKey: '2026-10-05',
    punches: [at('2026-10-05', '21:55'), { at: z.zonedTime('2026-10-06', '06:05', TZ) }],
    shift: night, timeZone: TZ, now: NOW,
  });
  assert.strictEqual(day.hoursWorked, 7.67);
  assert.strictEqual(day.lateMinutes, 0);
  assert.strictEqual(day.earlyExitMinutes, 0);
  assert.strictEqual(day.shiftStatus, 'present');
});

test('which shift day a punch belongs to', () => {
  const shiftOfDay = (key) => (key === '2026-10-05' ? night : general);
  // 06:05 on the 6th closes the night shift that began on the 5th.
  assert.strictEqual(engine.shiftDayOf(z.zonedTime('2026-10-06', '06:05', TZ), TZ, shiftOfDay), '2026-10-05');
  // 09:00 on the 6th is a normal day-shift punch.
  assert.strictEqual(engine.shiftDayOf(z.zonedTime('2026-10-06', '09:00', TZ), TZ, shiftOfDay), '2026-10-06');
  // 21:50 on the 5th is the start of the night shift.
  assert.strictEqual(engine.shiftDayOf(z.zonedTime('2026-10-05', '21:50', TZ), TZ, shiftOfDay), '2026-10-05');
});

test('a missing out-punch leaves the day open, and flags it once it is stale', () => {
  const fresh = engine.computeDay({ dayKey: '2026-10-10', punches: [at('2026-10-10', '09:05')], shift: general, timeZone: TZ, now: z.zonedTime('2026-10-10', '13:00', TZ) });
  assert.strictEqual(fresh.open, true);
  assert.strictEqual(fresh.timeOut, null);
  assert.ok(!fresh.flags.includes('missed_punch'));
  const stale = engine.computeDay({ dayKey: '2026-10-05', punches: [at('2026-10-05', '09:05')], shift: general, timeZone: TZ, now: NOW });
  assert.ok(stale.flags.includes('missed_punch'));
});

test('double taps are ignored', () => {
  const day = engine.computeDay({ dayKey: '2026-10-05', punches: [at('2026-10-05', '09:00'), at('2026-10-05', '09:01'), at('2026-10-05', '18:00'), at('2026-10-05', '18:01')], shift: general, timeZone: TZ, now: NOW });
  assert.strictEqual(day.punchCount, 2);
  assert.strictEqual(day.open, false);
});

test('work on a weekly rest day is overtime from the first hour', () => {
  const day = engine.computeDay({ dayKey: '2026-10-04', punches: [at('2026-10-04', '10:00'), at('2026-10-04', '14:10')], shift: general, timeZone: TZ, now: NOW, isRestDay: true });
  assert.strictEqual(day.overtimeHours, 3);
  assert.ok(day.flags.includes('rest_day_work'));
  assert.strictEqual(day.lateMinutes, 0);
});

test('breaks punched out and back in are not deducted twice', () => {
  const day = engine.computeDay({
    dayKey: '2026-10-05',
    punches: [at('2026-10-05', '09:00'), at('2026-10-05', '13:00'), at('2026-10-05', '14:00'), at('2026-10-05', '18:00')],
    shift: general, timeZone: TZ, now: NOW,
  });
  assert.strictEqual(day.hoursWorked, 8);
});

test('late marks cost pay only when the policy says so', () => {
  assert.strictEqual(engine.latePenaltyDays(7, {}), 0);
  assert.strictEqual(engine.latePenaltyDays(7, { late: { penaltyEveryNLates: 3, penaltyDays: 0.5 } }), 1);
});

test('on-screen punches are never merged as double taps, device taps are', () => {
  const t0 = z.zonedTime('2026-10-05', '09:00', TZ);
  const web = (ms, source) => ({ at: new Date(t0.getTime() + ms), source });
  assert.strictEqual(engine.cleanPunches([web(0, 'web'), web(30000, 'web')], {}).length, 2);
  assert.strictEqual(engine.cleanPunches([web(0, 'device'), web(30000, 'device')], {}).length, 1);
});
