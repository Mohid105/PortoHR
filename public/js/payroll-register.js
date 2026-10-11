/* Payroll → Salary register (the monthly salary sheet) and Monthly inputs. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var el = function (id) { return document.getElementById(id); };
  var P = function () { return window.PortoHR.payroll; };
  var register = null;

  var COLUMNS = [
    ['sr', 'Sr.', 'int'], ['employeeCode', 'Emp #', 'text'], ['name', 'Name', 'text'], ['position', 'Position', 'text'],
    ['grade', 'Grade', 'text'], ['department', 'Department', 'text'], ['unadjustedGross', 'Unadjusted gross', 'money'],
    ['workingDays', 'Payment days', 'num'], ['absentDays', 'Absent days', 'num'], ['approvedLeaves', 'Approved leaves', 'num'],
    ['lwpDays', 'LWP', 'num'], ['adjustedGross', 'Adjusted gross', 'money'], ['overtimeHours', 'OT hours', 'num'],
    ['overtimeRate', 'OT rate', 'money'], ['overtimeAmount', 'OT amount', 'money'], ['gazettedHolidayHours', 'Gaz. holiday hrs', 'num'],
    ['gazettedHolidayPay', 'Salary in lieu of gaz. holidays', 'money'], ['totalOvertime', 'Total overtime', 'money'],
    ['medicalAllowance', 'Medical allowance', 'money'], ['incentive', 'Incentive', 'money'], ['otherEarnings', 'Other earnings', 'money'],
    ['totalSalary', 'Total salary', 'money'], ['loanRecovery', 'Loan & advances', 'money'], ['providentFund', 'Provident fund', 'money'],
    ['messCharges', 'Mess charges', 'money'], ['incomeTax', 'Income tax', 'money'], ['eobi', 'EOBI', 'money'],
    ['otherDeductions', 'Other deductions', 'money'], ['totalDeductions', 'Total deductions', 'money'], ['netPayable', 'Net payable', 'money'],
  ];

  function fmt(value, kind) {
    if (value === null || value === undefined || value === '') return '';
    if (kind === 'money') return Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (kind === 'num') return String(Math.round(Number(value) * 100) / 100);
    return String(value);
  }

  function cell(row, col) {
    var right = col[2] === 'money' || col[2] === 'num' || col[2] === 'int';
    return '<td class="whitespace-nowrap px-3 py-2' + (right ? ' text-right tabular-nums' : '') + (col[0] === 'netPayable' ? ' font-semibold' : '') + '">' + P().escapeHtml(fmt(row[col[0]], col[2])) + '</td>';
  }

  async function loadRegister() {
    var month = el('reg-month').value;
    if (!month) return;
    el('reg-board').innerHTML = '<p class="p-8 text-center text-sm text-slate-500">Loading…</p>';
    try {
      register = await api.get('/payroll/register?month=' + encodeURIComponent(month));
    } catch (err) {
      el('reg-board').innerHTML = '<p class="p-8 text-center text-sm text-slate-500">' + P().escapeHtml(err.message) + '</p>';
      return;
    }
    el('reg-caption').textContent = register.rows.length
      ? register.rows.length + ' employees · ' + register.currency + ' · ' + P().monthLabel(month)
      : '';
    if (!register.rows.length) {
      el('reg-board').innerHTML = '<p class="p-10 text-center text-sm text-slate-500">No payslips for this month yet. Generate the payroll batch first.</p>';
      return;
    }
    var head = '<tr>' + COLUMNS.map(function (c) {
      return '<th class="whitespace-nowrap px-3 py-3 ' + (c[2] === 'money' || c[2] === 'num' ? 'text-right' : 'text-left') + '">' + P().escapeHtml(c[1]) + '</th>';
    }).join('') + '</tr>';
    var body = register.rows.map(function (row) {
      return '<tr>' + COLUMNS.map(function (c) { return cell(row, c); }).join('') + '</tr>';
    }).join('');
    var t = register.totals;
    var foot = '<tr class="font-semibold" style="background:var(--surface-alt)">' + COLUMNS.map(function (c, i) {
      if (i === 2) return '<td class="px-3 py-2">Total (' + t.headcount + ')</td>';
      return t[c[0]] !== undefined && c[2] === 'money' ? cell(t, c) : '<td></td>';
    }).join('') + '</tr>';
    el('reg-board').innerHTML = '<table class="min-w-full text-xs"><thead>' + head + '</thead><tbody>' + body + '</tbody><tfoot>' + foot + '</tfoot></table>';
  }

  function csvCell(value) {
    var text = String(value === null || value === undefined ? '' : value);
    if (/^[=+\-@\t\r]/.test(text) && isNaN(Number(text))) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function exportCsv() {
    if (!register || !register.rows.length) return;
    var lines = [COLUMNS.map(function (c) { return csvCell(c[1]); }).join(',')]
      .concat(register.rows.map(function (row) { return COLUMNS.map(function (c) { return csvCell(row[c[0]]); }).join(','); }));
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'salary-register-' + register.month + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /* ---------- monthly inputs ---------- */

  var FIELDS = [['incentive', 'Incentive'], ['medicalAllowance', 'Medical'], ['otherEarnings', 'Other earn.'], ['messCharges', 'Mess'], ['otherDeductions', 'Other ded.'], ['gazettedHolidayHours', 'Holiday hrs']];

  async function loadInputs() {
    var month = el('in-month').value;
    if (!month) return;
    el('in-board').innerHTML = '<p class="p-8 text-center text-sm text-slate-500">Loading…</p>';
    var result;
    try {
      result = await api.get('/payroll/inputs?month=' + encodeURIComponent(month));
    } catch (err) {
      el('in-board').innerHTML = '<p class="p-8 text-center text-sm text-slate-500">' + P().escapeHtml(err.message) + '</p>';
      return;
    }
    var head = '<tr><th class="px-4 py-3 text-left">Employee</th>' + FIELDS.map(function (f) { return '<th class="px-2 py-3 text-right">' + f[1] + '</th>'; }).join('') + '<th class="px-4 py-3 text-right"></th></tr>';
    var body = result.people.map(function (p) {
      var locked = p.payslipStatus && p.payslipStatus !== 'draft';
      return '<tr data-emp="' + P().escapeHtml(p.employee) + '"><td class="px-4 py-2"><span class="block font-medium text-slate-900">' + P().escapeHtml(p.fullName) + '</span><span class="block text-xs text-slate-400">' + P().escapeHtml(p.employeeCode) + (locked ? ' · payslip ' + P().escapeHtml(p.payslipStatus) : '') + '</span></td>' +
        FIELDS.map(function (f) {
          var v = p.input && p.input[f[0]] !== null && p.input[f[0]] !== undefined ? p.input[f[0]] : '';
          return '<td class="px-2 py-2"><input data-f="' + f[0] + '" type="number" min="0" step="0.01" value="' + P().escapeHtml(v === 0 ? '' : v) + '" class="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm"' + (locked ? ' disabled' : '') + ' /></td>';
        }).join('') +
        '<td class="px-4 py-2 text-right"><button type="button" class="btn btn-secondary btn-sm" data-save' + (locked ? ' disabled' : '') + '>Save</button></td></tr>';
    }).join('');
    el('in-board').innerHTML = '<table class="min-w-full text-sm"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
  }

  async function saveRow(tr) {
    var body = { employee: tr.getAttribute('data-emp'), month: el('in-month').value };
    tr.querySelectorAll('input[data-f]').forEach(function (input) { body[input.getAttribute('data-f')] = input.value; });
    try {
      await api.request('/payroll/inputs', { method: 'PUT', body: body });
      P().toast('Saved. Regenerate the month to apply it.');
    } catch (err) {
      P().toast(err.message || 'Could not save', 'error');
    }
  }

  async function importPaste() {
    var rows = el('in-paste').value.split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean).map(function (line) {
      var c = line.split(/[,\t]/).map(function (x) { return x.trim(); });
      return { employeeCode: c[0], incentive: c[1], medicalAllowance: c[2], otherEarnings: c[3], messCharges: c[4], otherDeductions: c[5], gazettedHolidayHours: c[6] };
    });
    if (!rows.length) return;
    try {
      var r = await api.request('/payroll/inputs/import', { method: 'POST', body: { month: el('in-month').value, rows: rows } });
      el('in-import-result').textContent = r.applied + ' applied' + (r.failed.length ? ', ' + r.failed.length + ' failed: ' + r.failed.slice(0, 3).map(function (f) { return f.employeeCode + ' (' + f.reason + ')'; }).join('; ') : '');
      loadInputs();
    } catch (err) {
      el('in-import-result').textContent = err.message;
    }
  }

  function onTab(event) {
    var tab = event.detail.tab;
    el('view-register').classList.toggle('hidden', tab !== 'register');
    el('view-inputs').classList.toggle('hidden', tab !== 'inputs');
    if (tab === 'register') { if (!el('reg-month').value) el('reg-month').value = P().previousMonth(); loadRegister(); }
    if (tab === 'inputs') { if (!el('in-month').value) el('in-month').value = new Date().toISOString().slice(0, 7); loadInputs(); }
  }

  document.addEventListener('payroll:tab', onTab);
  el('reg-month').addEventListener('change', loadRegister);
  el('reg-csv').addEventListener('click', exportCsv);
  el('reg-print').addEventListener('click', function () { window.print(); });
  el('in-month').addEventListener('change', loadInputs);
  el('in-import-toggle').addEventListener('click', function () { el('in-import').classList.toggle('hidden'); });
  el('in-import-go').addEventListener('click', importPaste);
  el('in-board').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-save]');
    if (btn) saveRow(btn.closest('tr'));
  });
})(window, document);
