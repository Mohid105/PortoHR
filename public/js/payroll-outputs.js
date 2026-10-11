/* Payroll → Bank & statutory: the payment file for the bank and the deduction summary for the authorities. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var el = function (id) { return document.getElementById(id); };
  var P = function () { return window.PortoHR.payroll; };
  var data = { bank: null, stat: null };

  function esc(v) { return P().escapeHtml(v); }
  function num(v) { return Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  function csvCell(value) {
    var text = String(value === null || value === undefined ? '' : value);
    if (/^[=+\-@\t\r]/.test(text) && isNaN(Number(text))) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function download(name, header, rows) {
    var lines = [header.map(csvCell).join(',')].concat(rows.map(function (r) { return r.map(csvCell).join(','); }));
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function table(head, rows, foot) {
    return '<table class="min-w-full text-sm"><thead><tr>' + head.map(function (h) {
      return '<th class="whitespace-nowrap px-4 py-3 ' + (h[1] ? 'text-right' : 'text-left') + '">' + esc(h[0]) + '</th>';
    }).join('') + '</tr></thead><tbody>' + rows + '</tbody>' + (foot ? '<tfoot>' + foot + '</tfoot>' : '') + '</table>';
  }

  function renderBank(b) {
    var t = b.totals;
    var rows = b.transfers.map(function (r) {
      return '<tr><td class="px-4 py-2.5">' + esc(r.employeeCode) + '</td><td class="px-4 py-2.5">' + esc(r.name) + '</td><td class="px-4 py-2.5">' + esc(r.bankName) + '</td>' +
        '<td class="px-4 py-2.5">' + esc(r.accountNumber || r.iban) + '</td><td class="px-4 py-2.5 text-right tabular-nums">' + esc(num(r.amount)) + '</td></tr>';
    }).join('');
    var summary = '<div class="flex flex-wrap gap-6 px-6 py-4 text-sm">' +
      '<div><span class="kpi-label">By bank transfer</span><p class="mt-1 text-lg font-semibold tabular-nums">' + esc(b.currency) + ' ' + esc(num(t.transfer)) + '</p><p class="text-xs text-slate-500">' + b.transfers.length + ' payments</p></div>' +
      (t.cash ? '<div><span class="kpi-label">Cash</span><p class="mt-1 text-lg font-semibold tabular-nums">' + esc(num(t.cash)) + '</p></div>' : '') +
      (t.cheque ? '<div><span class="kpi-label">Cheque</span><p class="mt-1 text-lg font-semibold tabular-nums">' + esc(num(t.cheque)) + '</p></div>' : '') +
      '<div><span class="kpi-label">Payslips included</span><p class="mt-1 text-lg font-semibold tabular-nums">' + t.payslips + '</p></div></div>';
    var exceptions = b.exceptions.length
      ? '<div class="border-t px-6 py-4" style="border-color:var(--border)"><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Not in the bank file (' + b.exceptions.length + ')</p>' +
        '<ul class="mt-2 space-y-1 text-sm">' + b.exceptions.map(function (x) {
          return '<li class="flex flex-wrap gap-2"><span class="font-medium">' + esc(x.name) + '</span><span class="text-slate-400">' + esc(x.employeeCode) + '</span><span class="pill warn">' + esc(x.reason) + '</span><span class="ml-auto tabular-nums text-slate-500">' + esc(num(x.amount)) + '</span></li>';
        }).join('') + '</ul></div>'
      : '';
    el('bank-board').innerHTML = summary + (b.transfers.length
      ? '<div class="overflow-x-auto border-t" style="border-color:var(--border)">' + table([['Code'], ['Name'], ['Bank'], ['Account / IBAN'], ['Amount', true]], rows) + '</div>'
      : '<p class="px-6 pb-8 text-center text-sm text-slate-500">No finalised payslips with a bank account for this month yet.</p>') + exceptions;
    el('bank-csv').disabled = !b.transfers.length;
  }

  function renderStat(s) {
    if (!s.rows.length) { el('stat-board').innerHTML = '<p class="px-6 py-10 text-center text-sm text-slate-500">No finalised payslips for this month yet.</p>'; el('stat-csv').disabled = true; return; }
    el('stat-csv').disabled = false;
    var rows = s.rows.map(function (r) {
      return '<tr><td class="px-4 py-2.5">' + esc(r.employeeCode) + '</td><td class="px-4 py-2.5">' + esc(r.name) + '</td><td class="px-4 py-2.5 text-slate-500">' + esc(r.cnic || '—') + '</td><td class="px-4 py-2.5 text-slate-500">' + esc(r.ntn || '—') + '</td>' +
        ['grossEarnings', 'eobi', 'providentFund', 'incomeTax'].map(function (k) { return '<td class="px-4 py-2.5 text-right tabular-nums">' + esc(num(r[k])) + '</td>'; }).join('') + '</tr>';
    }).join('');
    var t = s.totals;
    var foot = '<tr class="font-semibold" style="background:var(--surface-alt)"><td class="px-4 py-2.5" colspan="4">Total (' + t.headcount + ')</td>' +
      ['grossEarnings', 'eobi', 'providentFund', 'incomeTax'].map(function (k) { return '<td class="px-4 py-2.5 text-right tabular-nums">' + esc(num(t[k])) + '</td>'; }).join('') + '</tr>';
    el('stat-board').innerHTML = table([['Code'], ['Name'], ['CNIC'], ['NTN'], ['Gross earnings', true], ['EOBI', true], ['Provident fund', true], ['Income tax', true]], rows, foot);
  }

  async function load() {
    var month = el('out-month').value;
    if (!month) return;
    el('bank-board').innerHTML = '<p class="p-8 text-center text-sm text-slate-500">Loading…</p>';
    try {
      var results = await Promise.all([api.get('/payroll/bank-advice?month=' + month), api.get('/payroll/statutory?month=' + month)]);
      data.bank = results[0];
      data.stat = results[1];
      renderBank(data.bank);
      renderStat(data.stat);
      el('out-note').textContent = data.bank.draftsExcluded ? data.bank.draftsExcluded + ' draft payslip(s) are left out until they are finalised.' : '';
    } catch (err) {
      el('bank-board').innerHTML = '<p class="p-8 text-center text-sm text-slate-500">' + esc(err.message) + '</p>';
    }
  }

  el('out-month').addEventListener('change', load);
  document.addEventListener('payroll:tab', function (event) {
    var on = event.detail.tab === 'outputs';
    el('view-outputs').classList.toggle('hidden', !on);
    if (on) { if (!el('out-month').value) el('out-month').value = P().previousMonth(); load(); }
  });

  el('bank-csv').addEventListener('click', function () {
    var b = data.bank;
    if (!b || !b.transfers.length) return;
    download('bank-advice-' + b.month + '.csv',
      ['Sr', 'Employee code', 'Beneficiary name', 'Bank', 'Branch', 'Account title', 'Account number', 'IBAN', 'Amount', 'Currency', 'Narration'],
      b.transfers.map(function (r, i) { return [i + 1, r.employeeCode, r.name, r.bankName, r.branch, r.accountTitle, r.accountNumber, r.iban, r.amount.toFixed(2), r.currency, r.narration]; }));
  });

  el('stat-csv').addEventListener('click', function () {
    var s = data.stat;
    if (!s || !s.rows.length) return;
    download('statutory-' + s.month + '.csv',
      ['Employee code', 'Name', 'CNIC', 'NTN', 'EOBI no.', 'PF no.', 'Gross earnings', 'Taxable (monthly)', 'EOBI', 'Provident fund', 'Income tax'],
      s.rows.map(function (r) { return [r.employeeCode, r.name, r.cnic, r.ntn, r.eobiNumber, r.pfNumber, r.grossEarnings.toFixed(2), r.taxableMonthly.toFixed(2), r.eobi.toFixed(2), r.providentFund.toFixed(2), r.incomeTax.toFixed(2)]; }));
  });
})(window, document);
