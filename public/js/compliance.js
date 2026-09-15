/* Compliance: calendar, licences, policy acknowledgements, audit export. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var shell = window.PortoHR.shell;

  var TONES = {
    overdue: 'bg-red-50 text-red-700 ring-red-600/20',
    due: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    upcoming: 'bg-sky-50 text-sky-700 ring-sky-600/20',
    filed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    expired: 'bg-red-50 text-red-700 ring-red-600/20',
    revoked: 'bg-slate-100 text-slate-500 ring-slate-400/20',
    published: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    draft: 'bg-slate-100 text-slate-500 ring-slate-400/20',
  };

  var state = {
    user: null,
    meta: null,
    tab: 'calendar',
    calendar: { events: [], summary: {} },
    licenses: [],
    policies: [],
    filings: [],
    acks: [],
    retention: [],
    people: [],
    mine: { policies: [], licenses: [], schemes: [] },
  };

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function isHr() {
    return state.user && state.user.role === 'hr_admin';
  }

  function canStaff() {
    return state.user && state.user.role !== 'employee';
  }

  function toast(message, tone) {
    var node = document.createElement('div');
    node.className =
      'pointer-events-auto rounded-lg border px-4 py-2.5 text-sm shadow-lg ' +
      (tone === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800');
    node.textContent = message;
    el('toasts').appendChild(node);
    window.setTimeout(function () { node.remove(); }, 3200);
  }

  function badge(status, label) {
    return (
      '<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ' +
      (TONES[status] || TONES.upcoming) +
      '">' +
      escapeHtml(label || status) +
      '</span>'
    );
  }

  function setTab(tab) {
    state.tab = tab;
    ['calendar', 'licenses', 'policies', 'filings', 'audit'].forEach(function (name) {
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
  }

  function setPanel(open) {
    el('side-panel').classList.toggle('translate-x-full', !open);
    el('panel-backdrop').classList.toggle('hidden', !open);
  }

  function openPanel(title, sub, html) {
    el('panel-title').textContent = title;
    el('panel-sub').textContent = sub || '';
    el('panel-body').innerHTML = html;
    setPanel(true);
  }

  function options(list) {
    return (list || [])
      .map(function (row) {
        return '<option value="' + escapeHtml(row.value) + '">' + escapeHtml(row.label) + '</option>';
      })
      .join('');
  }

  function renderSummary() {
    var summary = state.calendar.summary || {};
    var outstanding = (state.mine.policies || []).filter(function (row) {
      return row.requiresAck && !row.acknowledged;
    }).length;
    el('comp-summary').innerHTML =
      '<div class="rounded-xl border border-slate-200 bg-white p-4 shadow-card"><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Overdue</p><p class="mt-1 text-2xl font-semibold">' +
      (summary.overdue || 0) +
      '</p></div>' +
      '<div class="rounded-xl border border-slate-200 bg-white p-4 shadow-card"><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Due in 45 days</p><p class="mt-1 text-2xl font-semibold">' +
      (summary.dueSoon || 0) +
      '</p></div>' +
      '<div class="rounded-xl border border-slate-200 bg-white p-4 shadow-card"><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Policies to acknowledge</p><p class="mt-1 text-2xl font-semibold">' +
      outstanding +
      '</p></div>';
  }

  function renderCalendar() {
    var host = el('calendar-list');
    var rows = state.calendar.events || [];
    if (!rows.length) {
      host.innerHTML = '<p class="text-sm text-slate-500">Nothing on the compliance calendar in this window.</p>';
      return;
    }
    host.innerHTML =
      '<ul class="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">' +
      rows.map(function (row) {
        return (
          '<li class="flex flex-wrap items-center justify-between gap-3 px-5 py-3">' +
          '<div><p class="text-sm font-medium">' +
          escapeHtml(row.title) +
          '</p><p class="text-xs text-slate-400">' +
          escapeHtml(row.kind) +
          (row.holder ? ' · ' + escapeHtml(row.holder) : '') +
          (row.detail ? ' · ' + escapeHtml(row.detail) : '') +
          '</p></div><div class="flex items-center gap-3">' +
          '<span class="text-xs tabular-nums text-slate-500">' +
          escapeHtml(row.dueOn) +
          '</span>' +
          badge(row.status, row.statusLabel) +
          '</div></li>'
        );
      }).join('') +
      '</ul>';
  }

  function renderLicenses() {
    var host = el('license-list');
    var rows = state.licenses || [];
    if (!rows.length) {
      host.innerHTML = '<p class="text-sm text-slate-500">No licences in scope.</p>';
      return;
    }
    host.innerHTML =
      '<div class="grid gap-4 md:grid-cols-2">' +
      rows.map(function (row) {
        var action = isHr() && row.status !== 'revoked'
          ? '<button type="button" data-revoke="' + row.id + '" class="mt-3 text-xs font-semibold text-red-600">Revoke</button>'
          : '';
        return (
          '<article class="rounded-xl border border-slate-200 bg-white p-4 shadow-card">' +
          '<div class="flex items-start justify-between gap-2"><p class="text-sm font-semibold">' +
          escapeHtml(row.name) +
          '</p>' +
          badge(row.status, row.statusLabel) +
          '</div><p class="mt-1 text-xs text-slate-500">' +
          escapeHtml(row.kindLabel) +
          ' · ' +
          escapeHtml(row.holder) +
          '</p><p class="mt-3 text-sm text-slate-600">Expires ' +
          escapeHtml(row.expiresOn || '—') +
          (row.reference ? ' · ' + escapeHtml(row.reference) : '') +
          '</p>' +
          action +
          '</article>'
        );
      }).join('') +
      '</div>';
  }

  function renderPolicies() {
    var host = el('policy-list');
    var rows = state.policies || [];
    if (!rows.length) {
      host.innerHTML = '<p class="text-sm text-slate-500">No published policies.</p>';
      return;
    }
    host.innerHTML =
      '<div class="space-y-4">' +
      rows.map(function (row) {
        var action = '';
        if (row.status === 'published' && row.requiresAck && !row.acknowledged) {
          action = '<button type="button" data-ack="' + row.id + '" class="mt-3 rounded-lg bg-[#2054C9] px-3 py-2 text-xs font-semibold text-white">Acknowledge</button>';
        } else if (row.acknowledged) {
          action = '<p class="mt-3 text-xs text-emerald-700">Acknowledged</p>';
        }
        if (isHr() && row.status === 'draft') {
          action += '<button type="button" data-publish="' + row.id + '" class="mt-3 ml-2 text-xs font-semibold text-[#2054C9]">Publish</button>';
        }
        return (
          '<article class="rounded-xl border border-slate-200 bg-white p-5 shadow-card">' +
          '<div class="flex items-start justify-between gap-2"><div><p class="text-sm font-semibold">' +
          escapeHtml(row.title) +
          '</p><p class="text-xs text-slate-400">' +
          escapeHtml(row.code) +
          ' · v' +
          row.version +
          (row.dueOn ? ' · acknowledge by ' + escapeHtml(row.dueOn) : '') +
          '</p></div>' +
          badge(row.status, row.statusLabel) +
          '</div><p class="mt-3 text-sm text-slate-600">' +
          escapeHtml(row.summary || row.body || '') +
          '</p>' +
          action +
          '</article>'
        );
      }).join('') +
      '</div>';
  }

  function renderFilings() {
    var host = el('filing-list');
    var rows = state.filings || [];
    if (!rows.length) {
      host.innerHTML = '<p class="text-sm text-slate-500">No filings on the country pack yet.</p>';
      return;
    }
    host.innerHTML =
      '<ul class="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">' +
      rows.map(function (row) {
        var action = isHr() && row.status !== 'filed'
          ? '<button type="button" data-file="' + row.id + '" class="text-xs font-semibold text-[#2054C9]">Mark filed</button>'
          : '';
        return (
          '<li class="flex flex-wrap items-center justify-between gap-3 px-5 py-3">' +
          '<div><p class="text-sm font-medium">' +
          escapeHtml(row.ruleName) +
          '</p><p class="text-xs text-slate-400">' +
          escapeHtml(row.periodLabel || '') +
          (row.authority ? ' · ' + escapeHtml(row.authority) : '') +
          '</p></div><div class="flex items-center gap-3">' +
          '<span class="text-xs tabular-nums text-slate-500">' +
          escapeHtml(row.dueOn) +
          '</span>' +
          badge(row.status, row.statusLabel) +
          action +
          '</div></li>'
        );
      }).join('') +
      '</ul>';
  }

  function renderAudit() {
    var ackHost = el('ack-board');
    var rows = state.acks || [];
    ackHost.innerHTML =
      '<h3 class="text-sm font-semibold text-slate-900">Policy acknowledgement</h3>' +
      (rows.length
        ? '<ul class="mt-3 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">' +
          rows.map(function (row) {
            return (
              '<li class="px-5 py-3"><div class="flex items-center justify-between gap-3"><p class="text-sm font-medium">' +
              escapeHtml(row.title) +
              '</p><p class="text-xs text-slate-500">' +
              row.acknowledged +
              ' / ' +
              row.headcount +
              '</p></div>' +
              (row.outstandingCount
                ? '<p class="mt-1 text-xs text-amber-700">' +
                  row.outstandingCount +
                  ' outstanding' +
                  (row.outstanding && row.outstanding[0] ? ' · ' + escapeHtml(row.outstanding[0].fullName) : '') +
                  '</p>'
                : '<p class="mt-1 text-xs text-emerald-700">Everyone in scope has acknowledged.</p>') +
              '</li>'
            );
          }).join('') +
          '</ul>'
        : '<p class="mt-2 text-sm text-slate-500">No published policies require acknowledgement.</p>');

    var retHost = el('retention-list');
    var retention = state.retention || [];
    retHost.innerHTML =
      '<h3 class="text-sm font-semibold text-slate-900">Retention rules</h3>' +
      '<p class="mt-1 text-xs text-slate-500">Policy only — archival jobs are not run in this release.</p>' +
      (retention.length
        ? '<ul class="mt-3 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">' +
          retention.map(function (row) {
            return (
              '<li class="flex items-center justify-between gap-3 px-5 py-3 text-sm"><span>' +
              escapeHtml(row.categoryLabel) +
              '</span><span class="text-slate-500">' +
              row.years +
              ' years · ' +
              escapeHtml(row.actionLabel) +
              '</span></li>'
            );
          }).join('') +
          '</ul>'
        : '<p class="mt-2 text-sm text-slate-500">No retention rules yet.</p>');
  }

  function licenseForm() {
    var kinds = options((state.meta && state.meta.licenseKinds) || []);
    var people = (state.people || [])
      .map(function (row) {
        return '<option value="' + row.id + '">' + escapeHtml(row.fullName) + ' · ' + escapeHtml(row.employeeCode) + '</option>';
      })
      .join('');
    return (
      '<form id="license-form" class="space-y-3">' +
      '<input name="name" required minlength="3" placeholder="Licence name" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<select name="kind" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">' + kinds + '</select>' +
      '<select name="employee" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">Company licence</option>' + people + '</select>' +
      '<input name="issuer" placeholder="Issuer" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<input name="reference" placeholder="Reference / number" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<label class="block text-xs font-medium text-slate-500">Expires on</label>' +
      '<input name="expiresOn" type="date" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<button type="submit" class="w-full rounded-lg bg-[#2054C9] py-2.5 text-sm font-semibold text-white">Save licence</button></form>'
    );
  }

  function policyForm() {
    return (
      '<form id="policy-form" class="space-y-3">' +
      '<input name="title" required minlength="3" placeholder="Policy title" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<textarea name="summary" rows="2" placeholder="Summary" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"></textarea>' +
      '<textarea name="body" rows="6" placeholder="Policy text" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"></textarea>' +
      '<input name="dueWithinDays" type="number" min="1" max="90" value="14" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<label class="flex items-center gap-2 text-sm"><input name="publish" type="checkbox" checked /> Publish now</label>' +
      '<button type="submit" class="w-full rounded-lg bg-[#2054C9] py-2.5 text-sm font-semibold text-white">Save policy</button></form>'
    );
  }

  async function loadAll() {
    state.meta = (await api.get('/compliance/meta')).meta;
    state.calendar = await api.get('/compliance/calendar');
    state.licenses = (await api.get('/compliance/licenses')).licenses || [];
    state.policies = (await api.get('/compliance/policies')).policies || [];
    state.mine = await api.get('/compliance/me');
    if (canStaff()) {
      state.filings = (await api.get('/compliance/filings')).filings || [];
      state.acks = (await api.get('/compliance/acknowledgements')).policies || [];
    }
    if (isHr()) {
      state.retention = (await api.get('/compliance/retention')).rules || [];
      state.people = (await api.get('/compliance/people')).people || [];
    }
    renderSummary();
    renderCalendar();
    renderLicenses();
    renderPolicies();
    if (canStaff()) renderFilings();
    if (isHr()) renderAudit();
  }

  function wire() {
    el('open-license').classList.toggle('hidden', !isHr());
    el('open-policy').classList.toggle('hidden', !isHr());
    el('export-file').classList.toggle('hidden', !isHr());
    document.querySelector('[data-tab="filings"]').classList.toggle('hidden', !canStaff());
    document.querySelector('[data-tab="audit"]').classList.toggle('hidden', !isHr());

    el('comp-tabs').addEventListener('click', function (event) {
      var button = event.target.closest('[data-tab]');
      if (button) setTab(button.getAttribute('data-tab'));
    });
    el('open-license').addEventListener('click', function () {
      openPanel('New licence', 'Company permits or an employee work visa / professional licence.', licenseForm());
    });
    el('open-policy').addEventListener('click', function () {
      openPanel('New policy', 'Published policies appear on My tasks for acknowledgement.', policyForm());
    });
    el('export-file').addEventListener('click', function () {
      api.get('/compliance/export').then(function (payload) {
        var blob = new window.Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        var url = window.URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = 'portohr-compliance-audit.json';
        link.click();
        window.URL.revokeObjectURL(url);
        toast('Audit export downloaded');
      }).catch(function (err) { toast(err.message, 'error'); });
    });
    el('panel-close').addEventListener('click', function () { setPanel(false); });
    el('panel-backdrop').addEventListener('click', function () { setPanel(false); });

    el('panel-body').addEventListener('submit', function (event) {
      var form = event.target;
      if (form.id === 'license-form') {
        event.preventDefault();
        var data = Object.fromEntries(new FormData(form).entries());
        if (!data.employee) delete data.employee;
        api.post('/compliance/licenses', data).then(function (payload) {
          toast(payload.message);
          setPanel(false);
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
      if (form.id === 'policy-form') {
        event.preventDefault();
        var policy = Object.fromEntries(new FormData(form).entries());
        policy.publish = Boolean(form.publish && form.publish.checked);
        api.post('/compliance/policies', policy).then(function (payload) {
          toast(payload.message);
          setPanel(false);
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
    });

    document.body.addEventListener('click', function (event) {
      var ack = event.target.closest('[data-ack]');
      var publish = event.target.closest('[data-publish]');
      var fileBtn = event.target.closest('[data-file]');
      var revoke = event.target.closest('[data-revoke]');
      if (ack) {
        api.post('/compliance/policies/' + ack.getAttribute('data-ack') + '/acknowledge', {}).then(function (payload) {
          toast(payload.message);
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
      if (publish) {
        api.post('/compliance/policies/' + publish.getAttribute('data-publish') + '/publish', {}).then(function (payload) {
          toast(payload.message);
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
      if (fileBtn) {
        var reference = window.prompt('Filing reference?') || '';
        api.post('/compliance/filings/' + fileBtn.getAttribute('data-file') + '/file', { reference: reference }).then(function (payload) {
          toast(payload.message);
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
      if (revoke) {
        if (!window.confirm('Revoke this licence?')) return;
        api.post('/compliance/licenses/' + revoke.getAttribute('data-revoke') + '/revoke', {}).then(function (payload) {
          toast(payload.message);
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
    });
  }

  async function init() {
    var user = await shell.mount('compliance');
    if (!user) return;
    state.user = user;
    wire();
    await loadAll();
    setTab(state.tab);
  }

  init().catch(function (err) {
    if (err && err.status === 401) return;
    console.error('Compliance failed to initialise', err);
  });
})(window, document);
