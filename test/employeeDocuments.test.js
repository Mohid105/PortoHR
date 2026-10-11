'use strict';

const test = require('node:test');
const assert = require('node:assert');
const docs = require('../src/services/employeeDocuments.service');
const pdf = require('../src/services/pdf/pdfKit');

test('dates and times print the way the paper forms do', () => {
  assert.strictEqual(pdf.day('2025-01-02'), '02-JAN-25');
  assert.strictEqual(pdf.day(new Date('2026-12-31T00:00:00Z')), '31-DEC-26');
  assert.strictEqual(pdf.monthLabel('2025-03'), 'MAR-2025');
  assert.strictEqual(pdf.hhmm(2.1667), '02:10');
  assert.strictEqual(pdf.hhmm(0), '00:00');
  assert.strictEqual(pdf.money(1118633), '1,118,633');
});

test('periods are validated before any file is built', () => {
  assert.deepStrictEqual(docs.monthsIn({ from: '2026-01', to: '2026-03' }), ['2026-01', '2026-02', '2026-03']);
  assert.deepStrictEqual(docs.monthsIn({ month: '2026-09' }), ['2026-09']);
  assert.throws(() => docs.monthsIn({ from: '2026-05', to: '2026-01' }), /starts after/);
  assert.throws(() => docs.monthsIn({ from: '2026-13' }), /valid month/);
  assert.throws(() => docs.monthsIn({ from: '2024-01', to: '2026-12' }), /twelve months/);
  assert.deepStrictEqual(docs.dayRange({ from: '2025-01-01', to: '2025-12-31' }), { from: '2025-01-01', to: '2025-12-31' });
  assert.throws(() => docs.dayRange({ from: '2025-02-30', to: '2025-12-31' }), /valid period/);
  assert.throws(() => docs.dayRange({ from: '2020-01-01', to: '2026-01-01' }), /three years/);
});

test('a table that outgrows the page continues on the next one with its header', () => {
  const doc = pdf.create();
  const rows = Array.from({ length: 120 }, (_, i) => ({ n: i + 1, t: `Row ${i + 1}` }));
  pdf.table(doc, [{ label: 'No', key: 'n' }, { label: 'Text', key: 't', w: 3 }], rows);
  const pages = doc.bufferedPageRange().count;
  pdf.finish(doc);
  assert.ok(pages >= 3, `expected several pages, got ${pages}`);
});
