/* Attendance: clock in/out widget, leave balance, and the monthly time log. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var shell = window.PortoHR.shell;

  var QUEUE_KEY = 'portohr.punchQueue';

  function readQueue() {
    try {
      var rows = JSON.parse(window.localStorage.getItem(QUEUE_KEY) || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch (err) {
      return [];
    }
  }

  function writeQueue(rows) {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(rows));
  }

  function isOfflineError(err) {
    if (!err) return false;
    if (err.status) return false;
    return err.name === 'TypeError' || /Failed to fetch|NetworkError|Load failed/i.test(err.message || '');
  }

  function renderQueue() {
    var node = el('punch-queue');
    if (!node) return;
    var count = readQueue().length;
    node.classList.toggle('hidden', count === 0);
    node.textContent = count ? count + (count === 1 ? ' punch waiting to sync' : ' punches waiting to sync') : '';
  }

  async function replayQueue() {
    var rows = readQueue();
    if (!rows.length) {
      renderQueue();
      return;
    }
    var keep = [];
    var i;
    for (i = 0; i < rows.length; i += 1) {
      try {
        var result = await api.post(rows[i].action === 'clock-out' ? '/attendance/clock-out' : '/attendance/clock-in');
        toast(result.message || 'Queued punch synced');
      } catch (err) {
        if (isOfflineError(err)) {
          keep = rows.slice(i);
          break;
        }
        if (err.status !== 409) {
          toast(err.message, 'error');
        }
      }
    }
    writeQueue(keep);
    renderQueue();
  }

  var state = {
    user: null,
    today: null,
    month: null,
    viewingEmployee: null, // null means "my own record"
    busy: false,
  };

  var el = function (id) {
    return document.getElementById(id);
  };

  // ---------------------------------------------------------------- helpers

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(
      /[&<>"']/g,
      function (char) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
      }
    );
  }

  /** 2.75 -> "2h 45m". Used everywhere hours are shown to a person. */
  function formatHours(hours) {
    if (!hours || hours <= 0) return '0h';
    var whole = Math.floor(hours);
    var minutes = Math.round((hours - whole) * 60);
    if (minutes === 60) {
      whole += 1;
      minutes = 0;
    }
    return whole + 'h' + (minutes ? ' ' + minutes + 'm' : '');
  }

  function pluralDays(count) {
    return count + (count === 1 ? ' day' : ' days');
  }

  function formatClock(isoString) {
    if (!isoString) return '—';
    return new Date(isoString).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /** Day keys are plain YYYY-MM-DD, so parse them as local dates, not UTC. */
  function dayDate(iso) {
    return new Date(iso + 'T00:00:00');
  }

  function monthLabel(month) {
    var parts = month.split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, 1).toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
    });
  }

  function shiftMonth(month, step) {
    var parts = month.split('-');
    var date = new Date(Number(parts[0]), Number(parts[1]) - 1 + step, 1);
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
  }

  function thisMonth() {
    var now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  }

  function toast(message, tone) {
    var toneClass =
      tone === 'error'
        ? 'border-red-200 bg-red-50 text-red-800'
        : 'border-emerald-200 bg-emerald-50 text-emerald-800';
    var node = document.createElement('div');
    node.className =
      'rounded-lg border px-4 py-2.5 text-sm shadow-lg transition-opacity duration-300 ' + toneClass;
    node.textContent = message;
    el('toasts').appendChild(node);
    window.setTimeout(function () {
      node.classList.add('opacity-0');
      window.setTimeout(function () {
        node.remove();
      }, 300);
    }, 3600);
  }

  // ------------------------------------------------------------ status tones

  var STATUS_TONES = {
    present: 'bg-slate-100 text-slate-700 ring-slate-500/20',
    short_day: 'bg-red-50 text-red-700 ring-red-600/20',
    absent: 'bg-red-50 text-red-700 ring-red-600/20',
    on_leave: 'bg-sky-50 text-sky-700 ring-sky-600/20',
    in_progress: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    rest_day: 'bg-slate-50 text-slate-400 ring-slate-400/20',
    upcoming: 'bg-slate-50 text-slate-400 ring-slate-400/20',
    not_employed: 'bg-slate-50 text-slate-400 ring-slate-400/20',
  };

  function statusBadge(status, label) {
    return (
      '<span class="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ' +
      (STATUS_TONES[status] || STATUS_TONES.present) +
      '">' +
      escapeHtml(label) +
      '</span>'
    );
  }

  // ------------------------------------------------------------- clock card

  function tick() {
    el('clock-time').textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });

    // While a shift is open the "worked today" figure counts up with the clock.
    if (state.today && state.today.canClockOut && state.today.record) {
      var elapsed = (Date.now() - new Date(state.today.record.timeIn).getTime()) / 3600000;
      var net = Math.max(0, elapsed - (state.today.employee.shift.breakMinutes || 0) / 60);
      el('today-hours').textContent = formatHours(net);
    }
  }

  function renderToday() {
    var data = state.today;
    var shift = data.employee.shift;

    el('clock-date').textContent = new Date().toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    el('clock-status').className =
      'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ' +
      (STATUS_TONES[data.status] || 'bg-slate-100 text-slate-600 ring-slate-500/20');
    el('clock-status').textContent = data.statusLabel;

    el('clock-shift').textContent =
      shift.label +
      ' shift' +
      (shift.startTime ? ' · ' + shift.startTime + ' – ' + shift.endTime : '') +
      ' · owes ' +
      formatHours(shift.expectedHours);

    var button = el('clock-button');
    var hint = el('clock-hint');

    if (data.canClockOut) {
      el('clock-button-text').textContent = 'Clock out';
      button.disabled = false;
      button.className = button.className.replace(/bg-slate-900|bg-red-600/, 'bg-red-600').replace(/hover:bg-slate-800|hover:bg-red-700/, 'hover:bg-red-700');
      hint.textContent = 'Clocked in at ' + formatClock(data.record.timeIn);
    } else if (data.canClockIn) {
      el('clock-button-text').textContent = 'Clock in';
      button.disabled = false;
      button.className = button.className.replace(/bg-red-600|bg-slate-900/, 'bg-slate-900').replace(/hover:bg-red-700|hover:bg-slate-800/, 'hover:bg-slate-800');
      hint.textContent = 'Start your ' + shift.label.toLowerCase() + ' shift';
    } else {
      el('clock-button-text').textContent = 'Day complete';
      button.disabled = true;
      hint.textContent =
        data.status === 'on_leave'
          ? 'Today is marked as paid leave'
          : 'You have already clocked out today';
    }

    el('today-in').textContent = data.record ? formatClock(data.record.timeIn) : '—';
    el('today-out').textContent = data.record ? formatClock(data.record.timeOut) : '—';
    el('today-hours').textContent =
      data.record && data.record.timeOut ? formatHours(data.record.hoursWorked) : '—';
    el('today-expected').textContent = formatHours(shift.expectedHours);
  }

  async function loadToday() {
    try {
      state.today = await api.get('/attendance/today');
      renderToday();
      tick();
    } catch (err) {
      if (err.status === 401) return;
      el('clock-status').textContent = 'Unavailable';
      el('clock-hint').textContent = err.message;
      el('clock-button').disabled = true;
      el('clock-button-text').textContent = 'Unavailable';
    }
  }

  async function handleClock() {
    if (state.busy || !state.today) return;
    var clockingOut = state.today.canClockOut;

    state.busy = true;
    el('clock-button').disabled = true;
    el('clock-spinner').classList.remove('hidden');

    try {
      var result = await api.post(clockingOut ? '/attendance/clock-out' : '/attendance/clock-in');
      toast(result.message);
      await loadToday();
      // The month log includes today, so it has to be refreshed alongside.
      if (!state.viewingEmployee) await loadMonth();
    } catch (err) {
      if (isOfflineError(err)) {
        var queued = readQueue();
        queued.push({ action: clockingOut ? 'clock-out' : 'clock-in', at: new Date().toISOString() });
        writeQueue(queued);
        renderQueue();
        toast('Offline — punch queued and will sync when you are back');
      } else if (err.status !== 401) {
        toast(err.message, 'error');
        await loadToday();
      }
    } finally {
      state.busy = false;
      el('clock-spinner').classList.add('hidden');
    }
  }

  // ---------------------------------------------------------- leave + stats

  function renderLeave(data) {
    var leave = data.leave;
    var yearLabel = el('leave-year');
    if (yearLabel) yearLabel.textContent = leave.year;
    el('leave-available').textContent = leave.balanceDays;
    el('leave-taken').textContent = leave.takenDays;
    el('leave-taken-2').textContent = pluralDays(leave.takenDays);
    el('leave-entitlement').textContent = leave.entitlementDays;
    el('leave-month').textContent = pluralDays(data.summary.leaveDays);
    var pending = el('leave-pending');
    if (pending) pending.textContent = pluralDays(leave.pendingDays || 0);

    var used = leave.entitlementDays ? (leave.takenDays / leave.entitlementDays) * 100 : 0;
    el('leave-bar').style.width = Math.min(100, Math.max(0, used)) + '%';
    el('leave-bar').className =
      'h-full rounded-full transition-all duration-500 ' +
      (used >= 100 ? 'bg-red-500' : used >= 75 ? 'bg-amber-500' : 'bg-slate-900');
  }

  function tile(label, value, sub, tone) {
    var valueClass =
      tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-red-600' : 'text-slate-900';
    return (
      '<div class="rounded-xl border border-slate-200 bg-white p-5 shadow-card">' +
      '<p class="text-xs font-medium uppercase tracking-wider text-slate-400">' +
      escapeHtml(label) +
      '</p>' +
      '<p class="mt-2 text-2xl font-semibold tracking-tight ' +
      valueClass +
      '">' +
      escapeHtml(value) +
      '</p>' +
      '<p class="mt-0.5 text-xs text-slate-500">' +
      escapeHtml(sub) +
      '</p></div>'
    );
  }

  function renderTiles(data) {
    var summary = data.summary;
    el('stat-tiles').innerHTML =
      tile('Present', String(summary.presentDays), 'days worked in full') +
      tile('Overtime', formatHours(summary.overtimeHours), 'beyond shift hours', summary.overtimeHours > 0 ? 'good' : null) +
      tile('Short days', String(summary.shortDays), formatHours(summary.shortfallHours) + ' short in total', summary.shortDays > 0 ? 'bad' : null) +
      tile('Absent', String(summary.absentDays), 'unrecorded working days', summary.absentDays > 0 ? 'bad' : null);
  }

  // ------------------------------------------------------------- month table

  function attendanceRow(day) {
    var muted = day.status === 'rest_day' || day.status === 'upcoming' || day.status === 'not_employed';

    // Overtime is highlighted green, short days and absences red.
    var rowTone = '';
    if (day.overtimeHours > 0) rowTone = 'bg-emerald-50/50';
    else if (day.status === 'short_day' || day.status === 'absent') rowTone = 'bg-red-50/50';
    else if (muted) rowTone = 'bg-slate-50/40';

    var date = dayDate(day.date);
    var dateCell =
      '<span class="font-medium ' +
      (muted ? 'text-slate-400' : 'text-slate-900') +
      '">' +
      escapeHtml(date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })) +
      '</span>' +
      '<span class="ml-2 text-xs text-slate-400">' +
      escapeHtml(day.weekdayLabel) +
      '</span>' +
      (day.isToday
        ? '<span class="ml-2 inline-flex rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Today</span>'
        : '');

    var overtimeCell =
      day.overtimeHours > 0
        ? '<span class="font-semibold text-emerald-600">+' + escapeHtml(formatHours(day.overtimeHours)) + '</span>'
        : day.shortfallHours > 0
          ? '<span class="font-semibold text-red-600">−' + escapeHtml(formatHours(day.shortfallHours)) + '</span>'
          : '<span class="text-slate-300">—</span>';

    var workedCell = day.timeIn
      ? '<span class="' + (day.status === 'short_day' ? 'text-red-600' : 'text-slate-900') + ' font-medium">' +
        escapeHtml(day.timeOut ? formatHours(day.hoursWorked) : 'In progress') +
        '</span>'
      : '<span class="text-slate-300">—</span>';

    return (
      '<tr class="' + rowTone + '">' +
      '<td class="whitespace-nowrap px-6 py-3">' + dateCell + '</td>' +
      '<td class="px-6 py-3 tabular-nums ' + (muted ? 'text-slate-300' : 'text-slate-700') + '">' +
      escapeHtml(formatClock(day.timeIn)) +
      '</td>' +
      '<td class="px-6 py-3 tabular-nums ' + (muted ? 'text-slate-300' : 'text-slate-700') + '">' +
      escapeHtml(formatClock(day.timeOut)) +
      '</td>' +
      '<td class="px-6 py-3 text-right tabular-nums">' + workedCell + '</td>' +
      '<td class="px-6 py-3 text-right tabular-nums">' + overtimeCell + '</td>' +
      '<td class="px-6 py-3">' + statusBadge(day.status, day.statusLabel) + '</td>' +
      '</tr>'
    );
  }

  function renderMonth(data) {
    el('attendance-rows').innerHTML = data.days.map(attendanceRow).join('');
    el('log-error').classList.add('hidden');
    el('month-label').textContent = monthLabel(data.month);
    el('month-next').disabled = data.month >= thisMonth();

    el('log-subject').textContent =
      data.employee.fullName + ' · ' + data.employee.shift.label + ' shift';

    var summary = data.summary;
    el('log-summary').textContent =
      summary.presentDays +
      ' present · ' +
      summary.shortDays +
      ' short · ' +
      summary.absentDays +
      ' absent · ' +
      summary.leaveDays +
      ' on leave · ' +
      formatHours(summary.hoursWorked) +
      ' worked in total';

    renderTiles(data);
    renderLeave(data);
  }

  async function loadMonth() {
    var query = '?month=' + state.month;
    if (state.viewingEmployee) query += '&employee=' + state.viewingEmployee;

    try {
      var data = await api.get('/attendance' + query);
      renderMonth(data);
    } catch (err) {
      if (err.status === 401) return;
      el('attendance-rows').innerHTML = '';
      el('log-error').classList.remove('hidden');
      el('log-error-text').textContent = err.message;
      el('log-summary').textContent = '—';
    }
  }

  // ------------------------------------------------------------ team picker

  async function setUpEmployeePicker() {
    if (state.user.role !== 'hr_admin' && state.user.role !== 'manager') return;

    var picker = el('employee-picker');
    try {
      var result = await api.get('/employees?limit=100');
      picker.innerHTML =
        '<option value="">My attendance</option>' +
        result.employees
          .map(function (employee) {
            return (
              '<option value="' +
              escapeHtml(employee.id) +
              '">' +
              escapeHtml(employee.fullName + ' · ' + employee.employeeCode) +
              '</option>'
            );
          })
          .join('');
      picker.classList.remove('hidden');

      picker.addEventListener('change', function (event) {
        state.viewingEmployee = event.target.value || null;
        loadMonth();
      });
    } catch (err) {
      /* the picker is a convenience; the page works without it */
    }
  }

  // --------------------------------------------------------------------- go

  async function init() {
    var user = await shell.mount('attendance');
    if (!user) return;
    state.user = user;
    state.month = thisMonth();

    el('clock-button').addEventListener('click', handleClock);
    window.addEventListener('online', function () {
      replayQueue().then(function () {
        return loadToday();
      }).then(function () {
        if (!state.viewingEmployee) return loadMonth();
      }).catch(function () { /* replay already toasted */ });
    });
    el('month-prev').addEventListener('click', function () {
      state.month = shiftMonth(state.month, -1);
      loadMonth();
    });
    el('month-next').addEventListener('click', function () {
      if (state.month >= thisMonth()) return;
      state.month = shiftMonth(state.month, 1);
      loadMonth();
    });

    window.setInterval(tick, 1000);
    tick();

    renderQueue();
    await replayQueue();
    await loadToday();
    await loadMonth();
    await setUpEmployeePicker();
  }

  init().catch(function (err) {
    if (err && err.status === 401) return;
    console.error('Attendance failed to initialise', err);
  });
})(window, document);
