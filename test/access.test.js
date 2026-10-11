'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { passwordProblem } = require('../src/services/access.service');
const { daysUntilAnniversary } = require('../src/services/company.service');

test('password policy', () => {
  assert.ok(passwordProblem('short1'));
  assert.ok(passwordProblem('onlyletters'));
  assert.ok(passwordProblem('12345678'));
  assert.ok(passwordProblem('a1'.repeat(40)));
  assert.strictEqual(passwordProblem('Portohr@123'), '');
});

test('anniversaries count forward, wrap the year and ignore the birth year', () => {
  const from = new Date(2026, 9, 2); // 2 Oct 2026
  assert.strictEqual(daysUntilAnniversary(new Date(1990, 9, 2), from), 0);
  assert.strictEqual(daysUntilAnniversary(new Date(1990, 9, 5), from), 3);
  assert.strictEqual(daysUntilAnniversary(new Date(1985, 0, 1), from), 91);
  assert.strictEqual(daysUntilAnniversary(new Date(2000, 9, 1), from), 364);
});
