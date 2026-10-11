'use strict';

const test = require('node:test');
const assert = require('node:assert');
const onboarding = require('../src/services/onboarding.service');

const lookups = { departments: ['Engineering', 'Finance'], grades: ['N2', 'M3'] };

const valid = () => ({
  personal: { firstName: 'Zainab', lastName: 'Qureshi', dateOfBirth: '1994-03-12', gender: 'female', nationality: 'PK', cnic: '4210112345678' },
  contact: { email: 'Zainab@Example.com', addresses: [{ type: 'current', line1: '12 Gulshan', city: 'Karachi' }] },
  employment: { employeeCode: 'ph-1100', dateOfJoining: '2026-11-02' },
  organization: { department: 'Engineering', designation: 'QA Engineer', shiftType: 'general', restDays: ['saturday', 'sunday'] },
  pay: { baseSalary: '120,000', allowances: [{ label: 'Transport', amount: '10000' }], payment: { method: 'bank_transfer', bankName: 'Meezan', accountNumber: '0123' } },
  family: [{ name: 'Ali', relationship: 'spouse', isEmergency: true }],
});

const fields = (result) => result.errors.map((e) => e.field);

test('the next employee code follows the pattern already in use', () => {
  assert.strictEqual(onboarding.nextCode(['PH-1008', 'PH-1002']), 'PH-1009');
  assert.strictEqual(onboarding.nextCode(['EMP-0099']), 'EMP-0100');
  assert.strictEqual(onboarding.nextCode([]), 'EMP-0001');
  assert.strictEqual(onboarding.nextCode(['legacy', '']), 'EMP-0001');
});

test('an empty form names every required field', () => {
  const result = onboarding.build({}, lookups);
  assert.deepStrictEqual(fields(result).sort(), [
    'contact.email', 'employment.dateOfJoining', 'employment.employeeCode', 'organization.department',
    'organization.designation', 'pay.baseSalary', 'personal.firstName', 'personal.lastName',
  ]);
});

test('a complete form builds a clean hire payload and the child records', () => {
  const { payload, extras, errors, warnings } = onboarding.build(valid(), lookups);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(payload.employeeCode, 'PH-1100');
  assert.strictEqual(payload.email, 'zainab@example.com');
  assert.deepStrictEqual(payload.nationalIds, [{ type: 'cnic', number: '42101-1234567-8' }]);
  assert.strictEqual(payload.compensation.baseSalary, 120000);
  assert.deepStrictEqual(payload.compensation.fixedAllowances, [{ label: 'Transport', amount: 10000 }]);
  assert.strictEqual(payload.address, '12 Gulshan, Karachi');
  assert.strictEqual(extras.family.length, 1);
  assert.strictEqual(extras.bank.accountTitle, 'Zainab Qureshi');
  assert.strictEqual(extras.checklist, true);
  assert.deepStrictEqual(warnings, []);
});

test('problems are reported against the exact field, including inside repeating rows', () => {
  const body = valid();
  body.personal.dateOfBirth = '2030-01-01';
  body.personal.cnic = '123';
  body.organization.department = 'Basket Weaving';
  body.organization.restDays = ['saturday', 'saturday'];
  body.pay.payment.iban = 'PK12';
  body.pay.allowances = [{ label: '', amount: '5' }];
  body.family = [{ name: 'Ali' }, { phone: '1' }];
  body.experience = [{ organization: 'A', fromYear: 2020, toYear: 2010 }];
  body.documents = [{ type: 'bogus' }];
  const result = onboarding.build(body, lookups);
  const bad = fields(result);
  ['personal.dateOfBirth', 'personal.cnic', 'organization.department', 'organization.restDays', 'pay.payment.iban',
    'pay.allowances.0.label', 'family.1.name', 'family.1.phone', 'experience.0.toYear', 'documents.0.type'].forEach((field) => {
    assert.ok(bad.includes(field), `expected an error on ${field}, got ${bad.join(', ')}`);
  });
  assert.ok(!bad.includes('family.0.name'), 'the valid row must not be flagged');
});

test('a future birth date is one error, not two', () => {
  const body = valid();
  body.personal.dateOfBirth = '2031-05-05';
  const result = onboarding.build(body, lookups);
  assert.strictEqual(result.errors.filter((e) => e.field === 'personal.dateOfBirth').length, 1);
});

test('missing CNIC, bank and emergency contact are warnings, not blockers', () => {
  const body = valid();
  delete body.personal.cnic;
  body.pay.payment = { method: 'bank_transfer' };
  body.family = [];
  const result = onboarding.build(body, lookups);
  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.warnings.length, 3);
  assert.strictEqual(result.extras.bank, null);
});

test('a login needs a real role', () => {
  const body = valid();
  body.access = { createLogin: true, role: 'superuser' };
  assert.ok(fields(onboarding.build(body, lookups)).includes('access.role'));
  body.access.role = 'manager';
  assert.deepStrictEqual(onboarding.build(body, lookups).errors, []);
});
