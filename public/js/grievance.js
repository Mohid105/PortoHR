/* Employee relations: confidential cases, HR register, anonymized analytics. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var shell = window.PortoHR.shell;

  var TONES = {
    intake: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    investigation: 'bg-sky-50 text-sky-700 ring-sky-600/20',
    hearing: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
    decision: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    appeal: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    closed: 'bg-slate-100 text-slate-500 ring-slate-400/20',
    rejected: 'bg-red-50 text-red-700 ring-red-600/20',
  };

  var state = {
    user: null,
    meta: null,
    tab: 'mine',
    cases: [],
    analytics: null,
    people: [],
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
      (TONES[status] || TONES.intake) +
      '">' +
      escapeHtml(label || status) +
      '</span>'
    );
  }

  function setTab(tab) {
    state.tab = tab;
    ['mine', 'register', 'analytics'].forEach(function (name) {
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

  function myCases() {
    if (isHr()) return state.cases;
    return (state.cases || []).filter(function (row) {
      return row.access === 'party';
    });
  }

  function renderList(hostId, rows, empty) {
    var host = el(hostId);
    if (!rows.length) {
      host.innerHTML = '<p class="text-sm text-slate-500">' + empty + '</p>';
      return;
    }
    host.innerHTML =
      '<ul class="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">' +
      rows.map(function (row) {
        return (
          '<li><button type="button" data-open="' +
          row.id +
          '" class="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-slate-50">' +
          '<div><p class="text-sm font-medium">' +
          escapeHtml(row.code) +
          ' · ' +
          escapeHtml(row.summary) +
          '</p><p class="text-xs text-slate-400">' +
          escapeHtml(row.typeLabel) +
          (isHr() && row.holder ? ' · ' + escapeHtml(row.holder) : '') +
          ' · ' +
          escapeHtml(row.openedOn) +
          '</p></div>' +
          badge(row.status, row.statusLabel) +
          '</button></li>'
        );
      }).join('') +
      '</ul>';
  }

  function renderAnalytics() {
    var host = el('analytics-board');
    var data = state.analytics || { total: 0, open: 0, closed: 0, byType: [], byStatus: [], byDepartment: [] };
    function chips(items, labelKey) {
      if (!items.length) return '<p class="text-sm text-slate-500">No cases yet.</p>';
      return (
        '<ul class="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">' +
        items.map(function (row) {
          return (
            '<li class="flex items-center justify-between px-4 py-2.5 text-sm"><span>' +
            escapeHtml(row[labelKey] || row.label || row.key) +
            '</span><span class="tabular-nums text-slate-500">' +
            row.count +
            '</span></li>'
          );
        }).join('') +
        '</ul>'
      );
    }
    host.innerHTML =
      '<p class="text-xs text-slate-500">Counts only — no names, and not visible to managers.</p>' +
      '<div class="mt-4 grid gap-4 sm:grid-cols-3">' +
      '<div class="rounded-xl border border-slate-200 bg-white p-4 shadow-card"><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Open</p><p class="mt-1 text-2xl font-semibold">' +
      data.open +
      '</p></div>' +
      '<div class="rounded-xl border border-slate-200 bg-white p-4 shadow-card"><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Closed</p><p class="mt-1 text-2xl font-semibold">' +
      data.closed +
      '</p></div>' +
      '<div class="rounded-xl border border-slate-200 bg-white p-4 shadow-card"><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Total</p><p class="mt-1 text-2xl font-semibold">' +
      data.total +
      '</p></div></div>' +
      '<h3 class="mt-8 text-sm font-semibold">By type</h3>' +
      chips(data.byType, 'label') +
      '<h3 class="mt-8 text-sm font-semibold">By department</h3>' +
      chips(data.byDepartment, 'department');
  }

  function caseForm() {
    var types = options((state.meta && state.meta.types) || []);
    var people = (state.people || [])
      .map(function (row) {
        return '<option value="' + row.id + '">' + escapeHtml(row.fullName) + ' · ' + escapeHtml(row.employeeCode) + '</option>';
      })
      .join('');
    return (
      '<form id="case-form" class="space-y-3">' +
      '<select name="type" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">' + types + '</select>' +
      (isHr()
        ? '<label class="block text-xs font-medium text-slate-500">Subject</label><select name="subject" required class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">' + people + '</select>'
        : '<label class="block text-xs font-medium text-slate-500">About (optional — leave blank for yourself)</label><select name="subject" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">Myself</option>' + people + '</select>') +
      '<input name="summary" required minlength="8" placeholder="Short summary" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<textarea name="description" rows="5" placeholder="What happened?" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"></textarea>' +
      '<button type="submit" class="w-full rounded-lg bg-[#2054C9] py-2.5 text-sm font-semibold text-white">Submit case</button></form>'
    );
  }

  function actionForms(row) {
    if (row.access === 'party' && row.status === 'decision') {
      return (
        '<form id="appeal-form" data-id="' + row.id + '" class="mt-4 space-y-2">' +
        '<textarea name="reason" required minlength="8" placeholder="Appeal reason" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"></textarea>' +
        '<button type="submit" class="w-full rounded-lg border border-slate-200 py-2 text-sm font-semibold">Submit appeal</button></form>'
      );
    }
    if (!isHr()) return '';
    var html = '';
    if (row.status === 'intake') {
      html +=
        '<form id="triage-form" data-id="' + row.id + '" class="mt-4 space-y-2">' +
        '<textarea name="note" rows="2" placeholder="Triage note" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"></textarea>' +
        '<div class="flex gap-2"><button type="submit" class="flex-1 rounded-lg bg-[#2054C9] py-2 text-sm font-semibold text-white">Open investigation</button>' +
        '<button type="button" data-reject="' + row.id + '" class="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700">Reject</button></div></form>';
    }
    if (row.status === 'investigation' || row.status === 'hearing' || row.status === 'appeal') {
      html +=
        '<form id="note-form" data-id="' + row.id + '" class="mt-4 space-y-2">' +
        '<textarea name="body" required minlength="4" placeholder="Investigation note (HR only)" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"></textarea>' +
        '<button type="submit" class="w-full rounded-lg border border-slate-200 py-2 text-sm font-semibold">Add note</button></form>';
    }
    if (row.status === 'investigation') {
      html +=
        '<form id="hearing-form" data-id="' + row.id + '" class="mt-4 space-y-2">' +
        '<input name="scheduledOn" type="date" required class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
        '<input name="location" placeholder="Location" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
        '<button type="submit" class="w-full rounded-lg border border-slate-200 py-2 text-sm font-semibold">Schedule hearing</button></form>';
    }
    if (row.status === 'investigation' || row.status === 'hearing' || row.status === 'appeal') {
      var actions = options((state.meta && state.meta.actionTypes) || []);
      var outcomes = options((state.meta && state.meta.outcomes) || []);
      html +=
        '<form id="decision-form" data-id="' + row.id + '" class="mt-4 space-y-2">' +
        '<select name="outcome" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">' + outcomes + '</select>' +
        '<select name="actionType" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">' + actions + '</select>' +
        '<textarea name="note" required placeholder="Decision note (visible to parties)" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"></textarea>' +
        '<button type="submit" class="w-full rounded-lg bg-[#2054C9] py-2 text-sm font-semibold text-white">Record decision</button></form>';
    }
    if (row.status === 'decision' || row.status === 'investigation' || row.status === 'hearing' || row.status === 'appeal') {
      html += '<button type="button" data-close="' + row.id + '" class="mt-4 w-full rounded-lg border border-slate-200 py-2 text-sm font-semibold">Close case</button>';
    }
    return html;
  }

  function renderDetail(row) {
    var notes = (row.investigationNotes || [])
      .map(function (item) {
        return '<p class="text-sm text-slate-600"><span class="text-xs text-slate-400">' + escapeHtml(item.authorName) + '</span><br />' + escapeHtml(item.body) + '</p>';
      })
      .join('');
    var timeline = (row.timeline || [])
      .map(function (item) {
        return (
          '<li class="text-sm"><span class="text-xs text-slate-400">' +
          escapeHtml(String(item.at).slice(0, 10)) +
          ' · ' +
          escapeHtml(item.action) +
          '</span><br />' +
          escapeHtml(item.note || item.actorName) +
          '</li>'
        );
      })
      .join('');
    var html =
      '<p class="text-sm text-slate-600">' +
      escapeHtml(row.description || '') +
      '</p>' +
      (row.decision && row.decision.note
        ? '<p class="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm"><span class="text-xs font-semibold uppercase text-slate-400">Decision</span><br />' +
          escapeHtml(row.decision.actionLabel || '') +
          ' — ' +
          escapeHtml(row.decision.note) +
          (row.decision.coreHrNote ? '<br /><span class="text-xs text-amber-700">' + escapeHtml(row.decision.coreHrNote) + '</span>' : '') +
          '</p>'
        : '') +
      '<h3 class="mt-5 text-xs font-semibold uppercase tracking-wider text-slate-400">Timeline</h3>' +
      '<ul class="mt-2 space-y-2">' +
      timeline +
      '</ul>' +
      (notes
        ? '<h3 class="mt-5 text-xs font-semibold uppercase tracking-wider text-slate-400">Investigation notes</h3><div class="mt-2 space-y-2">' + notes + '</div>'
        : '') +
      actionForms(row);
    openPanel(row.code + ' · ' + row.typeLabel, row.summary, html);
  }

  async function loadAll() {
    state.meta = (await api.get('/grievance/meta')).meta;
    state.cases = (await api.get('/grievance/cases')).cases || [];
    state.people = (await api.get('/grievance/people')).people || [];
    if (isHr()) state.analytics = await api.get('/grievance/analytics');
    renderList('mine-list', myCases(), 'No cases on file for you.');
    if (isHr()) {
      renderList('register-list', state.cases, 'No cases in the register.');
      renderAnalytics();
    }
  }

  function wire() {
    document.querySelector('[data-tab="register"]').classList.toggle('hidden', !isHr());
    document.querySelector('[data-tab="analytics"]').classList.toggle('hidden', !isHr());

    el('er-tabs').addEventListener('click', function (event) {
      var button = event.target.closest('[data-tab]');
      if (button) setTab(button.getAttribute('data-tab'));
    });
    el('open-case').addEventListener('click', function () {
      openPanel('New case', 'Intake is logged. Investigation notes will not appear on the personnel file.', caseForm());
    });
    el('panel-close').addEventListener('click', function () { setPanel(false); });
    el('panel-backdrop').addEventListener('click', function () { setPanel(false); });

    document.body.addEventListener('click', function (event) {
      var open = event.target.closest('[data-open]');
      var reject = event.target.closest('[data-reject]');
      var closeBtn = event.target.closest('[data-close]');
      if (open) {
        api.get('/grievance/cases/' + open.getAttribute('data-open')).then(function (payload) {
          renderDetail(payload.case);
        }).catch(function (err) { toast(err.message, 'error'); });
      }
      if (reject) {
        var note = window.prompt('Reason for rejecting this case?') || '';
        if (!note.trim()) return;
        api.post('/grievance/cases/' + reject.getAttribute('data-reject') + '/triage', { status: 'rejected', note: note }).then(function (payload) {
          toast(payload.message);
          setPanel(false);
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
      if (closeBtn) {
        api.post('/grievance/cases/' + closeBtn.getAttribute('data-close') + '/close', {}).then(function (payload) {
          toast(payload.message);
          setPanel(false);
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
    });

    el('panel-body').addEventListener('submit', function (event) {
      var form = event.target;
      var id = form.getAttribute('data-id');
      if (form.id === 'case-form') {
        event.preventDefault();
        var data = Object.fromEntries(new FormData(form).entries());
        if (!data.subject) delete data.subject;
        api.post('/grievance/cases', data).then(function (payload) {
          toast(payload.message);
          setPanel(false);
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
      if (form.id === 'triage-form') {
        event.preventDefault();
        api.post('/grievance/cases/' + id + '/triage', { status: 'investigation', note: new FormData(form).get('note') }).then(function (payload) {
          toast(payload.message);
          return loadAll().then(function () { renderDetail(payload.case); });
        }).catch(function (err) { toast(err.message, 'error'); });
      }
      if (form.id === 'note-form') {
        event.preventDefault();
        api.post('/grievance/cases/' + id + '/notes', { body: new FormData(form).get('body') }).then(function (payload) {
          toast(payload.message);
          renderDetail(payload.case);
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
      if (form.id === 'hearing-form') {
        event.preventDefault();
        var hearing = Object.fromEntries(new FormData(form).entries());
        api.post('/grievance/cases/' + id + '/hearing', hearing).then(function (payload) {
          toast(payload.message);
          renderDetail(payload.case);
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
      if (form.id === 'decision-form') {
        event.preventDefault();
        api.post('/grievance/cases/' + id + '/decision', Object.fromEntries(new FormData(form).entries())).then(function (payload) {
          toast(payload.message);
          renderDetail(payload.case);
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
      if (form.id === 'appeal-form') {
        event.preventDefault();
        api.post('/grievance/cases/' + id + '/appeal', { reason: new FormData(form).get('reason') }).then(function (payload) {
          toast(payload.message);
          renderDetail(payload.case);
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
    });
  }

  async function init() {
    var user = await shell.mount('grievance');
    if (!user) return;
    state.user = user;
    wire();
    await loadAll();
    setTab(isHr() ? 'register' : 'mine');
  }

  init().catch(function (err) {
    if (err && err.status === 401) return;
    console.error('Grievance failed to initialise', err);
  });
})(window, document);
