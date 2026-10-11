/* Leave → the yearly leave record (printable) and HR balance adjustments. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var session = window.PortoHR.session;
  var el = function (id) { return document.getElementById(id); };
  var current = null;
  var loadedPeople = false;

  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function isHr() { var u = session.getUser(); return u && u.role === 'hr_admin'; }
  function canPickPeople() { var u = session.getUser(); return u && (u.role === 'hr_admin'); }

  function num(value) { return String(Math.round(Number(value) * 100) / 100); }

  function monthName(ym) {
    var m = /^(\d{4})-(\d{2})/.exec(String(ym));
    return m ? ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][Number(m[2]) - 1] + '-' + m[1] : String(ym || '');
  }

  var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    return m ? m[3] + '-' + MONTHS[Number(m[2]) - 1] + '-' + m[1].slice(2) : String(iso || '');
  }

  function render(data) {
    current = data;
    var e = data.employee;
    var entries = data.entries.length
      ? data.entries.map(function (row, i) {
          return '<tr><td class="px-2 py-1.5">' + (i + 1) + '</td><td class="px-2 py-1.5">' + esc(row.leaveTypeLabel) + '</td>' +
            '<td class="px-2 py-1.5 text-right tabular-nums">' + num(row.days) + (row.hours ? ' <span class="text-xs text-slate-400">(' + num(row.hours) + 'h)</span>' : '') + '</td>' +
            '<td class="px-2 py-1.5">' + esc(monthName(row.month)) + '</td><td class="px-2 py-1.5">' + esc(fmtDate(row.fromDate)) + '</td><td class="px-2 py-1.5">' + esc(fmtDate(row.toDate)) + '</td></tr>';
        }).join('')
      : '<tr><td colspan="6" class="px-2 py-6 text-center text-slate-500">No approved leave in ' + data.year + '.</td></tr>';

    el('rec-body').innerHTML =
      '<p class="text-xs text-slate-500">Year ' + data.year + ' · ' + (data.group === 'worker' ? 'Worker' : 'Staff') + ' leave policy</p>' +
      '<dl class="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">' +
      '<div><dt class="text-xs text-slate-400">Employee</dt><dd class="font-medium">' + esc(e.fullName) + ' (' + esc(e.employeeCode) + ')</dd></div>' +
      '<div><dt class="text-xs text-slate-400">Position</dt><dd>' + esc(e.designation) + '</dd></div>' +
      '<div><dt class="text-xs text-slate-400">Department</dt><dd>' + esc(e.department) + '</dd></div>' +
      '<div><dt class="text-xs text-slate-400">Date of joining</dt><dd>' + esc(e.dateOfJoining ? fmtDate(String(e.dateOfJoining).slice(0, 10)) : '') + '</dd></div></dl>' +
      '<table class="mt-4 w-full text-xs"><thead><tr class="text-left"><th class="px-2 py-2">Sr.</th><th class="px-2 py-2">Leave type</th><th class="px-2 py-2 text-right">Days</th><th class="px-2 py-2">Month</th><th class="px-2 py-2">From</th><th class="px-2 py-2">To</th></tr></thead><tbody>' + entries + '</tbody></table>' +
      '<h3 class="mt-5 text-xs font-semibold uppercase tracking-wider text-slate-400">Balances</h3>' +
      '<table class="mt-1 w-full text-xs"><thead><tr class="text-left"><th class="px-2 py-2">Leave type</th><th class="px-2 py-2 text-right">Entitled</th><th class="px-2 py-2 text-right">Taken</th><th class="px-2 py-2 text-right">Pending</th><th class="px-2 py-2 text-right">Balance</th></tr></thead><tbody>' +
      data.balances.map(function (b) {
        return '<tr><td class="px-2 py-1.5">' + esc(b.label) + '</td><td class="px-2 py-1.5 text-right tabular-nums">' + num(b.entitlementDays) + '</td><td class="px-2 py-1.5 text-right tabular-nums">' + num(b.takenDays) + '</td><td class="px-2 py-1.5 text-right tabular-nums">' + num(b.pendingDays) + '</td><td class="px-2 py-1.5 text-right font-semibold tabular-nums">' + num(b.availableDays) + '</td></tr>';
      }).join('') + '</tbody></table>';

    el('adj-type').innerHTML = data.balances.map(function (b) { return '<option value="' + esc(b.code) + '">' + esc(b.label) + '</option>'; }).join('');
  }

  async function load() {
    var year = el('rec-year').value;
    var emp = el('rec-employee').value;
    el('rec-body').innerHTML = '<p class="py-8 text-center text-slate-500">Loading…</p>';
    try {
      render(await api.get('/leave/statement?year=' + year + (emp ? '&employee=' + encodeURIComponent(emp) : '')));
    } catch (err) {
      el('rec-body').innerHTML = '<p class="py-8 text-center text-slate-500">' + esc(err.message) + '</p>';
    }
  }

  async function open() {
    var thisYear = new Date().getFullYear();
    if (!el('rec-year').options.length) {
      el('rec-year').innerHTML = [thisYear, thisYear - 1, thisYear - 2].map(function (y) { return '<option>' + y + '</option>'; }).join('');
    }
    if (canPickPeople() && !loadedPeople) {
      loadedPeople = true;
      try {
        var people = await api.get('/employees?limit=100');
        el('rec-employee').innerHTML = '<option value="">Myself</option>' + (people.employees || []).map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.fullName) + ' (' + esc(p.employeeCode) + ')</option>'; }).join('');
        el('rec-employee').classList.remove('hidden');
      } catch (err) { /* picker is optional */ }
    }
    el('rec-adjust').classList.toggle('hidden', !isHr());
    el('record-modal').classList.remove('hidden');
    load();
  }

  el('record-open').addEventListener('click', open);
  el('rec-close').addEventListener('click', function () { el('record-modal').classList.add('hidden'); });
  el('record-modal').addEventListener('mousedown', function (e) { if (e.target === el('record-modal')) el('record-modal').classList.add('hidden'); });
  el('rec-year').addEventListener('change', load);
  el('rec-employee').addEventListener('change', load);
  el('rec-print').addEventListener('click', function () { document.body.classList.add('printing-record'); window.print(); document.body.classList.remove('printing-record'); });
  el('rec-adjust').addEventListener('click', function () { el('adj-form').classList.toggle('hidden'); });

  el('adj-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var err = el('adj-error');
    err.classList.add('hidden');
    var emp = el('rec-employee').value || (current && current.employee.id);
    try {
      await api.request('/leave/adjustments', { method: 'POST', body: { employee: emp, leaveType: el('adj-type').value, days: el('adj-days').value, reason: el('adj-reason').value, year: el('rec-year').value } });
      el('adj-days').value = '';
      el('adj-reason').value = '';
      el('adj-form').classList.add('hidden');
      load();
    } catch (e) {
      err.textContent = e.message || 'Could not save';
      err.classList.remove('hidden');
    }
  });
})(window, document);
