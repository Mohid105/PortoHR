'use strict';

/**
 * Payment and compliance outputs built from approved payslips: the bank
 * payment advice that goes to the bank, and the statutory deduction summary
 * that goes to the tax and pension authorities. Only finalised or paid
 * payslips are included — a draft is a working figure, not money owed.
 */

const Payslip = require('../models/Payslip');
const Employee = require('../models/Employee');
const Person = require('../models/Person');
const BankAccount = require('../models/BankAccount');
const StatutoryEnrollment = require('../models/StatutoryEnrollment');
const ApiError = require('../utils/ApiError');
const { toMajor } = require('../utils/money');
const { monthRange } = require('./attendance.service');

const APPROVED = ['finalised', 'paid'];
const round2 = (value) => Math.round(value * 100) / 100;

async function approvedSlips(month) {
  const range = monthRange(month);
  if (!range) throw ApiError.badRequest('Pay period must be in YYYY-MM format');
  const slips = await Payslip.find({ month: range.month, status: { $in: APPROVED } }).sort({ 'snapshot.employeeCode': 1 });
  const drafts = await Payslip.countDocuments({ month: range.month, status: 'draft' });
  return { month: range.month, slips, drafts };
}

/** Net pay per employee with the account it should go to, plus everyone who cannot be paid by transfer. */
async function bankAdvice(month) {
  const { month: period, slips, drafts } = await approvedSlips(month);
  const ids = slips.map((slip) => slip.employee);
  const accounts = await BankAccount.find({ employee: { $in: ids }, status: 'active' }).sort({ effectiveFrom: -1 });
  const accountByEmployee = new Map();
  accounts.forEach((account) => {
    if (!accountByEmployee.has(String(account.employee))) accountByEmployee.set(String(account.employee), account);
  });

  const transfers = [];
  const exceptions = [];
  let cash = 0;
  let cheque = 0;

  slips.forEach((slip) => {
    const net = toMajor(slip.netPay);
    const base = { employeeCode: slip.snapshot.employeeCode, name: slip.snapshot.fullName, amount: net, currency: slip.currency, status: slip.status };
    const account = accountByEmployee.get(String(slip.employee));

    if (net <= 0) {
      exceptions.push({ ...base, reason: 'Nothing payable this month' });
    } else if (!account) {
      exceptions.push({ ...base, reason: 'No active bank account on file' });
    } else if (account.method === 'cash') {
      cash += net;
      exceptions.push({ ...base, reason: 'Paid in cash' });
    } else if (account.method === 'cheque') {
      cheque += net;
      exceptions.push({ ...base, reason: 'Paid by cheque' });
    } else if (!account.accountNumber && !account.iban) {
      exceptions.push({ ...base, reason: 'Bank account has no account number or IBAN' });
    } else {
      transfers.push({
        employeeCode: base.employeeCode,
        name: base.name,
        bankName: account.bankName,
        branch: account.branch,
        accountTitle: account.accountTitle || base.name,
        accountNumber: account.accountNumber,
        iban: account.iban,
        amount: net,
        currency: slip.currency,
        narration: `Salary ${period}`,
        status: slip.status,
      });
    }
  });

  return {
    month: period,
    currency: slips[0] ? slips[0].currency : '',
    transfers,
    exceptions,
    totals: {
      transfer: round2(transfers.reduce((total, row) => total + row.amount, 0)),
      cash: round2(cash),
      cheque: round2(cheque),
      payslips: slips.length,
    },
    draftsExcluded: drafts,
  };
}

/** EOBI, provident fund and income tax withheld, one row per employee. */
async function statutory(month) {
  const { month: period, slips, drafts } = await approvedSlips(month);
  const ids = slips.map((slip) => slip.employee);
  const [employees, enrolments] = await Promise.all([
    Employee.find({ _id: { $in: ids } }).select('person'),
    StatutoryEnrollment.find({ employee: { $in: ids }, status: 'active' }),
  ]);
  const people = await Person.find({ _id: { $in: employees.map((e) => e.person).filter(Boolean) } }).select('nationalIds');
  const personById = new Map(people.map((p) => [String(p._id), p]));
  const personOf = new Map(employees.map((e) => [String(e._id), personById.get(String(e.person))]));
  const numberFor = (employeeId, scheme) => {
    const row = enrolments.find((e) => String(e.employee) === String(employeeId) && e.scheme === scheme);
    return row ? row.membershipNumber : '';
  };

  const rows = slips.map((slip) => {
    const ded = slip.deductions || {};
    const person = personOf.get(String(slip.employee));
    const cnic = person && (person.nationalIds || []).find((id) => id.type === 'cnic');
    return {
      employeeCode: slip.snapshot.employeeCode,
      name: slip.snapshot.fullName,
      cnic: (cnic && cnic.number) || '',
      ntn: numberFor(slip.employee, 'tax'),
      eobiNumber: numberFor(slip.employee, 'eobi'),
      pfNumber: numberFor(slip.employee, 'provident_fund'),
      grossEarnings: toMajor(slip.earnings.gross),
      taxableMonthly: toMajor(slip.taxableGross),
      eobi: toMajor(ded.socialSecurity),
      providentFund: toMajor(ded.providentFund),
      incomeTax: toMajor(ded.incomeTax),
      status: slip.status,
    };
  });

  const totals = { headcount: rows.length };
  ['grossEarnings', 'taxableMonthly', 'eobi', 'providentFund', 'incomeTax'].forEach((key) => {
    totals[key] = round2(rows.reduce((total, row) => total + (row[key] || 0), 0));
  });
  return { month: period, currency: slips[0] ? slips[0].currency : '', rows, totals, draftsExcluded: drafts };
}

module.exports = { bankAdvice, statutory };
