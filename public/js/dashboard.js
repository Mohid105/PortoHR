/* Dashboard: ESS/MSS widgets plus a card per module the current role can reach. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var shell = window.PortoHR.shell;

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function renderModuleCards(user) {
    var container = document.getElementById('module-cards');
    if (!container) return;

    var cards = shell.NAV_ITEMS.filter(function (item) {
      return item.key && (user.modules || []).indexOf(item.key) !== -1;
    });

    container.innerHTML = cards
      .map(function (item) {
        return (
          '<a href="' +
          item.href +
          '" class="group rounded-xl border border-slate-200 bg-white p-5 shadow-card transition hover:border-slate-300 hover:shadow-md">' +
          '<div class="flex items-start justify-between">' +
          '<span class="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700 group-hover:bg-[#2054C9] group-hover:text-white">' +
          '<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor">' +
          item.icon +
          '</svg></span>' +
          (item.ready
            ? '<span class="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">Available</span>'
            : '<span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Not set up</span>') +
          '</div>' +
          '<h3 class="mt-4 text-sm font-semibold text-slate-900">' +
          item.label +
          '</h3>' +
          '<p class="mt-1 text-sm text-slate-500">' +
          (item.blurb || 'Module scaffolded — no features implemented yet.') +
          '</p></a>'
        );
      })
      .join('');
  }

  function renderEss(leavePayload, approvalsPayload, learningPayload) {
    var host = document.getElementById('ess-widgets');
    if (!host) return;

    var annual = ((leavePayload && leavePayload.balances) || []).filter(function (row) {
      return row.code === 'annual';
    })[0];
    var pending = (approvalsPayload && approvalsPayload.items) || [];
    var overdue = (learningPayload && learningPayload.overdueCount) || 0;
    var openLearning = ((learningPayload && learningPayload.enrollments) || []).filter(function (row) {
      return row.status === 'enrolled' || row.status === 'pending';
    }).length;

    var leaveHtml = annual
      ? '<p class="text-3xl font-semibold tabular-nums text-slate-900">' +
        annual.availableDays +
        '</p><p class="mt-1 text-sm text-slate-500">' +
        annual.takenDays +
        ' taken · ' +
        annual.pendingDays +
        ' pending of ' +
        annual.entitlementDays +
        ' days</p>'
      : '<p class="text-sm text-slate-500">Link your login to an employee record to see balances.</p>';

    var approvalHtml = pending.length
      ? pending
          .slice(0, 4)
          .map(function (item) {
            return (
              '<li class="flex items-start justify-between gap-3 py-2 text-sm">' +
              '<span class="text-slate-700">' +
              escapeHtml(item.title) +
              '</span>' +
              '<a class="shrink-0 text-xs font-medium text-[#2054C9]" href="' +
              escapeHtml(item.href) +
              '">Review</a></li>'
            );
          })
          .join('')
      : '<li class="py-2 text-sm text-slate-500">Nothing waiting for you.</li>';

    host.innerHTML =
      '<a href="/leave.html" class="rounded-xl border border-slate-200 bg-white p-5 shadow-card transition hover:border-slate-300">' +
      '<p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Annual leave</p>' +
      leaveHtml +
      '<p class="mt-3 text-xs font-medium text-[#2054C9]">Apply or view history →</p></a>' +
      '<div class="rounded-xl border border-slate-200 bg-white p-5 shadow-card">' +
      '<div class="flex items-center justify-between">' +
      '<p class="text-xs font-semibold uppercase tracking-wider text-slate-400">My approvals</p>' +
      '<span class="text-xs font-semibold text-slate-500">' +
      pending.length +
      '</span></div>' +
      '<ul class="mt-2 divide-y divide-slate-100">' +
      approvalHtml +
      '</ul></div>' +
      '<a href="/lms.html" class="rounded-xl border border-slate-200 bg-white p-5 shadow-card transition hover:border-slate-300">' +
      '<p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Learning</p>' +
      '<p class="text-3xl font-semibold tabular-nums text-slate-900">' +
      overdue +
      '</p><p class="mt-1 text-sm text-slate-500">' +
      openLearning +
      ' open · overdue mandatory courses</p>' +
      '<p class="mt-3 text-xs font-medium text-[#2054C9]">Open my learning →</p></a>';
  }

  async function init() {
    var user = await shell.mount('dashboard');
    if (!user) return;

    var greeting = document.getElementById('greeting-name');
    if (greeting) greeting.textContent = user.fullName.split(' ')[0];

    renderModuleCards(user);

    var status = document.getElementById('api-status');
    try {
      var health = await api.get('/health');
      if (status) status.textContent = 'API online · DB ' + health.database;
    } catch (err) {
      if (status) status.textContent = 'API unreachable';
    }

    try {
      var [leavePayload, approvalsPayload, learningPayload] = await Promise.all([
        api.get('/leave/balances'),
        api.get('/approvals'),
        api.get('/lms/me'),
      ]);
      renderEss(leavePayload, approvalsPayload, learningPayload);
    } catch (err) {
      renderEss(null, { items: [] }, { enrollments: [], overdueCount: 0 });
    }
  }

  init().catch(function (err) {
    if (err && err.status === 401) return;
    console.error('Dashboard failed to initialise', err);
  });
})(window, document);
