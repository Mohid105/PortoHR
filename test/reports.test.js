'use strict';

const test = require('node:test');
const assert = require('node:assert');
const engine = require('../src/services/reports/engine');
const datasets = require('../src/services/reports/datasets');
const { REPORTS } = require('../src/services/reports/library');
const employeeReport = require('../src/services/reports/employeeReport.service');

const HR = { role: 'hr_admin' };
const MANAGER = { role: 'manager' };

const col = (key, type, extra) => Object.assign({ key, label: key, type, filterable: true, path: key }, extra);
const def = {
  key: 'demo',
  label: 'Demo',
  access: 'all',
  columns: [
    col('name', 'text', { groupable: true }),
    col('dept', 'text', { groupable: true }),
    col('status', 'enum', { groupable: true, options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }] }),
    col('pay', 'money', { summable: true }),
    col('joined', 'date', { groupable: true }),
    col('seen', 'datetime'),
    col('active', 'bool', { groupable: true }),
    col('secret', 'text', { hr: true }),
  ],
  defaultColumns: ['name', 'dept', 'pay'],
  defaultSort: { key: 'name', dir: 'asc' },
};
const run = (body, user = HR, records) => engine.process(def, engine.plan(def, body, user), records, user);

const people = [
  { name: 'Ana', dept: 'Eng', status: 'a', pay: 100, joined: new Date('2024-01-15T00:00:00Z'), active: true },
  { name: 'Ben', dept: 'Eng', status: 'b', pay: 300, joined: new Date('2024-02-20T00:00:00Z'), active: true },
  { name: 'Cleo', dept: 'Ops', status: 'a', pay: 200, joined: new Date('2025-01-02T00:00:00Z'), active: false },
  { name: 'dan', dept: null, status: 'b', pay: null, joined: null, active: false },
];

test('text, enum, number and bool filters', () => {
  const t = (c, v, f) => engine.testFilter(c, v, f);
  const text = col('name', 'text');
  assert.ok(t(text, 'Ana Maria', { op: 'contains', value: 'maria' }));
  assert.ok(t(text, 'Ana', { op: 'equals', value: 'ANA' }));
  assert.ok(t(text, 'Ana', { op: 'in', value: ['ben', 'ana'] }));
  assert.ok(t(text, null, { op: 'not_equals', value: 'x' }), 'a blank is "not equal" to anything');
  assert.ok(!t(text, null, { op: 'contains', value: 'x' }));
  assert.ok(t(text, '', { op: 'empty' }) && t(text, 'x', { op: 'not_empty' }));
  const num = col('pay', 'money');
  assert.ok(t(num, 150, { op: 'between', value: 200, value2: 100 }), 'between ignores the order of its ends');
  assert.ok(!t(num, null, { op: 'lt', value: 1000 }), 'a blank is never less than a number');
  assert.ok(t(col('s', 'enum'), 'b', { op: 'not_in', value: ['a'] }));
  const bool = col('active', 'bool');
  assert.ok(t(bool, true, { op: 'is_true' }) && t(bool, null, { op: 'is_false' }) && !t(bool, true, { op: 'is_false' }));
});

test('date filters compare calendar days, using the company timezone for timestamps', () => {
  const date = col('joined', 'date');
  const stamp = col('seen', 'datetime');
  assert.ok(engine.testFilter(date, new Date('2024-02-20T00:00:00Z'), { op: 'on', value: '2024-02-20' }));
  assert.ok(engine.testFilter(date, new Date('2024-02-20T00:00:00Z'), { op: 'between', value: '2024-02-01', value2: '2024-02-20' }));
  assert.ok(!engine.testFilter(date, new Date('2024-02-20T00:00:00Z'), { op: 'before', value: '2024-02-20' }));
  // 22:00 UTC on the 19th is already the 20th in Karachi (UTC+5)
  assert.strictEqual(require('../src/config/env').timezone, 'Asia/Karachi');
  assert.ok(engine.testFilter(stamp, new Date('2024-02-19T22:00:00Z'), { op: 'on', value: '2024-02-20' }));
  assert.ok(!engine.testFilter(date, null, { op: 'after', value: '2000-01-01' }));
});

