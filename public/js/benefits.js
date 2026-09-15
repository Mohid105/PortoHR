/* Benefits: coverage, grade-based plans, life-event / open-enrollment elections. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var shell = window.PortoHR.shell;

  var TONES = {
    pending: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    ended: 'bg-slate-100 text-slate-500 ring-slate-400/20',
    rejected: 'bg-red-50 text-red-700 ring-red-600/20',
    published: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  };

  var state = {
    user: null,
    meta: null,
    tab: 'mine',
    mine: { enrollments: [], family: [], window: {} },
    plans: [],
    queue: [],
    summary: { plans: [], totals: {} },
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

  function money(amount, currency) {
    return (currency || 'USD') + ' ' + Number(amount || 0).toFixed(2);
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
      (TONES[status] || TONES.pending) +
      '">' +
      escapeHtml(label || status) +
      '</span>'
    );
  }

  function setTab(tab) {
    state.tab = tab;
    ['mine', 'plans', 'queue', 'cost'].forEach(function (name) {
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

  function currentOption(planId) {
    return (state.mine.enrollments || []).filter(function (row) {
      return row.planId === planId && (row.status === 'active' || row.status === 'pending');
    })[0];
  }

  function renderBanner() {
    var box = el('oe-banner');
    var windowMeta = (state.meta && state.meta.openEnrollment) || {};
    if (windowMeta.open) {
      box.classList.remove('hidden');
      box.textContent = 'Open enrollment is on (' + windowMeta.startsOn + ' – ' + windowMeta.endsOn + '). Elect or change coverage from Plans.';
    } else {
      box.classList.add('hidden');
    }
  }

  function renderMine() {
    var host = el('mine-list');
    var rows = state.mine.enrollments || [];
    if (!rows.length) {
      host.innerHTML = '<p class="text-sm text-slate-500">No coverage on file yet. Grade defaults appear after HR publishes plans.</p>';
    } else {
      host.innerHTML = '<div class="grid gap-4 md:grid-cols-2">' + rows.map(function (row) {
        var deps = (row.dependents || []).map(function (item) { return item.name; }).join(', ');
        return (
          '<article class="rounded-xl border border-slate-200 bg-white p-4 shadow-card">' +
          '<div class="flex items-start justify-between gap-2"><p class="text-sm font-semibold text-slate-900">' +
          escapeHtml(row.planName) +
          '</p>' +
          badge(row.status, row.statusLabel) +
          '</div><p class="mt-1 text-xs text-slate-500">' +
          escapeHtml(row.optionName) +
          ' · ' +
          escapeHtml(row.categoryLabel) +
          '</p><p class="mt-3 text-sm text-slate-600">You ' +
          escapeHtml(money(row.employeeAmount, row.currency)) +
          ' / month · employer ' +
          escapeHtml(money(row.employerAmount, row.currency)) +
          '</p>' +
          (deps ? '<p class="mt-2 text-xs text-slate-500">Dependents: ' + escapeHtml(deps) + '</p>' : '') +
          (row.lifeEventLabel ? '<p class="mt-1 text-xs text-slate-400">' + escapeHtml(row.lifeEventLabel) + '</p>' : '') +
          '</article>'
        );
      }).join('') + '</div>';
    }

    var family = state.mine.family || [];
    el('family-list').innerHTML =
      '<h3 class="text-sm font-semibold text-slate-900">Family & dependents</h3>' +
      '<p class="mt-1 text-xs text-slate-500">Sourced from Core HR. Cover them when you elect a family option.</p>' +
      (family.length
        ? '<ul class="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">' +
          family.map(function (row) {
            return (
              '<li class="px-4 py-3 text-sm"><span class="font-medium">' +
              escapeHtml(row.name) +
              '</span><span class="ml-2 text-xs text-slate-400">' +
              escapeHtml(row.relationship) +
              (row.isDependent ? ' · dependent' : '') +
              '</span></li>'
            );
          }).join('') +
          '</ul>'
        : '<p class="mt-2 text-sm text-slate-500">No family records yet. Add them in Core HR.</p>');
  }

  function renderPlans() {
    var host = el('plan-list');
    if (!state.plans.length) {
      host.innerHTML = '<p class="text-sm text-slate-500">No published plans.</p>';
      return;
    }
    host.innerHTML = state.plans.map(function (plan) {
      var current = currentOption(plan.id);
      var options = (plan.options || []).map(function (opt) {
        return (
          '<label class="mt-2 flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm">' +
          '<input type="radio" name="option-' + plan.id + '" value="' + opt.id + '" class="mt-1" ' +
          (current && current.optionId === opt.id ? 'checked' : '') +
          ' />' +
          '<span><span class="font-medium">' +
          escapeHtml(opt.name) +
          '</span>' +
          (opt.isDefault ? ' <span class="text-xs text-slate-400">default</span>' : '') +
          '<br /><span class="text-xs text-slate-500">You ' +
          escapeHtml(money(opt.employeeAmount, plan.currency)) +
          ' · employer ' +
          escapeHtml(money(opt.employerAmount, plan.currency)) +
          (opt.maxDependents ? ' · up to ' + opt.maxDependents + ' dependents' : '') +
          '</span></span></label>'
        );
      }).join('');
      return (
        '<article class="rounded-xl border border-slate-200 bg-white p-5 shadow-card" data-plan="' + plan.id + '">' +
        '<div class="flex items-start justify-between gap-2"><div><p class="text-sm font-semibold">' +
        escapeHtml(plan.name) +
        '</p><p class="text-xs text-slate-500">' +
        escapeHtml(plan.categoryLabel) +
        (plan.provider ? ' · ' + escapeHtml(plan.provider) : '') +
        '</p></div>' +
        (current ? badge(current.status, current.statusLabel) : '') +
        '</div><p class="mt-2 text-sm text-slate-600">' +
        escapeHtml(plan.summary || '') +
        '</p>' +
        options +
        (plan.options.some(function (opt) { return opt.maxDependents > 0; }) && state.mine.family.length
          ? '<div class="mt-3 space-y-1 text-sm">' +
            state.mine.family.map(function (row) {
              return '<label class="flex items-center gap-2"><input type="checkbox" name="dep-' + plan.id + '" value="' + row.id + '" /> ' + escapeHtml(row.name) + '</label>';
            }).join('') +
            '</div>'
          : '') +
        '<button type="button" data-elect="' + plan.id + '" class="mt-4 rounded-lg bg-[#2054C9] px-3 py-2 text-xs font-semibold text-white">Submit election</button></article>'
      );
    }).join('');
  }

  function renderQueue() {
    var host = el('queue-list');
    var pending = (state.queue || []).filter(function (row) { return row.status === 'pending'; });
    if (!pending.length) {
      host.innerHTML = '<p class="px-5 py-10 text-center text-sm text-slate-500">No benefits changes waiting.</p>';
      return;
    }
    host.innerHTML =
      '<ul class="divide-y divide-slate-100">' +
      pending.map(function (row) {
        var actions = isHr()
          ? '<button type="button" data-decide="' + row.id + '" data-status="approved" class="text-xs font-semibold text-emerald-700">Approve</button>' +
            '<button type="button" data-decide="' + row.id + '" data-status="rejected" class="ml-2 text-xs text-red-600">Reject</button>'
          : '';
        return (
          '<li class="flex flex-wrap items-center justify-between gap-3 px-5 py-3">' +
          '<div><p class="text-sm font-medium">' +
          escapeHtml(row.learner) +
          ' · ' +
          escapeHtml(row.planName) +
          '</p><p class="text-xs text-slate-400">' +
          escapeHtml(row.optionName) +
          (row.lifeEventLabel ? ' · ' + escapeHtml(row.lifeEventLabel) : ' · ' + escapeHtml(row.sourceLabel)) +
          '</p></div><div>' +
          badge('pending', row.statusLabel) +
          (actions ? '<span class="ml-3">' + actions + '</span>' : '') +
          '</div></li>'
        );
      }).join('') +
      '</ul>';
  }

  function renderCost() {
    var host = el('cost-board');
    var totals = state.summary.totals || {};
    var rows = state.summary.plans || [];
    host.innerHTML =
      '<div class="grid gap-4 sm:grid-cols-3">' +
      '<div class="rounded-xl border border-slate-200 bg-white p-4 shadow-card"><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Heads covered</p><p class="mt-1 text-2xl font-semibold">' +
      (totals.heads || 0) +
      '</p></div>' +
      '<div class="rounded-xl border border-slate-200 bg-white p-4 shadow-card"><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Employer / month</p><p class="mt-1 text-2xl font-semibold">' +
      escapeHtml(money(totals.employerAmount)) +
      '</p></div>' +
      '<div class="rounded-xl border border-slate-200 bg-white p-4 shadow-card"><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Employee / month</p><p class="mt-1 text-2xl font-semibold">' +
      escapeHtml(money(totals.employeeAmount)) +
      '</p></div></div>' +
      (rows.length
        ? '<ul class="mt-6 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">' +
          rows.map(function (row) {
            return (
              '<li class="flex items-center justify-between gap-3 px-4 py-3 text-sm"><div><p class="font-medium">' +
              escapeHtml(row.planName) +
              '</p><p class="text-xs text-slate-400">' +
              escapeHtml(row.categoryLabel) +
              (row.provider ? ' · ' + escapeHtml(row.provider) : '') +
              ' · ' +
              row.heads +
              ' people</p></div><p class="tabular-nums">' +
              escapeHtml(money(row.totalAmount, row.currency)) +
              '</p></li>'
            );
          }).join('') +
          '</ul>'
        : '<p class="mt-4 text-sm text-slate-500">No active coverage in scope.</p>');
  }

  function planForm() {
    var cats = ((state.meta && state.meta.categories) || [])
      .map(function (row) {
        return '<option value="' + row.value + '">' + escapeHtml(row.label) + '</option>';
      })
      .join('');
    return (
      '<form id="plan-form" class="space-y-3">' +
      '<input name="name" required minlength="3" placeholder="Plan name" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<select name="category" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">' + cats + '</select>' +
      '<input name="provider" placeholder="Provider" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<textarea name="summary" rows="3" placeholder="Summary" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"></textarea>' +
      '<p class="text-xs font-medium text-slate-500">Default option</p>' +
      '<input name="optionName" required placeholder="Option name" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<div class="grid grid-cols-2 gap-2"><input name="employerAmount" type="number" min="0" step="0.01" placeholder="Employer / month" class="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><input name="employeeAmount" type="number" min="0" step="0.01" placeholder="Employee / month" class="rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div>' +
      '<input name="maxDependents" type="number" min="0" placeholder="Max dependents" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<button type="submit" class="w-full rounded-lg bg-[#2054C9] py-2.5 text-sm font-semibold text-white">Save plan</button></form>'
    );
  }

  function lifeEventForm(planId, optionId, dependents) {
    var events = ((state.meta && state.meta.lifeEvents) || [])
      .map(function (row) {
        return '<option value="' + row.value + '">' + escapeHtml(row.label) + '</option>';
      })
      .join('');
    return (
      '<form id="life-form" data-plan="' + planId + '" data-option="' + optionId + '" class="space-y-3">' +
      '<input type="hidden" name="dependents" value="' + escapeHtml((dependents || []).join(',')) + '" />' +
      '<select name="lifeEvent" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">' + events + '</select>' +
      '<input name="evidenceUrl" placeholder="Evidence URL / reference" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<textarea name="reason" rows="3" placeholder="What changed?" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"></textarea>' +
      '<button type="submit" class="w-full rounded-lg bg-[#2054C9] py-2.5 text-sm font-semibold text-white">Submit life-event change</button></form>'
    );
  }

  async function loadAll() {
    state.meta = (await api.get('/benefits/meta')).meta;
    state.mine = await api.get('/benefits/me');
    var plans = await api.get('/benefits/plans');
    state.plans = plans.plans || [];
    if (isHr()) {
      var enrollments = await api.get('/benefits/enrollments?status=pending');
      state.queue = enrollments.enrollments || [];
    }
    if (canStaff()) {
      state.summary = await api.get('/benefits/summary');
    }
    renderBanner();
    renderMine();
    renderPlans();
    if (isHr()) renderQueue();
    if (canStaff()) renderCost();
  }

  function collectElection(planId) {
    var card = document.querySelector('[data-plan="' + planId + '"]');
    var picked = card.querySelector('input[name="option-' + planId + '"]:checked');
    if (!picked) {
      toast('Pick an option first', 'error');
      return null;
    }
    var dependents = Array.prototype.map.call(card.querySelectorAll('input[name="dep-' + planId + '"]:checked'), function (box) {
      return box.value;
    });
    return { option: picked.value, dependents: dependents };
  }

  function wire() {
    el('open-plan').classList.toggle('hidden', !isHr());
    el('export-file').classList.toggle('hidden', !isHr());
    document.querySelector('[data-tab="queue"]').classList.toggle('hidden', !isHr());
    document.querySelector('[data-tab="cost"]').classList.toggle('hidden', !canStaff());

    el('ben-tabs').addEventListener('click', function (event) {
      var button = event.target.closest('[data-tab]');
      if (button) setTab(button.getAttribute('data-tab'));
    });
    el('open-plan').addEventListener('click', function () {
      openPanel('New plan', 'Published plans appear for eligible grades immediately.', planForm());
    });
    el('export-file').addEventListener('click', function () {
      api.get('/benefits/export').then(function (payload) {
        var blob = new window.Blob([JSON.stringify(payload.providerFile, null, 2)], { type: 'application/json' });
        var url = window.URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = 'portohr-benefits-provider.json';
        link.click();
        window.URL.revokeObjectURL(url);
        toast('Provider file downloaded');
      }).catch(function (err) { toast(err.message, 'error'); });
    });
    el('panel-close').addEventListener('click', function () { setPanel(false); });
    el('panel-backdrop').addEventListener('click', function () { setPanel(false); });

    el('panel-body').addEventListener('submit', function (event) {
      var form = event.target;
      if (form.id === 'plan-form') {
        event.preventDefault();
        var data = Object.fromEntries(new FormData(form).entries());
        api.post('/benefits/plans', data).then(function (payload) {
          return api.post('/benefits/plans/' + payload.plan.id + '/options', {
            name: data.optionName,
            employerAmount: data.employerAmount,
            employeeAmount: data.employeeAmount,
            maxDependents: data.maxDependents,
            isDefault: true,
          });
        }).then(function () {
          toast('Plan published');
          setPanel(false);
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
      if (form.id === 'life-form') {
        event.preventDefault();
        var life = Object.fromEntries(new FormData(form).entries());
        var dependents = life.dependents ? life.dependents.split(',').filter(Boolean) : [];
        api.post('/benefits/enrollments', {
          option: form.getAttribute('data-option'),
          dependents: dependents,
          lifeEvent: life.lifeEvent,
          evidenceUrl: life.evidenceUrl,
          reason: life.reason,
        }).then(function (payload) {
          toast(payload.message);
          setPanel(false);
          setTab('mine');
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
    });

    document.body.addEventListener('click', function (event) {
      var electBtn = event.target.closest('[data-elect]');
      var decide = event.target.closest('[data-decide]');
      if (electBtn) {
        var election = collectElection(electBtn.getAttribute('data-elect'));
        if (!election) return;
        var open = state.meta && state.meta.openEnrollment && state.meta.openEnrollment.open;
        if (!open && !isHr()) {
          openPanel('Life-event change', 'Open enrollment is closed, so this needs a qualifying event.', lifeEventForm(
            electBtn.getAttribute('data-elect'),
            election.option,
            election.dependents
          ));
          return;
        }
        api.post('/benefits/enrollments', election).then(function (payload) {
          toast(payload.message);
          setTab('mine');
          if (shell.refreshApprovals) shell.refreshApprovals();
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
      if (decide) {
        var status = decide.getAttribute('data-status');
        var note = '';
        if (status === 'rejected') {
          note = window.prompt('Reason?') || '';
          if (!note.trim()) return;
        }
        api.request('/benefits/enrollments/' + decide.getAttribute('data-decide') + '/status', {
          method: 'PATCH',
          body: { status: status, decisionNote: note },
        }).then(function (payload) {
          toast(payload.message);
          if (shell.refreshApprovals) shell.refreshApprovals();
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
    });
  }

  async function init() {
    var user = await shell.mount('benefits');
    if (!user) return;
    state.user = user;
    wire();
    await loadAll();
    setTab(state.tab);
  }

  init().catch(function (err) {
    if (err && err.status === 401) return;
    console.error('Benefits failed to initialise', err);
  });
})(window, document);
