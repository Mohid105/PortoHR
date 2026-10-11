/* Attendance → Team today (live board) and the Monthly register. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var A = window.PortoHR.att;
  var S = A.state;
  var el = A.el;
  var esc = A.esc;
  var board = { data: null, filter: '', timer: null };
  var reg = { data: null, page: 1 };

  var TONE = { in: 'info', present: 'ok', short: 'warn', not_in: 'bad', absent: 'bad', not_yet: '', leave: 'info', off: '', missed: 'bad' };
  var DOT = { in: 'var(--primary)', present: 'var(--success)', short: 'var(--warning)', not_in: 'var(--coral)', absent: 'var(--coral)', not_yet: 'var(--muted)', leave: 'var(--sky)', off: 'var(--border-strong)', missed: 'var(--coral)' };

  function fillDepartments(select) {
    var chosen = select.value;
    select.innerHTML = '<option value="">All departments</option>' + (A.departments || []).map(function (d) { return '<option>' + esc(d) + '</option>'; }).join('');
    select.value = chosen;
  }

  /* ------------------------------------------------------------- board */

  var CHIPS = [
    ['', 'Everyone', 'total'],
    ['in', 'Clocked in', 'in'],
    ['present', 'Present', 'present'],
    ['late', 'Late', 'late'],
    ['not_in', 'Not in', 'notIn'],
    ['leave', 'On leave', 'leave'],
    ['off', 'Day off', 'off'],
    ['missed', 'Missed punch', 'missed'],
  ];

  function matches(row) {
    var f = board.filter;
    if (!f) return true;
    if (f === 'late') return row.lateMinutes > 0;
    if (f === 'not_in') return row.status === 'not_in' || row.status === 'absent' || row.status === 'not_yet';
    if (f === 'present') return row.status === 'present' || row.status === 'short';
    return row.status === f;
  }

  function renderBoard() {
    var d = board.data;
    if (!d) return;
    el('board-chips').innerHTML = CHIPS.map(function (c) {
      return '<button type="button" class="chipk' + (board.filter === c[0] ? ' is-on' : '') + '" data-chip="' + c[0] + '"><b>' + (d.counts[c[2]] || 0) + '</b><span>' + c[1] + '</span></button>';
    }).join('');
    var rows = d.rows.filter(matches);
    el('board-table').innerHTML = rows.length
      ? '<table class="min-w-full text-sm"><thead><tr><th class="px-4 py-3 text-left">Employee</th><th class="px-4 py-3 text-left">Department</th><th class="px-4 py-3 text-left">Shift</th><th class="px-4 py-3 text-left">Status</th><th class="px-4 py-3 text-left">In</th><th class="px-4 py-3 text-left">Out</th><th class="px-4 py-3 text-right">Late</th><th class="px-4 py-3 text-right">Hours</th></tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr><td class="px-4 py-2.5"><button type="button" class="text-left" data-open="' + esc(r.id) + '"><span class="block font-medium hover:underline">' + esc(r.name) + '</span><span class="amini">' + esc(r.code) + ' · ' + esc(r.designation) + '</span></button></td>' +
            '<td class="px-4 py-2.5 text-slate-600">' + esc(r.department) + '</td><td class="px-4 py-2.5 text-slate-600">' + esc(r.shiftLabel) + '</td>' +
            '<td class="px-4 py-2.5"><span class="pill ' + (TONE[r.status] || '') + '"><span class="sdot" style="background:' + (DOT[r.status] || 'var(--muted)') + ';margin:0"></span>' + esc(r.label) + '</span>' + (r.dayOff ? '<span class="amini ml-1">' + esc(r.dayOff) + '</span>' : '') + '</td>' +
            '<td class="px-4 py-2.5 tabular-nums">' + esc(A.clock(r.timeIn)) + '</td><td class="px-4 py-2.5 tabular-nums">' + esc(A.clock(r.timeOut)) + '</td>' +
            '<td class="px-4 py-2.5 text-right tabular-nums">' + (r.lateMinutes ? '<span class="text-amber-600">' + esc(A.mins(r.lateMinutes)) + '</span>' : '—') + '</td>' +
            '<td class="px-4 py-2.5 text-right tabular-nums">' + (r.hoursWorked ? esc(A.hours(r.hoursWorked)) : '—') + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<p class="py-10 text-center text-sm text-slate-500">No one matches this view.</p>';
  }

  async function loadBoard() {
    var qs = ['date=' + encodeURIComponent(el('board-date').value || '')];
    if (el('board-dept').value) qs.push('department=' + encodeURIComponent(el('board-dept').value));
    if (el('board-q').value.trim()) qs.push('q=' + encodeURIComponent(el('board-q').value.trim()));
    try {
      board.data = await api.get('/attendance/board?' + qs.join('&'));
      if (!el('board-date').value) el('board-date').value = board.data.date;
      renderBoard();
    } catch (err) {
      el('board-table').innerHTML = '<p class="py-10 text-center text-sm text-slate-500">' + esc(err.message) + '</p>';
    }
  }

  function startBoardTimer() {
    window.clearInterval(board.timer);
    board.timer = window.setInterval(function () {
      if (!el('tab-board').classList.contains('hidden') && board.data && board.data.isToday) loadBoard();
    }, 60000);
  }

  /* ---------------------------------------------------------- register */

  function renderRegister() {
    var d = reg.data;
    var head1 = '<tr><th class="who" rowspan="2">Employee</th>' + Array.from({ length: d.days }, function (_, i) { return '<th>' + (i + 1) + '</th>'; }).join('') +
      ['P', 'A', 'L', 'Off', 'Late', 'OT', 'Hrs', 'MP'].map(function (t) { return '<th rowspan="2" class="tot">' + t + '</th>'; }).join('') + '</tr>';
    var head2 = '<tr>' + d.weekdays.map(function (w) { return '<th style="font-weight:500;color:var(--muted)">' + w + '</th>'; }).join('') + '</tr>';
    var body = d.rows.map(function (r) {
      var t = r.totals;
      return '<tr><td class="who"><button type="button" class="text-left" data-open="' + esc(r.id) + '"><b class="hover:underline">' + esc(r.name) + '</b><span class="amini block">' + esc(r.code) + '</span></button></td>' +
        r.cells.map(function (c) { return '<td class="c ' + (c.code || '') + (c.late ? ' late' : '') + (c.ot ? ' ot' : '') + '" title="' + esc(c.status.replace('_', ' ')) + '">' + (c.code || '·') + '</td>'; }).join('') +
        '<td class="tot">' + t.present + '</td><td class="tot">' + t.absent + '</td><td class="tot">' + t.leave + '</td><td class="tot">' + (t.rest + t.holiday) + '</td><td class="tot">' + t.late + '</td><td class="tot">' + t.overtime + '</td><td class="tot">' + Math.round(t.hours) + '</td><td class="tot">' + t.missed + '</td></tr>';
    }).join('');
    el('reg-board').innerHTML = d.rows.length ? '<table class="reg"><thead>' + head1 + head2 + '</thead><tbody>' + body + '</tbody></table>' : '<p class="py-10 text-center text-sm text-slate-500">No employees match.</p>';
    el('reg-lock').classList.toggle('hidden', !d.locked);
    el('reg-lock').textContent = d.locked ? 'Locked' + (d.lockedBy ? ' by ' + d.lockedBy : '') : '';
    el('reg-pager').innerHTML = d.pages > 1
      ? '<button type="button" class="btn btn-secondary btn-sm" data-page="-1"' + (d.page <= 1 ? ' disabled' : '') + '>‹ Previous</button><span>Page ' + d.page + ' of ' + d.pages + ' · ' + d.total + ' employees</span><button type="button" class="btn btn-secondary btn-sm" data-page="1"' + (d.page >= d.pages ? ' disabled' : '') + '>Next ›</button>'
      : '<span>' + d.total + ' employee' + (d.total === 1 ? '' : 's') + '</span>';
  }

  function regQuery(page) {
    var qs = ['month=' + (el('reg-month').value || ''), 'page=' + page];
    if (el('reg-dept').value) qs.push('department=' + encodeURIComponent(el('reg-dept').value));
    if (el('reg-q').value.trim()) qs.push('q=' + encodeURIComponent(el('reg-q').value.trim()));
    return qs.join('&');
  }

  async function loadRegister() {
    try {
      reg.data = await api.get('/attendance/register?' + regQuery(reg.page));
      renderRegister();
    } catch (err) {
      el('reg-board').innerHTML = '<p class="py-10 text-center text-sm text-slate-500">' + esc(err.message) + '</p>';
    }
  }

  function csvCell(v) {
    var t = String(v === null || v === undefined ? '' : v);
    if (/^[=+\-@]/.test(t) && isNaN(Number(t))) t = "'" + t;
    return '"' + t.replace(/"/g, '""') + '"';
  }

  async function exportRegister() {
    var all = [];
    var first = null;
    for (var page = 1; page <= 50; page += 1) {
      var d = await api.get('/attendance/register?' + regQuery(page).replace(/page=\d+/, 'page=' + page) + '&limit=200');
      if (!first) first = d;
      all = all.concat(d.rows);
      if (page >= d.pages) break;
    }
    var header = ['Code', 'Name', 'Department'].concat(Array.from({ length: first.days }, function (_, i) { return String(i + 1); })).concat(['Present', 'Absent', 'Leave', 'Rest', 'Holiday', 'Late', 'Overtime hrs', 'Hours', 'Missed punches']);
    var lines = [header.map(csvCell).join(',')].concat(all.map(function (r) {
      return [r.code, r.name, r.department].concat(r.cells.map(function (c) { return c.code; })).concat([r.totals.present, r.totals.absent, r.totals.leave, r.totals.rest, r.totals.holiday, r.totals.late, r.totals.overtime, r.totals.hours, r.totals.missed]).map(csvCell).join(',');
    }));
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'attendance-register-' + first.month + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /* -------------------------------------------------------------- wiring */

  function debounce(fn, ms) { var t; return function () { window.clearTimeout(t); t = window.setTimeout(fn, ms); }; }

  document.addEventListener('att:ready', function () {
    if (!S.isTeam) return;
    fillDepartments(el('board-dept'));
    fillDepartments(el('reg-dept'));
    el('reg-month').value = S.monthKey;
    el('board-date').max = S.today ? S.today.date : '';

    el('board-date').addEventListener('change', loadBoard);
    el('board-dept').addEventListener('change', loadBoard);
    el('board-q').addEventListener('input', debounce(loadBoard, 300));
    el('board-refresh').addEventListener('click', loadBoard);
    el('board-chips').addEventListener('click', function (e) { var c = e.target.closest('[data-chip]'); if (c) { board.filter = c.getAttribute('data-chip'); renderBoard(); } });
    ['board-table', 'reg-board'].forEach(function (id) {
      el(id).addEventListener('click', function (e) { var o = e.target.closest('[data-open]'); if (o) A.openCalendarFor(o.getAttribute('data-open'), id === 'reg-board' ? el('reg-month').value : undefined); });
    });

    el('reg-month').addEventListener('change', function () { reg.page = 1; loadRegister(); });
    el('reg-dept').addEventListener('change', function () { reg.page = 1; loadRegister(); });
    el('reg-q').addEventListener('input', debounce(function () { reg.page = 1; loadRegister(); }, 300));
    el('reg-pager').addEventListener('click', function (e) { var p = e.target.closest('[data-page]'); if (p) { reg.page += Number(p.getAttribute('data-page')); loadRegister(); } });
    el('reg-csv').addEventListener('click', function () { exportRegister().catch(function (err) { A.toast(err.message, 'error'); }); });
    el('reg-print').addEventListener('click', function () { document.body.classList.add('print-register'); window.print(); document.body.classList.remove('print-register'); });
  });

  document.addEventListener('att:tab', function (event) {
    if (!S.isTeam) return;
    if (event.detail.tab === 'board') { loadBoard(); startBoardTimer(); }
    if (event.detail.tab === 'register') loadRegister();
  });
})(window, document);