test('a MongoDB push-down never excludes a row the in-memory filter would keep', () => {
  const stamp = col('seen', 'datetime');
  const clause = engine.toMongo(stamp, { op: 'on', value: '2024-02-20' });
  const wanted = new Date('2024-02-19T22:00:00Z'); // the 20th in Karachi
  assert.ok(wanted >= clause.$gte && wanted < clause.$lt, 'the widened window still contains it');
  const exact = engine.toMongo(col('joined', 'date'), { op: 'on', value: '2024-02-20' });
  assert.strictEqual(exact.$gte.toISOString(), '2024-02-20T00:00:00.000Z');
  assert.strictEqual(exact.$lt.toISOString(), '2024-02-21T00:00:00.000Z');
  assert.strictEqual(engine.toMongo(col('x', 'text', { computed: true, path: undefined }), { op: 'equals', value: 'a' }), null);
  assert.deepStrictEqual(engine.toMongo(col('pay', 'money'), { op: 'between', value: 5, value2: 1 }), { $gte: 1, $lte: 5 });
  assert.ok(engine.toMongo(col('name', 'text'), { op: 'contains', value: 'a.b' }).$regex === 'a\\.b', 'regex metacharacters are escaped');
});

test('plan refuses anything outside the dataset whitelist, with a field for each problem', () => {
  const bad = (body, user) => { try { engine.plan(def, body, user || HR); } catch (e) { return e.details.map((d) => d.field); } return []; };
  assert.deepStrictEqual(bad({ columns: ['nope'] }), ['columns']);
  assert.deepStrictEqual(bad({ columns: ['secret'] }, MANAGER), ['columns'], 'HR-only columns are invisible to others');
  assert.ok(bad({ filters: [{ field: 'pay', op: 'contains', value: 'x' }] }).includes('filters.0.op'));
  assert.ok(bad({ filters: [{ field: 'pay', op: 'gt', value: 'abc' }] }).includes('filters.0.value'));
  assert.ok(bad({ filters: [{ field: 'joined', op: 'on', value: '2024-02-31' }] }).includes('filters.0.value'));
  assert.ok(bad({ groupBy: ['pay'] }).includes('groupBy.0'), 'numbers cannot be grouped on');
  assert.ok(bad({ groupBy: ['name', 'dept', 'status'] }).includes('groupBy'));
  assert.ok(bad({ aggregates: [{ fn: 'sum', field: 'name' }] }).includes('aggregates.0.field'));
  assert.ok(bad({ aggregates: [{ fn: 'median', field: 'pay' }] }).includes('aggregates.0.fn'));
  assert.ok(bad({ columns: ['name'], sort: { key: 'pay' } }).includes('sort.key'));
});

test('rows are filtered, sorted with blanks last, and trimmed to the limit', () => {
  let r = run({ columns: ['name', 'pay'], filters: [{ field: 'active', op: 'is_true' }], sort: { key: 'pay', dir: 'desc' } }, HR, people);
  assert.deepStrictEqual(r.rows, [['Ben', 300], ['Ana', 100]]);
  r = run({ columns: ['name', 'pay'], sort: { key: 'pay', dir: 'asc' } }, HR, people);
  assert.deepStrictEqual(r.rows.map((x) => x[0]), ['Ana', 'Cleo', 'Ben', 'dan'], 'the blank pay sorts last');
  r = run({ columns: ['name'], limit: 2 }, HR, people);
  assert.strictEqual(r.rows.length, 2);
  assert.strictEqual(r.total, 4, 'total counts every match, not just the rows returned');
  r = run({ columns: ['name', 'pay'] }, HR, people);
  assert.strictEqual(r.totals.pay, 600, 'summable columns are totalled over all matches');
  assert.deepStrictEqual(r.rows.map((x) => x[0]), ['Ana', 'Ben', 'Cleo', 'dan'], 'the dataset default sort applies');
});

test('grouping counts, totals and averages, and labels enums and blanks', () => {
  let r = run({ groupBy: ['dept'], aggregates: [{ fn: 'count' }, { fn: 'sum', field: 'pay' }, { fn: 'avg', field: 'pay' }] }, HR, people);
  assert.deepStrictEqual(r.columns.map((c) => c.key), ['dept', 'count', 'sum_pay', 'avg_pay']);
  assert.deepStrictEqual(r.rows, [['Eng', 2, 400, 200], ['Ops', 1, 200, 200], ['(none)', 1, 0, null]], 'busiest group first, ties by name, the blank group last');
  assert.deepStrictEqual(r.totals, { count: 4, sum_pay: 600, avg_pay: 200 });
  r = run({ groupBy: ['status'] }, HR, people);
  assert.deepStrictEqual(r.rows.map((x) => x[0]).sort(), ['Alpha', 'Beta']);
  assert.deepStrictEqual(r.rows.map((x) => x[1]), [2, 2]);
  r = run({ groupBy: [{ key: 'joined', bucket: 'year' }], aggregates: [{ fn: 'count' }] }, HR, people);
  assert.deepStrictEqual(r.rows, [['2024', 2], ['2025', 1], ['(none)', 1]], 'date groups run in time order, blanks last');
  r = run({ groupBy: ['dept', 'active'], aggregates: [{ fn: 'count' }] }, HR, people);
  assert.deepStrictEqual(r.rows, [['Eng', 'Yes', 2], ['Ops', 'No', 1], ['(none)', 'No', 1]], 'two group columns, booleans shown as Yes/No');
  r = run({ aggregates: [{ fn: 'distinct', field: 'dept' }, { fn: 'max', field: 'pay' }] }, HR, people);
  assert.deepStrictEqual(r.rows, [[2, 300]], 'totals without a grouping give one summary row');
});

