'use strict';

const test = require('node:test');
const assert = require('node:assert');
const pf = require('../src/services/personnelFile.service');

const fields = (fn) => { try { fn(); } catch (e) { return e.details.map((d) => d.field); } return []; };

test('each hand-kept list checks its required fields and dates', () => {
  assert.deepStrictEqual(fields(() => pf.cleanEntry('promotions', {})).sort(), ['date', 'newDesignation']);
  assert.ok(fields(() => pf.cleanEntry('promotions', { date: '31/02/2020', newDesignation: 'X' })).includes('date'));
  const ok = pf.cleanEntry('transfers', { date: '2024-03-05', fromSection: ' A ', toSection: 'B' });
  assert.strictEqual(ok.fromSection, 'A');
  assert.strictEqual(ok.date.toISOString(), '2024-03-05T00:00:00.000Z');
  assert.deepStrictEqual(fields(() => pf.cleanEntry('discipline', {})), ['description']);
  assert.ok(pf.cleanEntry('training', { description: 'Course', from: '', to: '' }).from === null);
});

test('heirs need a name, a relation and a share between 0 and 100', () => {
  assert.deepStrictEqual(fields(() => pf.cleanEntry('heirs', {})).sort(), ['fullName', 'relation']);
  assert.ok(fields(() => pf.cleanEntry('heirs', { fullName: 'A', relation: 'B', share: 150 })).includes('share'));
  assert.strictEqual(pf.cleanEntry('heirs', { fullName: 'A', relation: 'B', share: '25' }).share, 25);
});

test('unknown lists are refused', () => {
  assert.throws(() => pf.cleanEntry('salary', {}), /Unknown list/);
});
