/* Leave: balances, apply, my requests, team calendar, approval queue. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var shell = window.PortoHR.shell;

  var state = {
    user: null,
    meta: null,
    balances: [],
    mine: [],
    queue: [],
    canApprove: false,
    pendingCount: 0,
    tab: 'mine',
    month: currentMonth(),
    calendar: null,
  };

  var TONES = {
    pending: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    approved: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    rejected: 'bg-red-50 text-red-700 ring-red-600/20',
    cancelled: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  };

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function currentMonth() {
    var now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  }

  function shiftMonth(month, delta) {
    var parts = month.split('-').map(Number);
    var date = new Date(parts[0], parts[1] - 1 + delta, 1);
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
  }

  function formatDate(value) {
    if (!value) return '—';
    var date = new Date(value + (String(value).indexOf('T') === -1 ? 'T00:00:00' : ''));
    if (isNaN(date.getTime())) {
      date = new Date(value);
    }
    return isNaN(date.getTime())
      ? '—'
      : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function toast(message, tone) {
    var toneClass =
      tone === 'error'
        ? 'border-red-200 bg-red-50 text-red-800'
        : 'border-emerald-200 bg-emerald-50 text-emerald-800';
    var node = document.createElement('div');
    node.className = 'pointer-events-auto rounded-lg border px-4 py-2.5 text-sm shadow-lg ' + toneClass;
    node.textContent = message;
    el('toasts').appendChild(node);
    window.setTimeout(function () {
      node.remove();
    }, 3200);
  }

  function badge(status, label) {
    return (
      '<span class="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ' +
      (TONES[status] || TONES.pending) +
      '">' +
      escapeHtml(label || status) +
      '</span>'
    );
  }

  function setTab(tab) {
    state.tab = tab;
    ['mine', 'calendar', 'queue'].forEach(function (name) {
      var panel = el('tab-' + name);
      if (panel) panel.classList.toggle('hidden', name !== tab);
    });
    document.querySelectorAll('.tab-btn').forEach(function (button) {
      var active = button.getAttribute('data-tab') === tab;
      button.classList.toggle('border-[#2054C9]', active);
      button.classList.toggle('border-transparent', !active);
      button.classList.toggle('font-semibold', active);
      button.classList.toggle('text-slate-900', active);
      button.classList.toggle('text-slate-500', !active);
    });
    if (tab === 'calendar') loadCalendar();
  }

  function setApplyOpen(open) {
    el('apply-panel').classList.toggle('translate-x-full', !open);
    el('apply-backdrop').classList.toggle('hidden', !open);
  }

  function renderBalances() {
    var grid = el('balance-grid');
    if (!state.balances.length) {
      grid.innerHTML = '<p class="text-sm text-slate-500">Leave balances will appear here once your employment record is linked.</p>';
      return;
    }
    grid.innerHTML = state.balances
      .map(function (row) {
        var used = row.entitlementDays ? Math.min(100, (row.takenDays / row.entitlementDays) * 100) : 0;
        return (
          '<article class="rounded-xl border border-slate-200 bg-white p-4 shadow-card">' +
          '<p class="text-xs font-semibold uppercase tracking-wider text-slate-400">' +
          escapeHtml(row.label) +
          (row.paid ? '' : ' · unpaid') +
          '</p>' +
          '<p class="mt-2 text-3xl font-semibold tabular-nums text-slate-900">' +
          row.availableDays +
          '</p>' +
          '<p class="mt-1 text-xs text-slate-500">available of ' +
          row.entitlementDays +
          (row.carriedDays ? ' incl. ' + row.carriedDays + ' carried' : '') +
          '</p>' +
          '<div class="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">' +
          '<div class="h-full rounded-full bg-[#2054C9]" style="width:' +
          used +
          '%"></div></div>' +
          '<p class="mt-2 text-xs text-slate-500">' +
          row.takenDays +
          ' taken' +
          (row.pendingDays ? ' · ' + row.pendingDays + ' pending' : '') +
          '</p></article>'
        );
      })
      .join('');
  }

  function requestRow(row, actions) {
    return (
      '<tr class="border-t border-slate-100">' +
      '<td class="px-4 py-3 text-sm font-medium text-slate-900">' +
      escapeHtml(row.snapshot && row.snapshot.fullName ? row.snapshot.fullName : 'You') +
      '</td>' +
      '<td class="px-4 py-3 text-sm text-slate-600">' +
      escapeHtml(row.leaveTypeLabel) +
      '</td>' +
      '<td class="px-4 py-3 text-sm tabular-nums text-slate-600">' +
      formatDate(row.fromDate) +
      ' → ' +
      formatDate(row.toDate) +
      '</td>' +
      '<td class="px-4 py-3 text-sm tabular-nums text-slate-600">' +
      row.days +
      '</td>' +
      '<td class="px-4 py-3">' +
      badge(row.status, row.statusLabel) +
      '</td>' +
      '<td class="px-4 py-3 text-sm text-slate-500">' +
      escapeHtml(row.reason) +
      '</td>' +
      '<td class="px-4 py-3 text-right text-sm">' +
      actions +
      '</td></tr>'
    );
  }

  function renderMine() {
    var host = el('mine-list');
    if (!state.mine.length) {
      host.innerHTML = '<p class="px-5 py-10 text-center text-sm text-slate-500">You have not applied for leave yet.</p>';
      return;
    }
    host.innerHTML =
      '<table class="min-w-full text-left"><thead class="bg-slate-50 text-xs uppercase tracking-wider text-slate-400"><tr>' +
      '<th class="px-4 py-3 font-medium">Who</th><th class="px-4 py-3 font-medium">Type</th><th class="px-4 py-3 font-medium">Dates</th>' +
      '<th class="px-4 py-3 font-medium">Days</th><th class="px-4 py-3 font-medium">Status</th><th class="px-4 py-3 font-medium">Reason</th><th></th>' +
      '</tr></thead><tbody>' +
      state.mine
        .map(function (row) {
          var actions = '';
          if (row.status === 'pending' || row.status === 'approved') {
            actions =
              '<button type="button" data-cancel="' +
              row.id +
              '" class="text-xs font-medium text-slate-500 hover:text-red-600">Cancel</button>';
          }
          return requestRow(row, actions);
        })
        .join('') +
      '</tbody></table>';
  }

  function renderQueue() {
    var host = el('queue-list');
    var tab = el('queue-tab');
    var count = el('queue-count');
    if (tab) tab.classList.toggle('hidden', !state.canApprove);
    if (count) {
      count.textContent = String(state.pendingCount);
      count.classList.toggle('hidden', !state.pendingCount);
    }
    if (!state.canApprove) return;
    if (!state.queue.length) {
      host.innerHTML = '<p class="px-5 py-10 text-center text-sm text-slate-500">Nothing waiting for you.</p>';
      return;
    }
    host.innerHTML =
      '<table class="min-w-full text-left"><thead class="bg-slate-50 text-xs uppercase tracking-wider text-slate-400"><tr>' +
      '<th class="px-4 py-3 font-medium">Employee</th><th class="px-4 py-3 font-medium">Type</th><th class="px-4 py-3 font-medium">Dates</th>' +
      '<th class="px-4 py-3 font-medium">Days</th><th class="px-4 py-3 font-medium">Reason</th><th></th>' +
      '</tr></thead><tbody>' +
      state.queue
        .map(function (row) {
          var actions =
            '<div class="flex justify-end gap-2">' +
            '<button type="button" data-decide="' +
            row.id +
            '" data-status="approved" class="rounded-lg bg-[#2054C9] px-3 py-1.5 text-xs font-semibold text-white">Approve</button>' +
            '<button type="button" data-decide="' +
            row.id +
            '" data-status="rejected" class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium">Reject</button>' +
            '</div>';
          return requestRow(row, actions);
        })
        .join('') +
      '</tbody></table>';
  }

  function renderCalendar() {
    var host = el('calendar-board');
    var label = el('cal-label');
    var data = state.calendar;
    if (!data) {
      host.innerHTML = '<p class="px-5 py-10 text-center text-sm text-slate-500">Loading calendar…</p>';
      return;
    }
    var parts = state.month.split('-').map(Number);
    label.textContent = new Date(parts[0], parts[1] - 1, 1).toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
    });

    var holidays = (data.holidays || [])
      .map(function (row) {
        return (
          '<span class="mr-2 inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">' +
          escapeHtml(row.date.slice(8)) +
          ' ' +
          escapeHtml(row.name) +
          '</span>'
        );
      })
      .join('');

    var people = (data.people || [])
      .map(function (person) {
        var chips = (person.requests || [])
          .map(function (row) {
            return (
              '<span class="mr-2 mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ' +
              (TONES[row.status] || TONES.pending) +
              '">' +
              escapeHtml(row.leaveTypeLabel) +
              ' · ' +
              escapeHtml(row.fromDate) +
              (row.fromDate === row.toDate ? '' : ' → ' + escapeHtml(row.toDate)) +
              '</span>'
            );
          })
          .join('');
        return (
          '<div class="flex flex-wrap items-start justify-between gap-3 border-t border-slate-100 px-5 py-4">' +
          '<div><p class="text-sm font-medium text-slate-900">' +
          escapeHtml(person.fullName) +
          '</p><p class="text-xs text-slate-500">' +
          escapeHtml(person.designation || '') +
          (person.department ? ' · ' + escapeHtml(person.department) : '') +
          '</p></div>' +
          '<div class="flex max-w-xl flex-wrap justify-end">' +
          (chips || '<span class="text-xs text-slate-400">No leave this month</span>') +
          '</div></div>'
        );
      })
      .join('');

    host.innerHTML =
      '<div class="border-b border-slate-100 px-5 py-3 text-xs text-slate-500">' +
      (holidays || 'No public holidays this month.') +
      '</div>' +
      people;
  }

  function fillForm() {
    var types = (state.meta && state.meta.types) || [];
    var half = (state.meta && state.meta.halfDays) || [];
    el('leaveType').innerHTML = types
      .map(function (type) {
        return '<option value="' + type.value + '">' + escapeHtml(type.label) + '</option>';
      })
      .join('');
    el('halfDay').innerHTML = half
      .map(function (item) {
        return '<option value="' + item.value + '">' + escapeHtml(item.label) + '</option>';
      })
      .join('');
    onTypeChange();
  }

  function onTypeChange() {
    var code = el('leaveType').value;
    var match = ((state.meta && state.meta.types) || []).filter(function (type) {
      return type.value === code;
    })[0];
    var balance = state.balances.filter(function (row) {
      return row.code === code;
    })[0];
    el('leaveType-hint').textContent = match
      ? match.hint + (balance ? ' · ' + balance.availableDays + ' day(s) remaining.' : '')
      : '';
  }

  async function loadLists() {
    var [balances, mine, queue] = await Promise.all([
      api.get('/leave/balances'),
      api.get('/leave?scope=mine'),
      api.get('/leave?scope=queue'),
    ]);
    state.balances = balances.balances || [];
    state.mine = mine.requests || [];
    state.queue = queue.requests || [];
    state.canApprove = Boolean(queue.canApprove);
    state.pendingCount = queue.pendingCount || 0;
    renderBalances();
    renderMine();
    renderQueue();
  }

  async function loadCalendar() {
    var payload = await api.get('/leave/calendar?month=' + encodeURIComponent(state.month));
    state.calendar = payload;
    renderCalendar();
  }

  async function submitApply(event) {
    event.preventDefault();
    var error = el('apply-error');
    error.classList.add('hidden');
    try {
      var payload = await api.post('/leave', {
        leaveType: el('leaveType').value,
        fromDate: el('fromDate').value,
        toDate: el('toDate').value,
        halfDay: el('halfDay').value,
        reason: el('reason').value,
      });
      toast(payload.message || 'Leave submitted');
      el('apply-form').reset();
      setApplyOpen(false);
      await loadLists();
      if (shell.refreshApprovals) shell.refreshApprovals();
    } catch (err) {
      error.textContent = err.message || 'Could not submit';
      error.classList.remove('hidden');
    }
  }

  async function cancelRequest(id) {
    if (!window.confirm('Cancel this leave request?')) return;
    try {
      await api.post('/leave/' + id + '/cancel');
      toast('Leave cancelled');
      await loadLists();
      if (state.tab === 'calendar') await loadCalendar();
      if (shell.refreshApprovals) shell.refreshApprovals();
    } catch (err) {
      toast(err.message || 'Could not cancel', 'error');
    }
  }

  async function decideRequest(id, status) {
    var note = '';
    if (status === 'rejected') {
      note = window.prompt('Reason for rejecting this leave?') || '';
      if (!note.trim()) return;
    }
    try {
      var payload = await api.request('/leave/' + id + '/status', {
        method: 'PATCH',
        body: { status: status, decisionNote: note },
      });
      toast(payload.message || 'Updated');
      await loadLists();
      if (state.tab === 'calendar') await loadCalendar();
      if (shell.refreshApprovals) shell.refreshApprovals();
    } catch (err) {
      toast(err.message || 'Could not decide', 'error');
    }
  }

  function wire() {
    el('apply-open').addEventListener('click', function () { setApplyOpen(true); });
    el('apply-close').addEventListener('click', function () { setApplyOpen(false); });
    el('apply-backdrop').addEventListener('click', function () { setApplyOpen(false); });
    el('apply-form').addEventListener('submit', submitApply);
    el('leaveType').addEventListener('change', onTypeChange);
    el('leave-tabs').addEventListener('click', function (event) {
      var button = event.target.closest('[data-tab]');
      if (button) setTab(button.getAttribute('data-tab'));
    });
    el('mine-list').addEventListener('click', function (event) {
      var cancel = event.target.closest('[data-cancel]');
      if (cancel) cancelRequest(cancel.getAttribute('data-cancel'));
    });
    el('queue-list').addEventListener('click', function (event) {
      var decide = event.target.closest('[data-decide]');
      if (decide) decideRequest(decide.getAttribute('data-decide'), decide.getAttribute('data-status'));
    });
    el('cal-prev').addEventListener('click', function () {
      state.month = shiftMonth(state.month, -1);
      loadCalendar().catch(function (err) { toast(err.message, 'error'); });
    });
    el('cal-next').addEventListener('click', function () {
      state.month = shiftMonth(state.month, 1);
      loadCalendar().catch(function (err) { toast(err.message, 'error'); });
    });
  }

  async function init() {
    var user = await shell.mount('leave');
    if (!user) return;
    state.user = user;
    wire();
    state.meta = (await api.get('/leave/meta')).meta;
    fillForm();
    await loadLists();
  }

  init().catch(function (err) {
    if (err && err.status === 401) return;
    console.error('Leave failed to initialise', err);
  });
})(window, document);
