/* Admin console: settings, role matrix, workflows, delegation, connectors. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var shell = window.PortoHR.shell;

  var TABS = [
    'console',
    'users',
    'departments',
    'roles',
    'workflows',
    'delegations',
    'notifications',
    'lookups',
    'integrations',
    'audit',
  ];

  var state = {
    user: null,
    tab: 'console',
    settings: null,
    meta: null,
    roles: [],
    workflows: [],
    people: [],
    delegations: [],
    templates: [],
    lookups: [],
    connectors: [],
    deliveries: [],
    outbox: [],
    keys: [],
    audit: [],
    dragStep: null,
  };

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function toast(message, tone) {
    var node = document.createElement('div');
    node.className =
      'pointer-events-auto rounded-lg border px-4 py-2.5 text-sm shadow-lg ' +
      (tone === 'error'
        ? 'border-red-200 bg-red-50 text-red-800'
        : 'border-emerald-200 bg-emerald-50 text-emerald-800');
    node.textContent = message;
    el('toasts').appendChild(node);
    window.setTimeout(function () {
      node.remove();
    }, 3200);
  }

  function todayInput() {
    var now = new Date();
    return (
      now.getFullYear() +
      '-' +
      String(now.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(now.getDate()).padStart(2, '0')
    );
  }

  function monthEndInput() {
    var now = new Date();
    var last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return (
      last.getFullYear() +
      '-' +
      String(last.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(last.getDate()).padStart(2, '0')
    );
  }

  function setTab(tab) {
    state.tab = tab;
    TABS.forEach(function (name) {
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

  function fillSettings() {
    var s = state.settings || {};
    el('set-name').value = s.name || '';
    el('set-legal').value = s.legalEntity || '';
    el('set-country').value = s.country || '';
    el('set-locale').value = s.locale || '';
    el('set-timezone').value = s.timezone || '';
    el('set-currency').value = s.currency || '';
    el('set-fy').value = s.fyStartMonth || 7;
    el('set-email').value = s.supportEmail || '';
  }

  function renderRoles() {
    var modules = (state.meta && state.meta.modules) || [];
    var roles = state.roles || [];
    if (!roles.length) {
      el('roles-board').innerHTML = '<p class="text-sm text-slate-500">No overlay stored — defaults apply.</p>';
      return;
    }
    var head =
      '<th class="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Module</th>' +
      roles
        .map(function (role) {
          return '<th class="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">' + escapeHtml(role.role) + '</th>';
        })
        .join('');
    var body = modules
      .map(function (mod) {
        var cells = roles
          .map(function (role) {
            var locked = role.role !== 'hr_admin' && mod.value === 'admin';
            var forced = role.role === 'hr_admin' && (mod.value === 'admin' || mod.value === 'core_hr');
            var checked = (role.modules || []).indexOf(mod.value) !== -1;
            return (
              '<td class="px-3 py-2 text-center"><input type="checkbox" data-role="' +
              escapeHtml(role.role) +
              '" data-module="' +
              escapeHtml(mod.value) +
              '"' +
              (checked || forced ? ' checked' : '') +
              (locked || forced ? ' disabled' : '') +
              ' /></td>'
            );
          })
          .join('');
        return '<tr class="border-t border-slate-100"><td class="px-3 py-2 text-sm">' + escapeHtml(mod.label) + '</td>' + cells + '</tr>';
      })
      .join('');
    el('roles-board').innerHTML =
      '<div class="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">' +
      '<table class="min-w-full"><thead class="bg-slate-50"><tr>' +
      head +
      '</tr></thead><tbody>' +
      body +
      '</tbody></table></div>' +
      '<button id="save-roles" type="button" class="mt-4 rounded-lg bg-[#2054C9] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#173F9C]">Save matrix</button>';
  }

  function actorOptions(selected) {
    var roles = (state.meta && state.meta.actorRoles) || [];
    return roles
      .map(function (role) {
        return (
          '<option value="' +
          escapeHtml(role.value) +
          '"' +
          (role.value === selected ? ' selected' : '') +
          '>' +
          escapeHtml(role.label) +
          '</option>'
        );
      })
      .join('');
  }

  function renderWorkflows() {
    el('workflows-board').innerHTML = (state.workflows || [])
      .map(function (wf) {
        var steps = (wf.steps || [])
          .map(function (step, index) {
            return (
              '<li draggable="true" class="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2" data-step="' +
              index +
              '">' +
              '<span class="w-6 cursor-grab text-xs text-slate-400" title="Drag to reorder">' +
              (index + 1) +
              '</span>' +
              '<select data-field="actorRole" class="rounded-lg border border-slate-300 px-2 py-1 text-sm">' +
              actorOptions(step.actorRole) +
              '</select>' +
              '<input data-field="label" value="' +
              escapeHtml(step.label || '') +
              '" placeholder="Label" class="min-w-[8rem] flex-1 rounded-lg border border-slate-300 px-2 py-1 text-sm" />' +
              '<input data-field="thresholdAmount" type="number" min="0" value="' +
              escapeHtml(step.thresholdAmount || 0) +
              '" class="w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm" title="Amount threshold" />' +
              '<button type="button" data-move="up" class="rounded px-2 py-1 text-xs text-slate-500 hover:bg-white">Up</button>' +
              '<button type="button" data-move="down" class="rounded px-2 py-1 text-xs text-slate-500 hover:bg-white">Down</button>' +
              '<button type="button" data-remove="1" class="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50">Remove</button>' +
              '</li>'
            );
          })
          .join('');
        return (
          '<article class="mb-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm" data-workflow="' +
          escapeHtml(wf.id) +
          '">' +
          '<div class="flex flex-wrap items-start justify-between gap-3">' +
          '<div><h3 class="text-sm font-semibold">' +
          escapeHtml(wf.name) +
          '</h3><p class="text-xs text-slate-500">' +
          escapeHtml(wf.summary || '') +
          '</p></div>' +
          '<span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium uppercase text-slate-600">' +
          escapeHtml(wf.status) +
          '</span></div>' +
          '<ol class="mt-3 space-y-2">' +
          steps +
          '</ol>' +
          '<div class="mt-3 flex flex-wrap gap-2">' +
          '<button type="button" data-add-step="1" class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium hover:bg-slate-50">Add step</button>' +
          '<button type="button" data-save-wf="1" class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">Save draft</button>' +
          '<button type="button" data-publish-wf="1" class="rounded-lg bg-[#2054C9] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#173F9C]">Publish</button>' +
          '</div></article>'
        );
      })
      .join('');
  }

  function peopleOptions(selected) {
    return (state.people || [])
      .map(function (person) {
        return (
          '<option value="' +
          escapeHtml(person.id) +
          '"' +
          (person.id === selected ? ' selected' : '') +
          '>' +
          escapeHtml(person.fullName + ' · ' + person.employeeCode) +
          '</option>'
        );
      })
      .join('');
  }

  function renderDelegations() {
    el('del-grantor').innerHTML = peopleOptions();
    el('del-delegate').innerHTML = peopleOptions();
    var rows = state.delegations || [];
    if (!rows.length) {
      el('delegations-board').innerHTML =
        '<p class="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">No delegations yet.</p>';
      return;
    }
    el('delegations-board').innerHTML =
      '<ul class="space-y-2">' +
      rows
        .map(function (row) {
          return (
            '<li class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">' +
            '<div><p class="font-medium">' +
            escapeHtml((row.grantorSnapshot && row.grantorSnapshot.fullName) || 'Grantor') +
            ' → ' +
            escapeHtml((row.delegateSnapshot && row.delegateSnapshot.fullName) || 'Delegate') +
            '</p><p class="text-xs text-slate-500">' +
            escapeHtml(String(row.fromOn).slice(0, 10)) +
            ' – ' +
            escapeHtml(String(row.toOn).slice(0, 10)) +
            ' · ' +
            escapeHtml(row.status) +
            (row.note ? ' · ' + row.note : '') +
            '</p></div>' +
            (row.status === 'active'
              ? '<button type="button" data-cancel-del="' +
                escapeHtml(row.id) +
                '" class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium hover:bg-slate-50">Cancel</button>'
              : '') +
            '</li>'
          );
        })
        .join('') +
      '</ul>';
  }

  function renderTemplates() {
    el('templates-board').innerHTML = (state.templates || [])
      .map(function (row) {
        return (
          '<article class="mb-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm" data-template="' +
          escapeHtml(row.id) +
          '">' +
          '<div class="flex items-center justify-between gap-3"><h3 class="text-sm font-semibold">' +
          escapeHtml(row.name) +
          '</h3><select data-field="channel" class="rounded-lg border border-slate-300 px-2 py-1 text-[11px] uppercase text-slate-600">' +
          ['in_app', 'email', 'sms']
            .map(function (channel) {
              return (
                '<option value="' +
                channel +
                '"' +
                (row.channel === channel ? ' selected' : '') +
                '>' +
                channel.replace('_', ' ') +
                '</option>'
              );
            })
            .join('') +
          '</select></div>' +
          '<input data-field="subject" value="' +
          escapeHtml(row.subject || '') +
          '" class="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
          '<textarea data-field="body" rows="3" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">' +
          escapeHtml(row.body || '') +
          '</textarea>' +
          '<div class="mt-3 flex gap-2">' +
          '<button type="button" data-save-tpl="1" class="rounded-lg bg-[#2054C9] px-3 py-1.5 text-xs font-semibold text-white">Save</button>' +
          '<button type="button" data-test-tpl="1" class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium">Send test</button>' +
          '</div></article>'
        );
      })
      .join('');
  }

  function renderLookups() {
    var cats = (state.meta && state.meta.lookupCategories) || [];
    if (!el('lu-category').options.length) {
      el('lu-category').innerHTML = cats
        .map(function (cat) {
          return '<option value="' + escapeHtml(cat.value) + '">' + escapeHtml(cat.label) + '</option>';
        })
        .join('');
    }
    el('lookups-board').innerHTML =
      '<table class="min-w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-sm shadow-sm"><thead class="bg-slate-50"><tr>' +
      '<th class="px-3 py-2 text-left text-xs uppercase text-slate-500">Category</th><th class="px-3 py-2 text-left text-xs uppercase text-slate-500">Code</th><th class="px-3 py-2 text-left text-xs uppercase text-slate-500">Label</th></tr></thead><tbody>' +
      (state.lookups || [])
        .map(function (row) {
          return (
            '<tr class="border-t border-slate-100"><td class="px-3 py-2">' +
            escapeHtml(row.category) +
            '</td><td class="px-3 py-2 font-mono text-xs">' +
            escapeHtml(row.code) +
            '</td><td class="px-3 py-2">' +
            escapeHtml(row.label) +
            '</td></tr>'
          );
        })
        .join('') +
      '</tbody></table>';
  }

  function renderConnectors() {
    el('connectors-board').innerHTML = (state.connectors || [])
      .map(function (row) {
        var live = row.kind === 'webhook';
        return (
          '<article class="mb-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-connector="' +
          escapeHtml(row.id) +
          '">' +
          '<div class="flex flex-wrap items-center justify-between gap-2"><h3 class="text-sm font-semibold">' +
          escapeHtml(row.name) +
          '</h3><label class="text-xs"><input type="checkbox" data-field="enabled"' +
          (row.enabled ? ' checked' : '') +
          ' /> Enabled</label></div>' +
          '<input data-field="endpoint" value="' +
          escapeHtml(row.endpoint || '') +
          '" placeholder="' +
          (live ? 'https://example.com/hooks/portohr' : 'Endpoint (stored)') +
          '" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
          '<input data-field="secret" type="password" value="" placeholder="' +
          (row.secret ? 'Secret stored — leave blank to keep' : 'HMAC secret') +
          '" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
          '<p class="mt-2 text-xs text-slate-400">' +
          escapeHtml(row.lastTestNote || 'Not tested') +
          '</p>' +
          '<div class="mt-2 flex gap-2">' +
          '<button type="button" data-save-con="1" class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium">Save</button>' +
          '<button type="button" data-test-con="1" class="rounded-lg bg-[#2054C9] px-3 py-1.5 text-xs font-semibold text-white">' +
          (live ? 'Send signed test' : 'Test adapter') +
          '</button>' +
          '</div></article>'
        );
      })
      .join('');
  }

  function renderDeliveries() {
    var host = el('deliveries-board');
    if (!host) return;
    var rows = state.deliveries || [];
    if (!rows.length) {
      host.innerHTML = '<p class="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">No deliveries yet. Enable the webhook connector and send a signed test.</p>';
      return;
    }
    host.innerHTML =
      '<ul class="space-y-2">' +
      rows
        .map(function (row) {
          return (
            '<li class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">' +
            '<p class="font-medium">' +
            escapeHtml(row.direction) +
            ' · ' +
            escapeHtml(row.event) +
            ' · ' +
            escapeHtml(row.status) +
            '</p><p class="text-xs text-slate-500">' +
            escapeHtml(row.endpoint || '') +
            (row.responseStatus ? ' · HTTP ' + row.responseStatus : '') +
            (row.lastError ? ' · ' + row.lastError : '') +
            '</p></li>'
          );
        })
        .join('') +
      '</ul>';
  }

  function renderOutbox() {
    var host = el('outbox-board');
    if (!host) return;
    var rows = state.outbox || [];
    if (!rows.length) {
      host.innerHTML = '<p class="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">Empty. Send a test on an email or SMS template to queue a row.</p>';
      return;
    }
    host.innerHTML =
      '<ul class="space-y-2">' +
      rows
        .map(function (row) {
          return (
            '<li class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">' +
            '<p class="font-medium">' +
            escapeHtml(row.channel) +
            ' · ' +
            escapeHtml(row.status) +
            ' · ' +
            escapeHtml(row.title) +
            '</p><p class="text-xs text-slate-500">' +
            escapeHtml(row.destination || row.userEmail || '') +
            (row.lastError ? ' · ' + row.lastError : '') +
            '</p></li>'
          );
        })
        .join('') +
      '</ul>';
  }

  function renderKeys() {
    el('keys-board').innerHTML =
      '<ul class="space-y-2">' +
      (state.keys || [])
        .map(function (row) {
          return (
            '<li class="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">' +
            '<span>' +
            escapeHtml(row.name) +
            ' · <span class="font-mono text-xs">' +
            escapeHtml(row.prefix) +
            '…</span>' +
            (row.revokedAt ? ' · revoked' : '') +
            '</span>' +
            (row.revokedAt
              ? ''
              : '<button type="button" data-revoke-key="' +
                escapeHtml(row.id) +
                '" class="text-xs font-medium text-red-600">Revoke</button>') +
            '</li>'
          );
        })
        .join('') +
      '</ul>';
  }

  function renderAudit() {
    el('audit-board').innerHTML =
      '<ul class="space-y-2">' +
      (state.audit || [])
        .map(function (row) {
          return (
            '<li class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">' +
            '<p class="font-medium">' +
            escapeHtml(row.action) +
            '</p>' +
            '<p class="text-xs text-slate-500">' +
            escapeHtml(row.actorName || '') +
            (row.summary ? ' · ' + row.summary : '') +
            '</p></li>'
          );
        })
        .join('') +
      '</ul>';
  }

  function collectSteps(article) {
    return Array.prototype.map.call(article.querySelectorAll('[data-step]'), function (li) {
      return {
        actorRole: li.querySelector('[data-field="actorRole"]').value,
        label: li.querySelector('[data-field="label"]').value,
        thresholdAmount: Number(li.querySelector('[data-field="thresholdAmount"]').value || 0),
      };
    });
  }

  async function loadAll() {
    var meta = await api.get('/admin/meta');
    state.settings = meta.settings;
    state.meta = meta.meta;
    fillSettings();
    var packed = await Promise.all([
      api.get('/admin/permissions'),
      api.get('/admin/workflows'),
      api.get('/admin/directory'),
      api.get('/admin/delegations'),
      api.get('/admin/templates'),
      api.get('/admin/lookups'),
      api.get('/admin/connectors'),
      api.get('/admin/deliveries'),
      api.get('/admin/outbox'),
      api.get('/admin/keys'),
      api.get('/admin/audit'),
    ]);
    state.roles = packed[0].roles;
    state.workflows = packed[1].workflows;
    state.people = packed[2].employees;
    state.delegations = packed[3].delegations;
    state.templates = packed[4].templates;
    state.lookups = packed[5].lookups;
    state.connectors = packed[6].connectors;
    state.deliveries = packed[7].deliveries;
    state.outbox = packed[8].outbox;
    state.keys = packed[9].keys;
    state.audit = packed[10].entries;
    renderRoles();
    renderWorkflows();
    renderDelegations();
    renderTemplates();
    renderLookups();
    renderConnectors();
    renderDeliveries();
    renderOutbox();
    renderKeys();
    renderAudit();
  }

  function wire() {
    document.querySelectorAll('.tab-btn').forEach(function (button) {
      button.addEventListener('click', function () {
        setTab(button.getAttribute('data-tab'));
      });
    });

    el('settings-form').addEventListener('submit', function (event) {
      event.preventDefault();
      api
        .request('/admin/settings', {
          method: 'PATCH',
          body: {
            name: el('set-name').value,
            legalEntity: el('set-legal').value,
            country: el('set-country').value,
            locale: el('set-locale').value,
            timezone: el('set-timezone').value,
            currency: el('set-currency').value,
            fyStartMonth: Number(el('set-fy').value),
            supportEmail: el('set-email').value,
          },
        })
        .then(function (payload) {
          state.settings = payload.settings;
          toast('Settings saved');
        })
        .catch(function (err) {
          toast(err.message, 'error');
        });
    });

    el('roles-board').addEventListener('click', function (event) {
      if (event.target.id !== 'save-roles') return;
      var next = {};
      state.roles.forEach(function (role) {
        next[role.role] = [];
      });
      el('roles-board').querySelectorAll('input[type="checkbox"]').forEach(function (box) {
        if (box.checked || box.disabled) {
          var role = box.getAttribute('data-role');
          var mod = box.getAttribute('data-module');
          if (role === 'hr_admin' && (mod === 'admin' || mod === 'core_hr')) next[role].push(mod);
          else if (box.checked) next[role].push(mod);
        }
      });
      state.roles.forEach(function (role) {
        if (role.role === 'hr_admin') {
          ['admin', 'core_hr'].forEach(function (mod) {
            if (next[role.role].indexOf(mod) === -1) next[role.role].push(mod);
          });
        }
      });
      api
        .request('/admin/permissions', { method: 'PUT', body: { roles: next } })
        .then(function (payload) {
          state.roles = payload.roles;
          renderRoles();
          toast('Role matrix saved — sign-in again for nav changes to stick on other sessions');
        })
        .catch(function (err) {
          toast(err.message, 'error');
        });
    });

    el('workflows-board').addEventListener('click', function (event) {
      var article = event.target.closest('[data-workflow]');
      if (!article) return;
      var id = article.getAttribute('data-workflow');
      var list = article.querySelector('ol');
      if (event.target.getAttribute('data-add-step')) {
        var li = document.createElement('li');
        li.className = 'flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2';
        li.setAttribute('data-step', String(list.children.length));
        li.setAttribute('draggable', 'true');
        li.innerHTML =
          '<span class="w-6 cursor-grab text-xs text-slate-400" title="Drag to reorder"></span><select data-field="actorRole" class="rounded-lg border border-slate-300 px-2 py-1 text-sm">' +
          actorOptions('manager') +
          '</select><input data-field="label" placeholder="Label" class="min-w-[8rem] flex-1 rounded-lg border border-slate-300 px-2 py-1 text-sm" /><input data-field="thresholdAmount" type="number" min="0" value="0" class="w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm" /><button type="button" data-move="up" class="rounded px-2 py-1 text-xs text-slate-500 hover:bg-white">Up</button><button type="button" data-move="down" class="rounded px-2 py-1 text-xs text-slate-500 hover:bg-white">Down</button><button type="button" data-remove="1" class="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50">Remove</button>';
        list.appendChild(li);
        return;
      }
      if (event.target.getAttribute('data-remove')) {
        var row = event.target.closest('[data-step]');
        if (row) row.remove();
        return;
      }
      if (event.target.getAttribute('data-move')) {
        var step = event.target.closest('[data-step]');
        if (!step) return;
        if (event.target.getAttribute('data-move') === 'up' && step.previousElementSibling) {
          list.insertBefore(step, step.previousElementSibling);
        }
        if (event.target.getAttribute('data-move') === 'down' && step.nextElementSibling) {
          list.insertBefore(step.nextElementSibling, step);
        }
        return;
      }
      if (event.target.getAttribute('data-save-wf')) {
        api
          .request('/admin/workflows/' + id, { method: 'PATCH', body: { steps: collectSteps(article) } })
          .then(function () {
            return api.get('/admin/workflows');
          })
          .then(function (payload) {
            state.workflows = payload.workflows;
            renderWorkflows();
            toast('Workflow saved as draft');
          })
          .catch(function (err) {
            toast(err.message, 'error');
          });
      }
      if (event.target.getAttribute('data-publish-wf')) {
        api
          .request('/admin/workflows/' + id, { method: 'PATCH', body: { steps: collectSteps(article) } })
          .then(function () {
            return api.request('/admin/workflows/' + id + '/publish', { method: 'POST' });
          })
          .then(function (payload) {
            toast(payload.message || 'Published');
            return api.get('/admin/workflows');
          })
          .then(function (payload) {
            state.workflows = payload.workflows;
            renderWorkflows();
          })
          .catch(function (err) {
            toast(err.message, 'error');
          });
      }
    });

    el('workflows-board').addEventListener('dragstart', function (event) {
      var li = event.target.closest('[data-step]');
      if (!li || event.target.closest('input,select,button,textarea')) {
        event.preventDefault();
        return;
      }
      state.dragStep = li;
      event.dataTransfer.effectAllowed = 'move';
      li.classList.add('opacity-60');
    });
    el('workflows-board').addEventListener('dragend', function () {
      if (state.dragStep) state.dragStep.classList.remove('opacity-60');
      state.dragStep = null;
    });
    el('workflows-board').addEventListener('dragover', function (event) {
      var li = event.target.closest('[data-step]');
      if (!li || !state.dragStep || li === state.dragStep) return;
      event.preventDefault();
      var list = li.parentNode;
      var rect = li.getBoundingClientRect();
      if (event.clientY - rect.top < rect.height / 2) list.insertBefore(state.dragStep, li);
      else list.insertBefore(state.dragStep, li.nextSibling);
    });

    el('delegation-form').addEventListener('submit', function (event) {
      event.preventDefault();
      api
        .request('/admin/delegations', {
          method: 'POST',
          body: {
            grantor: el('del-grantor').value,
            delegate: el('del-delegate').value,
            fromOn: el('del-from').value,
            toOn: el('del-to').value,
            note: el('del-note').value,
          },
        })
        .then(function () {
          toast('Delegation recorded');
          return api.get('/admin/delegations');
        })
        .then(function (payload) {
          state.delegations = payload.delegations;
          renderDelegations();
          if (shell.refreshNotifications) shell.refreshNotifications();
        })
        .catch(function (err) {
          toast(err.message, 'error');
        });
    });

    el('delegations-board').addEventListener('click', function (event) {
      var id = event.target.getAttribute('data-cancel-del');
      if (!id) return;
      api
        .request('/admin/delegations/' + id + '/cancel', { method: 'PATCH' })
        .then(function () {
          return api.get('/admin/delegations');
        })
        .then(function (payload) {
          state.delegations = payload.delegations;
          renderDelegations();
          toast('Delegation cancelled');
        })
        .catch(function (err) {
          toast(err.message, 'error');
        });
    });

    el('templates-board').addEventListener('click', function (event) {
      var article = event.target.closest('[data-template]');
      if (!article) return;
      var id = article.getAttribute('data-template');
      if (event.target.getAttribute('data-save-tpl')) {
        api
          .request('/admin/templates/' + id, {
            method: 'PATCH',
            body: {
              subject: article.querySelector('[data-field="subject"]').value,
              body: article.querySelector('[data-field="body"]').value,
              channel: article.querySelector('[data-field="channel"]').value,
            },
          })
          .then(function () {
            toast('Template saved');
          })
          .catch(function (err) {
            toast(err.message, 'error');
          });
      }
      if (event.target.getAttribute('data-test-tpl')) {
        api
          .request('/admin/templates/' + id + '/test', { method: 'POST' })
          .then(function (payload) {
            toast(payload.message || 'Test notification sent to you');
            if (shell.refreshNotifications) shell.refreshNotifications();
            return api.get('/admin/outbox');
          })
          .then(function (payload) {
            if (payload) {
              state.outbox = payload.outbox;
              renderOutbox();
            }
          })
          .catch(function (err) {
            toast(err.message, 'error');
          });
      }
    });

    el('lookup-form').addEventListener('submit', function (event) {
      event.preventDefault();
      api
        .request('/admin/lookups', {
          method: 'POST',
          body: { category: el('lu-category').value, code: el('lu-code').value, label: el('lu-label').value },
        })
        .then(function () {
          el('lu-code').value = '';
          el('lu-label').value = '';
          return api.get('/admin/lookups');
        })
        .then(function (payload) {
          state.lookups = payload.lookups;
          renderLookups();
          toast('Lookup added');
        })
        .catch(function (err) {
          toast(err.message, 'error');
        });
    });

    el('connectors-board').addEventListener('click', function (event) {
      var article = event.target.closest('[data-connector]');
      if (!article) return;
      var id = article.getAttribute('data-connector');
      var body = {
        enabled: article.querySelector('[data-field="enabled"]').checked,
        endpoint: article.querySelector('[data-field="endpoint"]').value,
      };
      var secret = article.querySelector('[data-field="secret"]');
      if (secret && secret.value) body.secret = secret.value;
      if (event.target.getAttribute('data-save-con')) {
        api
          .request('/admin/connectors/' + id, { method: 'PATCH', body: body })
          .then(function () {
            toast('Connector saved');
          })
          .catch(function (err) {
            toast(err.message, 'error');
          });
      }
      if (event.target.getAttribute('data-test-con')) {
        api
          .request('/admin/connectors/' + id + '/test', { method: 'POST' })
          .then(function (payload) {
            toast(payload.message || 'Test complete');
            return Promise.all([api.get('/admin/connectors'), api.get('/admin/deliveries')]);
          })
          .then(function (packed) {
            if (packed && packed[0]) {
              state.connectors = packed[0].connectors;
              renderConnectors();
            }
            if (packed && packed[1]) {
              state.deliveries = packed[1].deliveries;
              renderDeliveries();
            }
          })
          .catch(function (err) {
            toast(err.message, 'error');
          });
      }
    });

    el('key-form').addEventListener('submit', function (event) {
      event.preventDefault();
      api
        .request('/admin/keys', { method: 'POST', body: { name: el('key-name').value } })
        .then(function (payload) {
          el('key-secret').textContent = 'Secret (shown once): ' + payload.key.secret;
          el('key-name').value = '';
          return api.get('/admin/keys');
        })
        .then(function (payload) {
          state.keys = payload.keys;
          renderKeys();
          toast('API key created');
        })
        .catch(function (err) {
          toast(err.message, 'error');
        });
    });

    el('keys-board').addEventListener('click', function (event) {
      var id = event.target.getAttribute('data-revoke-key');
      if (!id) return;
      api
        .request('/admin/keys/' + id, { method: 'DELETE' })
        .then(function () {
          return api.get('/admin/keys');
        })
        .then(function (payload) {
          state.keys = payload.keys;
          renderKeys();
          toast('Key revoked');
        })
        .catch(function (err) {
          toast(err.message, 'error');
        });
    });

    el('audit-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var q = el('audit-action').value ? '?action=' + encodeURIComponent(el('audit-action').value) : '';
      api
        .get('/admin/audit' + q)
        .then(function (payload) {
          state.audit = payload.entries;
          renderAudit();
        })
        .catch(function (err) {
          toast(err.message, 'error');
        });
    });
  }

  shell.mount('admin').then(function (user) {
    if (!user) return;
    state.user = user;
    if ((user.modules || []).indexOf('admin') === -1) {
      window.location.replace('/dashboard.html');
      return;
    }
    el('del-from').value = todayInput();
    el('del-to').value = monthEndInput();
    wire();
    loadAll().catch(function (err) {
      toast(err.message || 'Could not load admin', 'error');
    });
  });
})(window, document);
