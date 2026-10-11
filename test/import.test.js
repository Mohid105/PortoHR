'use strict';

const test = require('node:test');
const assert = require('node:assert');
const imp = require('../src/services/import.service');

test('dates are read in the formats people really use', () => {
  assert.strictEqual(imp.parseDate('2019-01-31'), '2019-01-31');
  assert.strictEqual(imp.parseDate('31/01/2019'), '2019-01-31');
  assert.strictEqual(imp.parseDate('01-JAN-2019'), '2019-01-01');
  assert.strictEqual(imp.parseDate('5-Mar-19'), '2019-03-05');
  assert.strictEqual(imp.parseDate('31/02/2019'), null);
  assert.strictEqual(imp.parseDate('last week'), null);
  assert.strictEqual(imp.parseDate(''), '');
});

test('CNICs are normalised or refused', () => {
  assert.strictEqual(imp.parseCnic('3410173736000'), '34101-7373600-0');
  assert.strictEqual(imp.parseCnic('34101-7373600-0'), '34101-7373600-0');
  assert.strictEqual(imp.parseCnic('12345'), null);
});

test('a good row is normalised, with flexible headers', () => {
  const { payload, errors } = imp.normaliseRow({
    'Emp Code': 'ab-1001', 'First Name': 'Sara', Surname: 'Khan', 'Work Email': 'Sara@Co.com',
    'Job Title': 'Analyst', Dept: 'Finance', DOJ: '01-JAN-2024', Salary: '85,000', Type: 'Permanent', Gender: 'F', CNIC: '3410173736000',
  });
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(payload.employeeCode, 'AB-1001');
  assert.strictEqual(payload.email, 'sara@co.com');
  assert.strictEqual(payload.dateOfJoining, '2024-01-01');
  assert.strictEqual(payload.employmentType, 'full_time');
  assert.strictEqual(payload.gender, 'female');
  assert.strictEqual(payload.compensation.baseSalary, 85000);
  assert.strictEqual(payload.compensation.currency, 'PKR');
  assert.strictEqual(payload.payGroup, 'monthly_pk');
  assert.strictEqual(payload.nationalIds[0].number, '34101-7373600-0');
});

test('bad rows say exactly what is wrong', () => {
  const { errors } = imp.normaliseRow({ employeeCode: 'x', firstName: 'A', email: 'nope', dateOfJoining: '31/02/2024', baseSalary: 'abc', gender: 'robot' });
  const text = errors.join(' | ');
  assert.match(text, /lastName is required/);
  assert.match(text, /email is not a valid/);
  assert.match(text, /not a date/);
  assert.match(text, /baseSalary must be a number/);
  assert.match(text, /gender "robot"/);
  assert.match(text, /employeeCode may only/);
});

test('managers are created before the people who report to them', () => {
  const row = (code, boss) => ({ payload: { employeeCode: code, reportsToCode: boss }, errors: [] });
  const order = imp.creationOrder([row('C', 'B'), row('B', 'A'), row('A', '')]).map((r) => r.payload.employeeCode);
  assert.deepStrictEqual(order, ['A', 'B', 'C']);
});

test('a reporting loop is refused', () => {
  const a = { payload: { employeeCode: 'A', reportsToCode: 'B' }, errors: [] };
  const b = { payload: { employeeCode: 'B', reportsToCode: 'A' }, errors: [] };
  imp.creationOrder([a, b]);
  assert.ok(a.errors.length + b.errors.length > 0);
});
