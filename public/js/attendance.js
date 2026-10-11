/* Attendance: today's clock, the month calendar, day details and correction requests. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var shell = window.PortoHR.shell;
  var QUEUE_KEY = 'portohr.punchQueue';

  var A = (window.PortoHR.att = {
    state: { user: null, isHr: false, isTeam: false, tz: 'UTC', meta: null, today: null, month: null, monthKey: '', employeeId: '', people: [], offset: 0, ticker: null },
  });
  var S = A.state;

  var el = function (id) { return document.getElementById(id); };

  /* ------------------------------------------------------------- helpers */

  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toast(message, tone) {
    var node = document.createElement('div');
    node.className = 'max-w-sm rounded-lg border px-4 py-2.5 text-sm shadow-lg ' + (tone === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800');
    node.textContent = message;
    el('toasts').appendChild(node);
    window.setTimeout(function () { node.remove(); }, 4200);
  }

  function fmt(date, options) {
    return new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: S.tz }, options)).format(new Date(date));
  }
  var clock = function (iso) { return iso ? fmt(iso, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '—'; };
  var hours = function (h) { return h ? (Math.round(h * 100) / 100) + ' h' : '0 h'; };
  var mins = function (m) { return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + ' min'; };

  /** The instant at which the company clock shows `dateKey` + `hhmm` (mirrors the server). */
  function zonedISO(dateKey, hhmm) {
    var p = dateKey.split('-').map(Number);
    var t = hhmm.split(':').map(Number);
    var guess = Date.UTC(p[0], p[1] - 1, p[2], t[0], t[1], 0);
    var offset = function (ms) {
      var parts = {};
      new Intl.DateTimeFormat('en-GB', { timeZone: S.tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
        .formatToParts(new Date(ms)).forEach(function (x) { if (x.type !== 'literal') parts[x.type] = Number(x.value); });
      return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(ms / 1000) * 1000;
    };
    var result = guess - offset(guess);
    result = guess - offset(result);
    return new Date(result).toISOString();
  }

  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function monthTitle(key) { var p = key.split('-'); return MONTH_NAMES[Number(p[1]) - 1] + ' ' + p[0]; }
  function shiftMonth(key, by) { var p = key.split('-').map(Number); var d = new Date(Date.UTC(p[0], p[1] - 1 + by, 1)); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); }
  function weekdayLabel(key) { return new Date(key + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); }

  var STATUS_TEXT = { present: 'Present', short_day: 'Short day', absent: 'Absent', on_leave: 'On leave', in_progress: 'Clocked in', missing_punch: 'Missed punch', rest_day: 'Rest day', holiday: 'Holiday', upcoming: '', not_employed: '' };
  var PILL = { present: 'ok', short_day: 'bad', absent: 'bad', on_leave: 'info', in_progress: 'warn', missing_punch: 'bad', rest_day: '', holiday: 'warn' };

  function openModal(html) {
    el('att-modal-body').innerHTML = html;
    el('att-modal').classList.remove('hidden');
  }
  function closeModal() { el('att-modal').classList.add('hidden'); }

  Object.assign(A, { el: el, esc: esc, toast: toast, fmt: fmt, clock: clock, hours: hours, mins: mins, zonedISO: zonedISO, monthTitle: monthTitle, shiftMonth: shiftMonth, weekdayLabel: weekdayLabel, openModal: openModal, closeModal: closeModal, STATUS_TEXT: STATUS_TEXT });

  /* ---------------------------------------------------------- clock card */

  function tick() {
    var now = new Date(Date.now() + S.offset);
    el('clk-time').innerHTML = fmt(now, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) + '<span class="clk-sec">:' + fmt(now, { second: '2-digit' }).padStart(2, '0') + '</span>';
    el('clk-date').textContent = fmt(now, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  function queued() { try { return JSON.parse(window.localStorage.getItem(QUEUE_KEY)) || []; } catch (err) { return []; } }
  function saveQueue(list) { try { window.localStorage.setItem(QUEUE_KEY, JSON.stringify(list)); } catch (err) { /* private mode */ } }

  function renderQueue() {
    var q = queued();
    el('clk-queue').classList.toggle('hidden', !q.length);
    el('clk-queue').textContent = q.length ? q.length + ' punch' + (q.length === 1 ? '' : 'es') + ' saved on this device, waiting for a connection' : '';
  }

  async function flushQueue() {
    var q = queued();
    if (!q.length || !navigator.onLine) return;
    var remaining = [];
    for (var i = 0; i < q.length; i += 1) {
      try {
        await api.post(q[i].direction === 'out' ? '/attendance/clock-out' : '/attendance/clock-in', { at: q[i].at });
      } catch (err) {
        // A real answer (not a dropped connection) means this punch will never be accepted; drop it.
        if (err && err.status) { toast('A saved punch was refused: ' + err.message, 'error'); } else remaining.push(q[i]);
      }
    }
    saveQueue(remaining);
    renderQueue();
    await loadToday();
    await loadMonth();
  }

  function renderToday(t) {
    S.today = t;
    S.tz = t.timezone || S.tz;
    S.offset = new Date(t.serverTime).getTime() - Date.now();
    el('tz-note').textContent = 'Company time · ' + S.tz.replace('_', ' ');
    var pill = el('clk-status');
    pill.textContent = t.statusLabel;
    pill.className = 'pill ml-auto ' + (PILL[t.status] || '');

    var s = t.shift;
    el('clk-shift').textContent = s ? s.label + (s.startTime ? ' · ' + s.startTime + ' to ' + s.endTime : ' · flexible') + ' · ' + s.expectedHours + ' h' : '';
    var note = el('clk-note');
    var message = t.holiday ? 'Today is a gazetted holiday (' + t.holiday + '). Hours you work are paid at the holiday rate.' : t.restDay ? 'Today is your rest day. Hours you work count as overtime.' : '';
    note.textContent = message;
    note.classList.toggle('hidden', !message);

    var btn = el('clk-btn');
    btn.classList.toggle('out', t.canClockOut);
    btn.disabled = !(t.canClockIn || t.canClockOut);
    if (t.canClockOut) btn.textContent = 'Clock out' + (t.elapsedHours ? ' · ' + hours(t.elapsedHours) + ' on the clock' : '');
    else if (t.canClockIn) btn.textContent = 'Clock in';
    else btn.textContent = !t.webPunchAllowed ? 'Use the time clock' : t.status === 'on_leave' ? 'You are on leave today' : 'Done for today';

    var live = t.punches.filter(function (p) { return !p.voided; });
    var last = live[live.length - 1];
    var canUndo = last && /^web/.test(last.source) && t.undoMinutes && (Date.now() + S.offset - new Date(last.at).getTime()) < t.undoMinutes * 60000;
    el('clk-undo').classList.toggle('hidden', !canUndo);

    el('clk-punches').innerHTML = t.punches.length
      ? t.punches.map(function (p, i) {
          var dir = p.voided ? '' : (live.indexOf(p) % 2 === 0 ? 'in' : 'out');
          return '<li class="' + (p.voided ? 'void' : '') + '"><span class="dot ' + dir + '"></span><span class="t">' + esc(clock(p.at)) + '</span><span>' + (p.voided ? 'Voided' : dir === 'in' ? 'In' : 'Out') + '</span><span class="amini ml-auto">' + esc(String(p.source).replace('_', ' ')) + '</span></li>';
        }).join('')
      : '<li><span class="amini">No punches yet today.</span></li>';
  }

  async function loadToday() {
    try {
      renderToday(await api.get('/attendance/today'));
    } catch (err) {
      el('clk-status').textContent = 'Unavailable';
      el('clk-btn').textContent = err.message || 'Could not load';
      el('clk-btn').disabled = true;
    }
  }

  async function punch() {
    var t = S.today;
    if (!t) return;
    var direction = t.canClockOut ? 'out' : 'in';
    var btn = el('clk-btn');
    btn.disabled = true;
    try {
      var r = await api.post(direction === 'out' ? '/attendance/clock-out' : '/attendance/clock-in', {});
      toast(r.message || 'Recorded');
    } catch (err) {
      if (err && err.status) { toast(err.message, 'error'); }
      else {
        var q = queued();
        q.push({ direction: direction, at: new Date().toISOString() });
        saveQueue(q);
        renderQueue();
        toast('No connection. The punch is saved on this device and will be sent automatically.', 'error');
      }
    }
    await loadToday();
    await loadMonth();
  }

  /* ------------------------------------------------------------ the month */

  function currentTarget() { return S.employeeId || ''; }

  async function loadMonth() {
    try {
      var path = '/attendance?month=' + S.monthKey + (currentTarget() ? '&employee=' + encodeURIComponent(currentTarget()) : '');
      S.month = await api.get(path);
      renderMonth();
    } catch (err) {
      el('cal-grid').innerHTML = '<p class="col-span-7 py-10 text-center text-sm text-slate-500" style="grid-column:1/-1">' + esc(err.message) + '</p>';
    }
  }
  A.reloadMonth = loadMonth;

  function renderKpis(m) {
    var s = m.summary;
    var tiles = [
      ['Present', s.presentDays + s.shortDays + s.inProgressDays, 'days worked', ''],
      ['Absent', s.absentDays, 'unexplained days', s.absentDays ? 'warn' : ''],
      ['On leave', s.leaveDays, 'approved days', ''],
      ['Late', s.lateCount, s.lateMinutes ? mins(s.lateMinutes) + ' in total' : 'arrivals', s.lateCount ? 'warn' : ''],
      ['Overtime', hours(s.overtimeHours), 'beyond the shift', ''],
      ['Hours', hours(s.hoursWorked), 'worked this month', ''],
      ['Missed punch', s.missedPunchDays, s.missedPunchDays ? 'ask for a correction' : 'all clean', s.missedPunchDays ? 'warn' : ''],
      ['Rest / holidays', s.restDays + s.holidayDays, 'days off', ''],
    ];
    el('sum-kpis').innerHTML = tiles.map(function (t) { return '<div class="akpi ' + t[3] + '"><span class="kpi-label">' + esc(t[0]) + '</span><b>' + esc(t[1]) + '</b><small>' + esc(t[2]) + '</small></div>'; }).join('');
    el('sum-title').textContent = (m.employee && m.employee.id && currentTarget() ? m.employee.fullName + ' · ' : '') + monthTitle(m.month);
    el('sum-lock').classList.toggle('hidden', !m.locked);
    el('sum-leave').textContent = m.leave ? (Math.round(m.leave.balanceDays * 10) / 10) + ' days' : '—';
  }

  function renderMonth() {
    var m = S.month;
    renderKpis(m);
    el('cal-title').textContent = monthTitle(m.month);
    var first = new Date(m.month + '-01T00:00:00Z');
    var lead = (first.getUTCDay() + 6) % 7;
    var html = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (d) { return '<div class="cal-h">' + d + '</div>'; }).join('');
    for (var i = 0; i < lead; i += 1) html += '<div class="cal-d is-empty"></div>';
    m.days.forEach(function (d) {
      var label = STATUS_TEXT[d.status] || '';
      var times = d.timeIn ? clock(d.timeIn) + ' – ' + (d.timeOut ? clock(d.timeOut) : '…') : '';
      var badges = (d.lateMinutes ? '<i style="background:var(--accent)" title="Late ' + mins(d.lateMinutes) + '"></i>' : '') +
        (d.overtimeHours > 0 ? '<i style="background:var(--primary)" title="Overtime ' + hours(d.overtimeHours) + '"></i>' : '') +
        (d.request ? '<i style="background:var(--sky)" title="Correction ' + esc(d.request.status) + '"></i>' : '');
      html += '<button type="button" class="cal-d st-' + d.status + (d.isToday ? ' is-today' : '') + '" data-day="' + d.date + '">' +
        '<span class="n">' + Number(d.date.slice(8)) + '</span><span class="bd">' + badges + '</span>' +
        '<span class="s">' + esc(label) + '</span><span class="t">' + esc(times) + '</span>' +
        (d.hoursWorked ? '<span class="t">' + esc(hours(d.hoursWorked)) + '</span>' : '') + '</button>';
    });
    el('cal-grid').innerHTML = html;
    var s = m.summary;
    el('cal-foot').textContent = (m.locked ? 'This month is locked: nothing can change. ' : '') +
      (s.latePenaltyDays ? 'Late arrivals cost ' + s.latePenaltyDays + ' day(s) of pay under the attendance policy. ' : '') +
      'Click any day for its punches, or to ask for a correction.';
  }

  /* ------------------------------------------------------------ day detail */

  async function openDay(date) {
    var target = currentTarget();
    var data;
    try {
      data = await api.get('/attendance/day?date=' + date + (target ? '&employee=' + encodeURIComponent(target) : ''));
    } catch (err) { toast(err.message, 'error'); return; }
    var day = S.month.days.filter(function (d) { return d.date === date; })[0] || {};
    var rec = data.record;
    var live = data.punches.filter(function (p) { return !p.voided; });

    var punchRows = data.punches.length
      ? data.punches.map(function (p) {
          var dir = p.voided ? '' : (live.indexOf(p) % 2 === 0 ? 'In' : 'Out');
          return '<li class="flex items-center gap-3 border-t py-2 text-sm' + (p.voided ? ' opacity-50' : '') + '" style="border-color:var(--border)">' +
            '<span class="font-semibold tabular-nums ' + (p.voided ? 'line-through' : '') + '">' + esc(fmt(p.at, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })) + '</span>' +
            '<span class="pill">' + esc(p.voided ? 'voided' : dir) + '</span><span class="amini">' + esc(String(p.source).replace('_', ' ')) + (p.note ? ' · ' + esc(p.note) : '') + (p.voidedReason ? ' · ' + esc(p.voidedReason) : '') + '</span>' +
            (S.isHr && !p.voided && !S.month.locked ? '<button type="button" class="btn-ghost ml-auto" data-void="' + esc(p._id || p.id) + '">Void</button>' : '') + '</li>';
        }).join('')
      : '<li class="border-t py-3 text-sm text-slate-500" style="border-color:var(--border)">No punches on this day.</li>';

    var facts = [];
    if (rec) {
      if (rec.timeIn) facts.push(['In', clock(rec.timeIn)]);
      if (rec.timeOut) facts.push(['Out', clock(rec.timeOut)]);
      facts.push(['Worked', hours(rec.hoursWorked)], ['Shift owes', hours(rec.expectedHours)]);
      if (rec.lateMinutes) facts.push(['Late', mins(rec.lateMinutes)]);
      if (rec.earlyExitMinutes) facts.push(['Left early', mins(rec.earlyExitMinutes)]);
      if (rec.overtimeHours) facts.push(['Overtime', hours(rec.overtimeHours)]);
      if (rec.shortfallHours) facts.push(['Short by', hours(rec.shortfallHours)]);
    }
    var factHtml = facts.map(function (f) { return '<div><dt class="text-xs text-slate-400">' + esc(f[0]) + '</dt><dd class="text-sm font-semibold tabular-nums">' + esc(f[1]) + '</dd></div>'; }).join('');

    var canRequest = day.canRequest && (!target || S.isHr || target === (S.today && S.today.employee && S.today.employee.id));
    var hrTools = S.isHr && !S.month.locked
      ? '<div class="mt-4 rounded-2xl border p-4" style="border-color:var(--border);background:var(--surface-alt)"><p class="kpi-label mb-2">HR tools</p>' +
        '<div class="field-row"><label class="text-xs font-medium text-slate-500">Time<input id="dm-time" type="time" class="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" /></label>' +
        '<label class="text-xs font-medium text-slate-500">Reason<input id="dm-note" class="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" placeholder="Why add this punch" /></label>' +
        '<div class="flex items-end"><button type="button" id="dm-add" class="btn btn-secondary btn-sm">Add punch</button></div></div>' +
        '<div class="mt-3 flex flex-wrap items-center gap-2"><span class="amini">Set the whole day:</span>' +
        ['absent', 'on_leave', 'present'].map(function (s) { return '<button type="button" class="btn btn-secondary btn-sm" data-mark="' + s + '">' + ({ absent: 'Absent', on_leave: 'On leave', present: 'Present' })[s] + '</button>'; }).join('') +
        (rec && rec.source === 'manual' ? '<button type="button" class="btn btn-ghost" data-mark="clear">Clear manual mark</button>' : '') + '</div></div>'
      : '';

    openModal('<div class="flex flex-wrap items-center gap-2"><h2 class="mr-auto">' + esc(weekdayLabel(date)) + '</h2><span class="pill ' + (PILL[day.status] || '') + '">' + esc(STATUS_TEXT[day.status] || day.statusLabel || '') + '</span><button type="button" class="btn-ghost" data-close>Close</button></div>' +
      '<p class="modal-sub" style="margin-top:0">' + esc(data.employee.fullName) + ' · ' + esc(day.shiftLabel || (data.employee.shift && data.employee.shift.label) || '') + '</p>' +
      (factHtml ? '<dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">' + factHtml + '</dl>' : '') +
      '<ul class="m-0 list-none p-0">' + punchRows + '</ul>' +
      (canRequest ? '<div><button type="button" class="btn btn-primary btn-sm" data-request="' + date + '">Ask for a correction</button></div>' : '') + hrTools);

    var body = el('att-modal-body');
    body.onclick = async function (e) {
      if (e.target.closest('[data-close]')) return closeModal();
      var rq = e.target.closest('[data-request]');
      if (rq) return openRequestForm({ date: rq.getAttribute('data-request') });
      var v = e.target.closest('[data-void]');
      if (v) {
        var reason = window.prompt('Why is this punch being voided?');
        if (!reason) return;
        try { await api.request('/attendance/punches/' + v.getAttribute('data-void'), { method: 'DELETE', body: { reason: reason } }); toast('Punch voided'); closeModal(); await loadMonth(); await loadToday(); } catch (err) { toast(err.message, 'error'); }
        return;
      }
      var mk = e.target.closest('[data-mark]');
      if (mk) {
        try { await api.request('/attendance/day', { method: 'PATCH', body: { employee: data.employee.id, date: date, shiftStatus: mk.getAttribute('data-mark') } }); toast('Day updated'); closeModal(); await loadMonth(); } catch (err) { toast(err.message, 'error'); }
        return;
      }
      if (e.target.closest('#dm-add')) {
        var time = el('dm-time').value;
        var note = el('dm-note').value;
        if (!time) return toast('Enter the punch time', 'error');
        try { await api.post('/attendance/punches', { employee: data.employee.id, at: zonedISO(date, time), note: note }); toast('Punch added'); closeModal(); await loadMonth(); await loadToday(); } catch (err) { toast(err.message, 'error'); }
      }
    };
  }

  /* ------------------------------------------------------ correction form */

  function openRequestForm(prefill) {
    var types = (S.meta && S.meta.requestTypes) || [];
    var date = (prefill && prefill.date) || '';
    var onBehalf = currentTarget() && S.isHr ? currentTarget() : '';
    openModal('<form id="rq-form" class="grid gap-3" novalidate><div class="flex items-center gap-2"><h2 class="mr-auto">Ask for a correction</h2><button type="button" class="btn-ghost" data-close>Close</button></div>' +
      '<p class="modal-sub" style="margin-top:0">' + (onBehalf && S.month ? 'For ' + esc(S.month.employee.fullName) + '. ' : '') + 'Your approver is notified. If approved, the day is rebuilt from the times you give.</p>' +
      '<div id="rq-error" class="modal-error hidden"></div>' +
      '<label>What happened<select id="rq-type">' + types.map(function (t) { return '<option value="' + esc(t.value) + '">' + esc(t.label) + '</option>'; }).join('') + '</select></label>' +
      '<label>Date<input id="rq-date" type="date" value="' + esc(date) + '" max="' + new Date(Date.now() + S.offset).toISOString().slice(0, 10) + '" /></label>' +
      '<div class="grid grid-cols-2 gap-3"><label>Time in<input id="rq-in" type="time" /></label><label>Time out<input id="rq-out" type="time" /></label></div>' +
      '<label style="display:flex;align-items:center;gap:.5rem"><input id="rq-next" type="checkbox" style="width:auto" /> The time out is on the next calendar day (night shift)</label>' +
      '<p id="rq-hint" class="amini"></p>' +
      '<label>Explain why<textarea id="rq-reason" rows="3" placeholder="At least 8 characters"></textarea></label>' +
      '<div class="modal-actions"><button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" class="btn btn-primary">Submit request</button></div></form>');

    var hints = { missed_punch: 'Enter the time you forgot to punch (one of the two is enough).', correction: 'Enter both times. The punches already on that day are replaced.', on_duty: 'Times are optional; the shift hours are used if you leave them empty.', work_from_home: 'Times are optional; the shift hours are used if you leave them empty.' };
    var setHint = function () { el('rq-hint').textContent = hints[el('rq-type').value] || ''; };
    el('rq-type').addEventListener('change', setHint);
    setHint();
    el('att-modal-body').onclick = function (e) { if (e.target.closest('[data-close]')) closeModal(); };

    el('rq-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var err = el('rq-error');
      err.classList.add('hidden');
      try {
        await api.post('/attendance/requests', { employee: onBehalf || undefined, type: el('rq-type').value, date: el('rq-date').value, timeIn: el('rq-in').value, timeOut: el('rq-out').value, outNextDay: el('rq-next').checked, reason: el('rq-reason').value });
        toast('Request submitted');
        closeModal();
        await loadMonth();
        await loadRequests();
      } catch (ex) { err.textContent = ex.message || 'Could not submit'; err.classList.remove('hidden'); }
    });
  }

  /* -------------------------------------------------------- corrections tab */

  var REQ_TONE = { pending: 'warn', approved: 'ok', rejected: 'bad', cancelled: '' };

  function reqTable(rows, mode) {
    if (!rows.length) return '<p class="px-6 pb-8 pt-2 text-center text-sm text-slate-500">' + (mode === 'queue' ? 'Nothing is waiting for you.' : 'You have not raised any corrections.') + '</p>';
    return '<table class="min-w-full text-sm"><thead><tr>' + (mode === 'queue' ? '<th class="px-5 py-3 text-left">Employee</th>' : '') +
      '<th class="px-5 py-3 text-left">Day</th><th class="px-5 py-3 text-left">Request</th><th class="px-5 py-3 text-left">Times</th><th class="px-5 py-3 text-left">Reason</th><th class="px-5 py-3 text-left">Status</th><th class="px-5 py-3"></th></tr></thead><tbody>' +
      rows.map(function (r) {
        var times = [r.timeIn, r.timeOut].filter(Boolean).join(' → ') || '—';
        var actions = '';
        if (mode === 'queue') actions = '<button type="button" class="btn btn-primary btn-sm" data-decide="approved" data-id="' + esc(r.id) + '">Approve</button> <button type="button" class="btn btn-secondary btn-sm" data-decide="rejected" data-id="' + esc(r.id) + '">Reject</button>';
        else if (r.status === 'pending') actions = '<button type="button" class="btn-ghost" data-cancel="' + esc(r.id) + '">Withdraw</button>';
        return '<tr>' + (mode === 'queue' ? '<td class="px-5 py-3"><span class="block font-medium">' + esc(r.snapshot.fullName) + '</span><span class="amini">' + esc(r.snapshot.employeeCode) + '</span></td>' : '') +
          '<td class="px-5 py-3 whitespace-nowrap">' + esc(r.date) + '</td><td class="px-5 py-3">' + esc(r.typeLabel) + '</td><td class="px-5 py-3 tabular-nums">' + esc(times) + (r.outNextDay ? ' <span class="amini">(+1 day)</span>' : '') + '</td>' +
          '<td class="px-5 py-3" style="max-width:18rem">' + esc(r.reason) + (r.decisionNote ? '<span class="amini block">Decision: ' + esc(r.decisionNote) + '</span>' : '') + '</td>' +
          '<td class="px-5 py-3"><span class="pill ' + (REQ_TONE[r.status] || '') + '">' + esc(r.status) + '</span></td><td class="px-5 py-3 text-right whitespace-nowrap">' + actions + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  async function loadRequests() {
    try {
      var results = await Promise.all([api.get('/attendance/requests?scope=mine'), api.get('/attendance/requests?scope=queue')]);
      el('req-mine').innerHTML = reqTable(results[0].requests || [], 'mine');
      var q = results[1];
      el('req-queue-card').classList.toggle('hidden', !q.canApprove);
      el('req-queue').innerHTML = reqTable(q.requests || [], 'queue');
      var count = q.pendingCount || 0;
      el('req-count').textContent = String(count);
      el('req-count').classList.toggle('hidden', !count);
    } catch (err) {
      // Not linked to an employee record: the tab simply stays empty.
      el('req-mine').innerHTML = '<p class="px-6 pb-8 pt-2 text-center text-sm text-slate-500">' + esc(err.message) + '</p>';
    }
  }

  async function decide(id, status) {
    var note = '';
    if (status === 'rejected') {
      note = window.prompt('Reason for rejecting this request?') || '';
      if (!note.trim()) return;
    }
    try {
      await api.request('/attendance/requests/' + id + '/status', { method: 'PATCH', body: { status: status, decisionNote: note } });
      toast('Request ' + status);
      await loadRequests();
      await loadMonth();
      if (shell.refreshApprovals) shell.refreshApprovals();
    } catch (err) { toast(err.message, 'error'); }
  }

  /* ----------------------------------------------------------------- tabs */

  var loadedTabs = {};
  function setTab(tab) {
    document.querySelectorAll('#a-tabs .atab').forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-tab') === tab); });
    ['calendar', 'requests', 'board', 'register', 'shifts', 'tools'].forEach(function (name) {
      var node = el('tab-' + name);
      if (node) node.classList.toggle('hidden', name !== tab);
    });
    try { window.history.replaceState(null, '', '#' + tab); } catch (err) { /* ignore */ }
    document.dispatchEvent(new CustomEvent('att:tab', { detail: { tab: tab, first: !loadedTabs[tab] } }));
    loadedTabs[tab] = true;
  }
  A.setTab = setTab;

  /** Open someone's calendar (used by the register and board). */
  A.openCalendarFor = async function (employeeId, month) {
    S.employeeId = employeeId === (S.today && S.today.employee && S.today.employee.id) ? '' : employeeId;
    if (month) S.monthKey = month;
    var picker = el('cal-employee');
    if (picker) picker.value = S.employeeId;
    setTab('calendar');
    await loadMonth();
    window.scrollTo({ top: el('a-tabs').offsetTop - 90, behavior: 'smooth' });
  };

  async function loadPeople() {
    try {
      var board = await api.get('/attendance/board');
      S.people = board.rows.map(function (r) { return { id: r.id, name: r.name, code: r.code, department: r.department }; });
      var picker = el('cal-employee');
      picker.innerHTML = '<option value="">Myself</option>' + S.people.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + ' (' + esc(p.code) + ')</option>'; }).join('');
      picker.classList.remove('hidden');
      var depts = Array.from(new Set(S.people.map(function (p) { return p.department; }).filter(Boolean))).sort();
      A.departments = depts;
    } catch (err) { /* the picker is optional */ }
  }

  function wire() {
    el('clk-btn').addEventListener('click', punch);
    el('clk-undo').addEventListener('click', async function () {
      try { await api.post('/attendance/clock-undo', {}); toast('Your last punch was taken back'); await loadToday(); await loadMonth(); } catch (err) { toast(err.message, 'error'); }
    });
    el('cal-prev').addEventListener('click', function () { S.monthKey = shiftMonth(S.monthKey, -1); loadMonth(); });
    el('cal-next').addEventListener('click', function () { S.monthKey = shiftMonth(S.monthKey, 1); loadMonth(); });
    el('cal-today').addEventListener('click', function () { S.monthKey = (S.today ? S.today.date : new Date().toISOString().slice(0, 10)).slice(0, 7); loadMonth(); });
    el('cal-employee').addEventListener('change', function (e) { S.employeeId = e.target.value; loadMonth(); });
    el('cal-grid').addEventListener('click', function (e) { var d = e.target.closest('[data-day]'); if (d) openDay(d.getAttribute('data-day')); });
    el('a-tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b) setTab(b.getAttribute('data-tab')); });
    el('req-new').addEventListener('click', function () { openRequestForm({ date: S.today ? S.today.date : '' }); });
    ['req-queue', 'req-mine'].forEach(function (id) {
      el(id).addEventListener('click', function (e) {
        var d = e.target.closest('[data-decide]');
        var c = e.target.closest('[data-cancel]');
        if (d) decide(d.getAttribute('data-id'), d.getAttribute('data-decide'));
        if (c) {
          api.post('/attendance/requests/' + c.getAttribute('data-cancel') + '/cancel', {}).then(function () { toast('Request withdrawn'); loadRequests(); loadMonth(); }).catch(function (err) { toast(err.message, 'error'); });
        }
      });
    });
    el('att-modal').addEventListener('mousedown', function (e) { if (e.target === el('att-modal')) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
    window.addEventListener('online', flushQueue);
  }

  async function init() {
    var user = await shell.mount('attendance');
    if (!user) return;
    S.user = user;
    S.isHr = user.role === 'hr_admin';
    S.isTeam = S.isHr || user.role === 'manager';
    document.querySelectorAll('[data-team]').forEach(function (n) { n.classList.toggle('hidden', !S.isTeam); });
    document.querySelectorAll('[data-hr]').forEach(function (n) { n.classList.toggle('hidden', !S.isHr); });
    if (S.isTeam) el('page-sub').textContent = 'Your own clock and calendar, plus the live board, monthly register, shifts and corrections for your people.';

    wire();
    try { S.meta = (await api.get('/attendance/meta')).meta; S.tz = S.meta.timezone || S.tz; } catch (err) { /* defaults apply */ }
    S.ticker = window.setInterval(tick, 1000);
    await loadToday();
    tick();
    S.monthKey = (S.today ? S.today.date : new Date().toISOString().slice(0, 10)).slice(0, 7);
    renderQueue();
    await Promise.all([loadMonth(), loadRequests(), S.isTeam ? loadPeople() : Promise.resolve()]);
    flushQueue();
    document.dispatchEvent(new CustomEvent('att:ready'));

    var initial = (window.location.hash || '').replace('#', '');
    if (initial && el('tab-' + initial) && !document.querySelector('[data-tab="' + initial + '"].hidden')) setTab(initial);
    window.setInterval(function () { loadToday(); }, 60000);
  }

  init().catch(function (err) {
    if (err && err.status === 401) return;
    console.error('Attendance failed to initialise', err);
  });
})(window, document);