test('a filter is applied before grouping', () => {
  const r = run({ filters: [{ field: 'pay', op: 'gte', value: 200 }], groupBy: ['dept'] }, HR, people);
  assert.deepStrictEqual(r.rows, [['Eng', 1], ['Ops', 1]]);
});

test('every dataset has sound columns, and every ready-made report is valid for HR', () => {
  datasets.all.forEach((d) => {
    const keys = d.columns.map((c) => c.key);
    assert.strictEqual(new Set(keys).size, keys.length, `${d.key} has a duplicate column key`);
    d.defaultColumns.forEach((k) => assert.ok(keys.includes(k), `${d.key}: default column ${k} does not exist`));
    d.columns.forEach((c) => {
      assert.ok(c.label && c.type, `${d.key}.${c.key} needs a label and type`);
      assert.ok(c.path || typeof c.get === 'function', `${d.key}.${c.key} has no way to read its value`);
      if (c.via) assert.strictEqual(c.via, 'employee');
    });
    assert.strictEqual(typeof d.scope, 'function');
  });
  REPORTS.forEach((r) => {
    const d = datasets.get(r.dataset);
    assert.ok(d, `${r.code}: unknown dataset ${r.dataset}`);
    assert.doesNotThrow(() => engine.plan(d, r.definition, HR), r.code);
  });
  assert.strictEqual(new Set(REPORTS.map((r) => r.code)).size, REPORTS.length, 'library codes are unique');
});

test('scoping: employees see only themselves, HR-only datasets stay closed, drafts are HR-only', () => {
  const ids = ['a', 'b'];
  assert.deepStrictEqual(datasets.get('leave').scope(null), {});
  assert.deepStrictEqual(datasets.get('leave').scope(ids), { employee: { $in: ids } });
  assert.deepStrictEqual(datasets.get('employees').scope(ids), { _id: { $in: ids } });
  assert.strictEqual(datasets.get('payslips').scope(null, HR).status, undefined);
  assert.deepStrictEqual(datasets.get('payslips').scope(null, MANAGER).status, { $in: ['finalised', 'paid'] });
  assert.strictEqual(datasets.get('documents').scope(null, MANAGER).confidentiality, 'general');
  assert.strictEqual(datasets.listFor(MANAGER).some((d) => d.access === 'hr'), false);
  assert.ok(datasets.listFor(HR).some((d) => d.key === 'audit'));
  assert.ok(engine.visibleColumns(datasets.get('employees'), MANAGER).every((c) => !c.hr));
});

test('employee report periods are validated, and sections follow the viewer', () => {
  const emp = { dateOfJoining: new Date('2023-06-01T00:00:00Z') };
  const p = employeeReport.periodFrom({ from: '2026-01-01', to: '2026-03-31' }, emp);
  assert.deepStrictEqual([p.fromMonth, p.toMonth], ['2026-01', '2026-03']);
  assert.strictEqual(employeeReport.periodFrom({ preset: 'since_joining' }, emp).from, '2023-06-01');
  assert.throws(() => employeeReport.periodFrom({ from: '2026-05-01', to: '2026-01-01' }, emp), /starts after/);
  assert.throws(() => employeeReport.periodFrom({ from: '2010-01-01', to: '2026-01-01' }, emp), /five years/);
  assert.throws(() => employeeReport.periodFrom({ from: 'x', to: 'y' }, emp), /valid period/);

  const keys = (access) => employeeReport.availableSections(access).map((s) => s.key);
  const hr = employeeReport.accessFor({ role: 'hr_admin', email: 'h@x' }, null, { _id: 'e1', email: 'e@x' }, false);
  const self = employeeReport.accessFor({ role: 'employee', email: 'e@x' }, { _id: 'e1' }, { _id: 'e1', email: 'e@x' }, false);
  const boss = employeeReport.accessFor({ role: 'manager', email: 'm@x' }, { _id: 'm1' }, { _id: 'e1', email: 'e@x' }, true);
  assert.ok(keys(hr).includes('audit') && keys(hr).includes('cases'));
  assert.ok(keys(self).includes('payroll') && keys(self).includes('background') && !keys(self).includes('audit') && !keys(self).includes('cases'));
  assert.ok(keys(boss).includes('payroll') && !keys(boss).includes('background') && !keys(boss).includes('cases'));
  assert.strictEqual(boss.isManager, true);
});
