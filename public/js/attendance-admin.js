/* Attendance → Shifts & roster, punch import, month locks and the attendance rules. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var csv = window.PortoHR.csv;
  var A = window.PortoHR.att;
  var S = A.state;
  var el = A.el;
  var esc = A.esc;
  var parsedRows = [];

  /* ============================== shifts ============================== */

  function windowText(s) { return s.startTime ? s.startTime + ' – ' + s.endTime + (s.overnight ? ' (next day)' : '') : 'Flexible'; }

  async function loadShifts() {
    try {
      var shifts = (await api.get('/attendance/shifts')).shifts;
      el('shift-new').classList.toggle('hidden', !S.isHr);
      el('shift-board').innerHTML = '<table class="min-w-full text-sm"><thead><tr><th class="px-5 py-3 text-left">Shift</th><th class="px-5 py-3 text-left">Hours</th><th class="px-5 py-3 text-right">Break</th><th class="px-5 py-3 text-right">Paid hours</th><th class="px-5 py-3 text-right">Grace in / out</th><th class="px-5 py-3 text-right">People</th><th class="px-5 py-3"></th></tr></thead><tbody>' +
        shifts.map(function (s) {
          return '<tr><td class="px-5 py-3"><span class="block font-medium">' + esc(s.name) + (s.active ? '' : ' <span class="pill">inactive</span>') + '</span><span class="amini">' + esc(s.code) + '</span></td>' +
            '<td class="px-5 py-3">' + esc(windowText(s)) + '</td><td class="px-5 py-3 text-right tabular-nums">' + s.breakMinutes + ' min</td><td class="px-5 py-3 text-right tabular-nums">' + esc(s.derivedHours) + ' h</td>' +
            '<td class="px-5 py-3 text-right tabular-nums">' + s.graceInMinutes + ' / ' + s.graceOutMinutes + ' min</td><td class="px-5 py-3 text-right tabular-nums">' + s.employees + '</td>' +
            '<td class="px-5 py-3 text-right">' + (S.isHr ? '<button type="button" class="btn-ghost" data-edit-shift=\'' + esc(JSON.stringify(s)) + '\'>Edit</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table>';
      var options = shifts.filter(function (s) { return s.active; });
      el('ro-shift').innerHTML = options.map(function (s) { return '<option value="' + esc(s.code) + '">' + esc(s.name) + ' · ' + esc(windowText(s)) + '</option>'; }).join('');
    } catch (err) {
      el('shift-board').innerHTML = '<p class="px-6 py-8 text-center text-sm text-slate-500">' + esc(err.message) + '</p>';
    }
  }

  function shiftForm(shift) {
    var isNew = !shift;
    var s = shift || { code: '', name: '', startTime: '09:00', endTime: '18:00', breakMinutes: 60, expectedHours: 0, graceInMinutes: 10, graceOutMinutes: 10, active: true };
    A.openModal('<form id="shift-form" class="grid gap-3" novalidate><div class="flex items-center gap-2"><h2 class="mr-auto">' + (isNew ? 'Add a shift' : 'Edit ' + esc(s.name)) + '</h2><button type="button" class="btn-ghost" data-close>Close</button></div>' +
      '<div id="shift-error" class="modal-error hidden"></div>' +
      '<div class="grid grid-cols-2 gap-3"><label>Code<input id="sf-code" value="' + esc(s.code) + '"' + (isNew ? '' : ' disabled') + ' placeholder="e.g. split" /></label><label>Name<input id="sf-name" value="' + esc(s.name) + '" /></label></div>' +
      '<div class="grid grid-cols-2 gap-3"><label>Starts<input id="sf-start" type="time" value="' + esc(s.startTime || '') + '" /></label><label>Ends<input id="sf-end" type="time" value="' + esc(s.endTime || '') + '" /></label></div>' +
      '<p class="amini">Leave both times empty for a flexible shift: only the hours owed matter, not when they fall. An end time earlier than the start means the shift finishes the next day.</p>' +
      '<div class="grid grid-cols-3 gap-3"><label>Break (min)<input id="sf-break" type="number" min="0" max="240" value="' + s.breakMinutes + '" /></label><label>Paid hours<input id="sf-hours" type="number" min="0" max="16" step="0.25" value="' + (s.expectedHours || '') + '" placeholder="auto" /></label><label>Grace in (min)<input id="sf-gin" type="number" min="0" max="120" value="' + s.graceInMinutes + '" /></label></div>' +
      '<div class="grid grid-cols-2 gap-3"><label>Grace out (min)<input id="sf-gout" type="number" min="0" max="120" value="' + s.graceOutMinutes + '" /></label><label style="align-content:end"><span style="display:flex;align-items:center;gap:.5rem"><input id="sf-active" type="checkbox" style="width:auto"' + (s.active ? ' checked' : '') + ' /> Active</span></label></div>' +
      '<div class="modal-actions"><button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" class="btn btn-primary">Save shift</button></div></form>');
    el('att-modal-body').onclick = function (e) { if (e.target.closest('[data-close]')) A.closeModal(); };
    el('shift-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var body = { name: el('sf-name').value, startTime: el('sf-start').value, endTime: el('sf-end').value, breakMinutes: el('sf-break').value, expectedHours: el('sf-hours').value || 0, graceInMinutes: el('sf-gin').value, graceOutMinutes: el('sf-gout').value, active: el('sf-active').checked };
      try {
        if (isNew) await api.post('/attendance/shifts', Object.assign({ code: el('sf-code').value }, body));
        else await api.request('/attendance/shifts/' + s.id, { method: 'PATCH', body: body });
        A.toast('Shift saved');
        A.closeModal();
        await loadShifts();
        document.dispatchEvent(new CustomEvent('att:shifts-changed'));
      } catch (err) { el('shift-error').textContent = err.message; el('shift-error').classList.remove('hidden'); }
    });
  }

  async function loadRoster() {
    var today = S.today ? S.today.date : new Date().toISOString().slice(0, 10);
    var from = new Date(new Date(today + 'T00:00:00Z').getTime() - 7 * 86400000).toISOString().slice(0, 10);
    var to = new Date(new Date(today + 'T00:00:00Z').getTime() + 90 * 86400000).toISOString().slice(0, 10);
    try {
      var entries = (await api.get('/attendance/roster?from=' + from + '&to=' + to)).entries;
      el('roster-board').innerHTML = entries.length
        ? '<table class="min-w-full text-sm"><thead><tr><th class="px-5 py-3 text-left">Employee</th><th class="px-5 py-3 text-left">Department</th><th class="px-5 py-3 text-left">Shift</th><th class="px-5 py-3 text-left">From</th><th class="px-5 py-3 text-left">To</th><th class="px-5 py-3"></th></tr></thead><tbody>' +
          entries.map(function (r) {
            return '<tr><td class="px-5 py-2.5"><span class="font-medium">' + esc(r.employee ? r.employee.fullName : '—') + '</span><span class="amini block">' + esc(r.employee ? r.employee.code : '') + '</span></td><td class="px-5 py-2.5">' + esc(r.employee ? r.employee.department : '') + '</td>' +
              '<td class="px-5 py-2.5"><span class="pill info">' + esc(r.shiftLabel) + '</span></td><td class="px-5 py-2.5 tabular-nums">' + esc(r.from) + '</td><td class="px-5 py-2.5 tabular-nums">' + esc(r.to) + '</td>' +
              '<td class="px-5 py-2.5 text-right">' + (S.isHr ? '<button type="button" class="btn-ghost" data-rm-roster="' + esc(r.id) + '">Remove</button>' : '') + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<p class="px-6 py-8 text-center text-sm text-slate-500">No one is on a temporary shift right now.</p>';
    } catch (err) { el('roster-board').innerHTML = '<p class="px-6 py-8 text-center text-sm text-slate-500">' + esc(err.message) + '</p>'; }
  }

  function fillRosterPickers() {
    el('ro-dept').innerHTML = '<option value="">Choose…</option>' + (A.departments || []).map(function (d) { return '<option>' + esc(d) + '</option>'; }).join('');
    el('ro-emp').innerHTML = '<option value="">Choose…</option>' + S.people.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + ' (' + esc(p.code) + ')</option>'; }).join('');
  }

  /* ============================== import ============================== */

  function problemList(problems, total) {
    if (!problems.length) return '';
    return '<div class="rounded-xl border p-3 text-xs" style="border-color:var(--border)"><p class="mb-1 font-semibold">' + total + ' row' + (total === 1 ? '' : 's') + ' will be skipped</p><ul class="list-disc pl-4 text-red-600">' +
      problems.slice(0, 12).map(function (p) { return '<li>Line ' + p.line + (p.code ? ' (' + esc(p.code) + ')' : '') + ': ' + esc(p.errors.join(', ')) + '</li>'; }).join('') + (total > 12 ? '<li>and ' + (total - 12) + ' more</li>' : '') + '</ul></div>';
  }

  async function readRows() {
    var file = el('imp-file').files[0];
    var text = file ? await file.text() : el('imp-paste').value;
    return csv.parse(text);
  }

  async function checkImport() {
    el('imp-result').textContent = '';
    el('imp-problems').innerHTML = '';
    el('imp-go').classList.add('hidden');
    parsedRows = await readRows();
    if (!parsedRows.length) { el('imp-result').textContent = 'No rows found. The first line must be the column headings.'; return; }
    try {
      var r = await api.post('/attendance/import', { rows: parsedRows, commit: false });
      el('imp-result').textContent = r.valid + ' of ' + r.total + ' punches are ready' + (r.valid ? ' (' + r.employees + ' employees, ' + r.from + ' to ' + r.to + ')' : '') + '.';
      el('imp-problems').innerHTML = problemList(r.problems, r.problemCount);
      el('imp-go').classList.toggle('hidden', !r.valid);
      el('imp-go').textContent = 'Import ' + r.valid + ' punches';
    } catch (err) { el('imp-result').textContent = err.message; }
  }

  async function commitImport() {
    el('imp-go').disabled = true;
    try {
      var r = await api.post('/attendance/import', { rows: parsedRows, commit: true });
      el('imp-result').textContent = 'Imported ' + r.valid + ' punches. ' + r.daysRebuilt + ' day(s) rebuilt.';
      el('imp-go').classList.add('hidden');
      el('imp-problems').innerHTML = problemList(r.problems, r.problemCount);
      A.toast('Punches imported');
      await loadBatches();
      await A.reloadMonth();
    } catch (err) { el('imp-result').textContent = err.message; }
    el('imp-go').disabled = false;
  }

  async function loadBatches() {
    try {
      var batches = (await api.get('/attendance/import/batches')).batches;
      el('imp-batches').innerHTML = batches.length
        ? '<table class="min-w-full text-sm"><thead><tr><th class="px-5 py-3 text-left">Imported</th><th class="px-5 py-3 text-left">Covers</th><th class="px-5 py-3 text-right">Employees</th><th class="px-5 py-3 text-right">Punches</th><th class="px-5 py-3"></th></tr></thead><tbody>' +
          batches.map(function (b) {
            return '<tr><td class="px-5 py-2.5 whitespace-nowrap">' + esc(new Date(b.importedAt).toLocaleString()) + '</td><td class="px-5 py-2.5 whitespace-nowrap">' + esc(A.fmt(b.from, { day: '2-digit', month: 'short' })) + ' – ' + esc(A.fmt(b.to, { day: '2-digit', month: 'short', year: 'numeric' })) + '</td>' +
              '<td class="px-5 py-2.5 text-right tabular-nums">' + b.employees + '</td><td class="px-5 py-2.5 text-right tabular-nums">' + b.live + (b.live !== b.punches ? ' <span class="amini">of ' + b.punches + '</span>' : '') + '</td>' +
              '<td class="px-5 py-2.5 text-right">' + (b.live ? '<button type="button" class="btn-ghost" data-undo="' + esc(b.batch) + '">Undo import</button>' : '<span class="pill">undone</span>') + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<p class="py-4 text-sm text-slate-500">No imports yet.</p>';
    } catch (err) { /* optional */ }
  }

  /* =============================== locks =============================== */

  async function loadLocks() {
    try {
      var r = await api.get('/attendance/locks');
      if (!el('lock-month').value) {
        var p = r.currentMonth.split('-').map(Number);
        var prev = new Date(Date.UTC(p[0], p[1] - 2, 1));
        el('lock-month').value = prev.getUTCFullYear() + '-' + String(prev.getUTCMonth() + 1).padStart(2, '0');
      }
      el('lock-board').innerHTML = r.locks.length
        ? '<table class="min-w-full text-sm"><thead><tr><th class="px-5 py-3 text-left">Month</th><th class="px-5 py-3 text-left">Locked by</th><th class="px-5 py-3 text-left">When</th><th class="px-5 py-3"></th></tr></thead><tbody>' +
          r.locks.map(function (l) {
            return '<tr><td class="px-5 py-2.5 font-medium">' + esc(A.monthTitle(l.month)) + '</td><td class="px-5 py-2.5">' + esc(l.lockedByName || '—') + '</td><td class="px-5 py-2.5">' + esc(new Date(l.createdAt).toLocaleDateString()) + '</td><td class="px-5 py-2.5 text-right"><button type="button" class="btn-ghost" data-unlock="' + esc(l.month) + '">Reopen</button></td></tr>';
          }).join('') + '</tbody></table>'
        : '<p class="text-sm text-slate-500">No months are locked.</p>';
    } catch (err) { /* optional */ }
  }

  async function lockMonth(force) {
    var month = el('lock-month').value;
    if (!month) return;
    try {
      await api.post('/attendance/locks', { month: month, force: force === true });
      el('lock-note').textContent = A.monthTitle(month) + ' is locked.';
      A.toast('Month locked');
      await loadLocks();
    } catch (err) {
      if (err.status === 409 && /undecided|missed punch/.test(err.message) && !force) {
        if (window.confirm(err.message + '\n\nLock it anyway?')) return lockMonth(true);
      }
      el('lock-note').textContent = err.message;
    }
  }

  /* ============================== policy =============================== */

  var FIELDS = [
    ['Time clock', [
      ['minPunchGapMinutes', 'Ignore repeat taps within (minutes)', 'A time clock can register one tap twice.'],
      ['minSpanMinutes', 'Shortest counted in-to-out (minutes)', 'A shorter pair is treated as a bounce, not work.'],
      ['autoCloseHours', 'Treat an open shift as a missed punch after (hours)', 'An IN with no OUT this long ago is flagged for correction.'],
    ]],
    ['Overtime', [
      ['overtime.enabled', 'Count overtime', '', 'bool'],
      ['overtime.thresholdMinutes', 'Ignore the first (minutes)', 'Time beyond the shift before overtime starts.'],
      ['overtime.roundToMinutes', 'Round down to blocks of (minutes)', ''],
      ['overtime.restDayAllOvertime', 'Every hour on a rest day is overtime', '', 'bool'],
    ]],
    ['Late arrivals', [
      ['late.penaltyEveryNLates', 'Every N late arrivals cost pay (0 = never)', 'Counted per month, beyond each shift’s grace period.'],
      ['late.penaltyDays', 'Days of pay lost each time', ''],
    ]],
    ['Web clock-in', [
      ['webPunch.allowed', 'Allow clocking in on the web', 'Switch off if people must use the time clock.', 'bool'],
      ['webPunch.undoMinutes', 'Allow taking back a punch for (minutes, 0 = never)', ''],
      ['webPunch.backfillHours', 'Accept saved offline punches up to (hours old)', ''],
    ]],
    ['Corrections', [
      ['regularization.maxBackDays', 'Corrections allowed for the last (days)', ''],
      ['regularization.maxPerMonth', 'Corrections per person per month (0 = unlimited)', ''],
    ]],
  ];

  const get = (obj, path) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);

  async function loadPolicy() {
    try {
      var p = (await api.get('/attendance/policy')).policy;
      el('policy-form').innerHTML = FIELDS.map(function (group) {
        return '<fieldset class="rounded-2xl border p-4" style="border-color:var(--border)"><legend class="px-2 text-xs font-bold uppercase tracking-wider text-slate-400">' + group[0] + '</legend><div class="field-row">' +
          group[1].map(function (f) {
            var v = get(p, f[0]);
            return f[3] === 'bool'
              ? '<label class="flex items-start gap-2 text-sm"><input type="checkbox" class="chk mt-0.5" data-path="' + f[0] + '"' + (v ? ' checked' : '') + ' style="width:1.05rem;height:1.05rem" /><span>' + esc(f[1]) + (f[2] ? '<span class="amini block">' + esc(f[2]) + '</span>' : '') + '</span></label>'
              : '<label class="text-sm"><span class="block text-xs font-medium text-slate-500">' + esc(f[1]) + '</span><input type="number" step="any" data-path="' + f[0] + '" value="' + esc(v) + '" class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />' + (f[2] ? '<span class="amini block mt-1">' + esc(f[2]) + '</span>' : '') + '</label>';
          }).join('') + '</div></fieldset>';
      }).join('') + '<div><button type="submit" class="btn btn-primary">Save rules</button> <span id="policy-note" class="ml-3 text-sm text-slate-500"></span></div>';
    } catch (err) { el('policy-form').innerHTML = '<p class="text-sm text-slate-500">' + esc(err.message) + '</p>'; }
  }

  async function savePolicy(event) {
    event.preventDefault();
    var body = {};
    el('policy-form').querySelectorAll('[data-path]').forEach(function (input) {
      var keys = input.getAttribute('data-path').split('.');
      var o = body;
      keys.slice(0, -1).forEach(function (k) { o[k] = o[k] || {}; o = o[k]; });
      o[keys[keys.length - 1]] = input.type === 'checkbox' ? input.checked : Number(input.value);
    });
    try {
      await api.request('/attendance/policy', { method: 'PUT', body: body });
      el('policy-note').textContent = 'Saved. New punches follow these rules straight away; rebuild affected days by importing or correcting them.';
      A.toast('Rules saved');
    } catch (err) { el('policy-note').textContent = err.message; A.toast(err.message, 'error'); }
  }

  /* ============================== wiring =============================== */

  document.addEventListener('att:tab', function (event) {
    if (!S.isTeam) return;
    if (event.detail.tab === 'shifts') { fillRosterPickers(); loadShifts(); loadRoster(); }
    if (event.detail.tab === 'tools' && S.isHr) { loadBatches(); loadLocks(); loadPolicy(); }
  });

  document.addEventListener('att:ready', function () {
    if (!S.isTeam) return;
    el('shift-new').addEventListener('click', function () { shiftForm(null); });
    el('shift-board').addEventListener('click', function (e) {
      var b = e.target.closest('[data-edit-shift]');
      if (b) shiftForm(JSON.parse(b.getAttribute('data-edit-shift')));
    });
    el('roster-board').addEventListener('click', function (e) {
      var b = e.target.closest('[data-rm-roster]');
      if (!b || !window.confirm('Remove this temporary shift? The days will be rebuilt on the usual shift.')) return;
      api.request('/attendance/roster/' + b.getAttribute('data-rm-roster'), { method: 'DELETE' }).then(function () { A.toast('Removed'); loadRoster(); A.reloadMonth(); }).catch(function (err) { A.toast(err.message, 'error'); });
    });
    el('roster-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var err = el('ro-error');
      err.classList.add('hidden');
      var body = { from: el('ro-from').value, to: el('ro-to').value || el('ro-from').value, shift: el('ro-shift').value };
      if (el('ro-emp').value) body.employees = [el('ro-emp').value];
      else if (el('ro-dept').value) body.department = el('ro-dept').value;
      try {
        var r = await api.post('/attendance/roster', body);
        A.toast(r.employees + ' employee(s) assigned');
        loadRoster();
        A.reloadMonth();
      } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); }
    });

    if (!S.isHr) return;
    el('imp-check').addEventListener('click', checkImport);
    el('imp-go').addEventListener('click', commitImport);
    el('imp-template').addEventListener('click', function () {
      csv.download('punch-import-template.csv', ['Employee Code', 'Date Time', 'Direction'], [['PH-1004', '2026-10-05 08:57:12', 'IN'], ['PH-1004', '2026-10-05 18:04:40', 'OUT']]);
    });
    el('imp-batches').addEventListener('click', function (e) {
      var u = e.target.closest('[data-undo]');
      if (!u || !window.confirm('Undo this import? Its punches are voided and the days rebuilt.')) return;
      api.request('/attendance/import/' + u.getAttribute('data-undo'), { method: 'DELETE' }).then(function (r) { A.toast(r.voided + ' punches voided'); loadBatches(); A.reloadMonth(); }).catch(function (err) { A.toast(err.message, 'error'); });
    });
    el('lock-go').addEventListener('click', function () { lockMonth(false); });
    el('lock-board').addEventListener('click', function (e) {
      var u = e.target.closest('[data-unlock]');
      if (!u || !window.confirm('Reopen ' + u.getAttribute('data-unlock') + '? Punches and corrections will be possible again.')) return;
      api.request('/attendance/locks/' + u.getAttribute('data-unlock'), { method: 'DELETE' }).then(function () { A.toast('Month reopened'); loadLocks(); A.reloadMonth(); }).catch(function (err) { A.toast(err.message, 'error'); });
    });
    el('policy-form').addEventListener('submit', savePolicy);
  });
})(window, document);
