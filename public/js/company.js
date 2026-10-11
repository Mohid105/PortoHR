/* Company Hub: announcements, people directory, org chart and offboarding. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var shell = window.PortoHR.shell;
  var state = { user: null, isHr: false, announcements: [], editing: null, dirTimer: null, tabsLoaded: {} };

  function el(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function initials(name) {
    return String(name || '?').split(' ').filter(Boolean).slice(0, 2).map(function (p) { return p[0].toUpperCase(); }).join('');
  }

  function fmtDate(value) {
    var d = new Date(value);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function when(days) {
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    return 'in ' + days + ' days';
  }

  /* ---------- Tabs ---------- */

  var TABS = ['news', 'people', 'chart', 'onboarding', 'exit'];

  function setTab(tab) {
    document.querySelectorAll('#co-tabs .tab-btn').forEach(function (btn) {
      var active = btn.getAttribute('data-tab') === tab;
      btn.classList.toggle('border-[#2054C9]', active);
      btn.classList.toggle('border-transparent', !active);
      btn.classList.toggle('font-semibold', active);
      btn.classList.toggle('font-medium', !active);
      btn.classList.toggle('text-slate-900', active);
      btn.classList.toggle('text-slate-500', !active);
    });
    TABS.forEach(function (name) {
      el('tab-' + name).classList.toggle('hidden', name !== tab);
    });
    el('ann-new').classList.toggle('hidden', !(state.isHr && tab === 'news'));
    if (!state.tabsLoaded[tab]) {
      state.tabsLoaded[tab] = true;
      if (tab === 'people') loadDirectory();
      if (tab === 'chart') loadChart();
    }
    if (tab === 'exit') loadOffboarding();
    if (tab === 'onboarding') loadOnboarding();
    try { window.history.replaceState(null, '', '#' + tab); } catch (err) { /* ignore */ }
  }

  /* ---------- Announcements ---------- */

  var CATEGORY = { general: ['General', 'info'], policy: ['Policy', 'warn'], event: ['Event', 'ok'], urgent: ['Urgent', 'bad'] };

  function renderNews() {
    var host = el('news-list');
    if (!state.announcements.length) {
      host.innerHTML = '<div class="empty-note" style="border:0">No announcements yet.' + (state.isHr ? ' Post the first one with “New announcement”.' : '') + '</div>';
      return;
    }
    host.innerHTML = state.announcements.map(function (row) {
      var cat = CATEGORY[row.category] || CATEGORY.general;
      var tools = state.isHr
        ? '<span class="ml-auto flex gap-1"><button type="button" class="btn-ghost" data-edit="' + esc(row.id) + '">Edit</button>' +
          '<button type="button" class="btn-ghost" data-del="' + esc(row.id) + '">Remove</button></span>'
        : '';
      return '<article class="ann"><div class="flex flex-wrap items-center gap-2">' +
        '<span class="pill ' + cat[1] + '">' + cat[0] + '</span>' +
        (row.pinned ? '<span class="pill">Pinned</span>' : '') +
        '<span class="text-xs text-slate-400">' + esc(fmtDate(row.publishedAt)) + (row.authorName ? ' · ' + esc(row.authorName) : '') + '</span>' + tools + '</div>' +
        '<h3 class="mt-2">' + esc(row.title) + '</h3><p class="body">' + esc(row.body) + '</p></article>';
    }).join('');
  }

  async function loadNews() {
    try {
      var payload = await api.get('/company/announcements' + (state.isHr ? '?all=1' : ''));
      state.announcements = payload.announcements || [];
    } catch (err) {
      state.announcements = [];
    }
    renderNews();
  }

  function openAnnouncement(row) {
    state.editing = row || null;
    el('ann-title-h').textContent = row ? 'Edit announcement' : 'New announcement';
    el('ann-title').value = row ? row.title : '';
    el('ann-body').value = row ? row.body : '';
    el('ann-category').value = row ? row.category : 'general';
    el('ann-expires').value = row && row.expiresAt ? String(row.expiresAt).slice(0, 10) : '';
    el('ann-pinned').checked = Boolean(row && row.pinned);
    el('ann-error').classList.add('hidden');
    el('ann-modal').classList.remove('hidden');
    el('ann-title').focus();
  }

  function wireNews() {
    el('ann-new').addEventListener('click', function () { openAnnouncement(null); });
    el('ann-cancel').addEventListener('click', function () { el('ann-modal').classList.add('hidden'); });
    el('ann-modal').addEventListener('mousedown', function (e) { if (e.target === el('ann-modal')) el('ann-modal').classList.add('hidden'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') el('ann-modal').classList.add('hidden'); });

    el('ann-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var body = {
        title: el('ann-title').value,
        body: el('ann-body').value,
        category: el('ann-category').value,
        pinned: el('ann-pinned').checked,
        expiresAt: el('ann-expires').value || null,
      };
      try {
        if (state.editing) await api.request('/company/announcements/' + state.editing.id, { method: 'PATCH', body: body });
        else await api.request('/company/announcements', { method: 'POST', body: body });
        el('ann-modal').classList.add('hidden');
        await loadNews();
      } catch (err) {
        el('ann-error').textContent = err.message || 'Could not save the announcement.';
        el('ann-error').classList.remove('hidden');
      }
    });

    el('news-list').addEventListener('click', async function (event) {
      var edit = event.target.closest('[data-edit]');
      var del = event.target.closest('[data-del]');
      if (edit) {
        openAnnouncement(state.announcements.filter(function (r) { return r.id === edit.getAttribute('data-edit'); })[0]);
      } else if (del && window.confirm('Remove this announcement for everyone?')) {
        await api.request('/company/announcements/' + del.getAttribute('data-del'), { method: 'DELETE' });
        loadNews();
      }
    });
  }

  /* ---------- Moments ---------- */

  function momentCard(title, rows, line) {
    var body = rows.length
      ? '<ul class="mt-3 space-y-3">' + rows.slice(0, 6).map(function (r) {
          return '<li class="flex items-center gap-3"><span class="avatar">' + esc(initials(r.fullName)) + '</span>' +
            '<span class="min-w-0"><span class="block truncate text-sm font-medium text-slate-900">' + esc(r.fullName) + '</span>' +
            '<span class="block truncate text-xs text-slate-500">' + line(r) + '</span></span></li>';
        }).join('') + '</ul>'
      : '<p class="mt-3 text-sm text-slate-400">Nothing coming up.</p>';
    return '<div class="card card-pad"><p class="kpi-label" style="font-size:.7rem;font-weight:650;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)">' + title + '</p>' + body + '</div>';
  }

  async function loadMoments() {
    try {
      var m = await api.get('/company/moments?days=30');
      el('moments').innerHTML =
        momentCard('Birthdays · next 30 days', m.birthdays, function (r) { return when(r.inDays) + ' · ' + esc(r.department); }) +
        momentCard('Work anniversaries', m.anniversaries, function (r) { return r.years + ' year' + (r.years === 1 ? '' : 's') + ' · ' + when(r.inDays); }) +
        momentCard('New joiners', m.newJoiners, function (r) { return esc(r.designation) + ' · ' + esc(fmtDate(r.joinedOn)); });
    } catch (err) {
      el('moments').innerHTML = '';
    }
  }

  /* ---------- Directory ---------- */

  var dirRows = [];

  function renderDirectory() {
    var dept = el('dir-dept').value;
    var rows = dirRows.filter(function (r) { return !dept || r.department === dept; });
    el('dir-count').textContent = rows.length + ' of ' + dirRows.length + ' people';
    el('dir-body').innerHTML = rows.length ? rows.map(function (r) {
      var status = r.employmentStatus || '';
      var tone = status === 'confirmed' ? 'ok' : status === 'probation' ? 'info' : status === 'notice_period' ? 'warn' : '';
      return '<tr><td class="px-6 py-4"><div class="flex items-center gap-3"><span class="avatar">' + esc(initials(r.fullName)) + '</span>' +
        '<span class="min-w-0"><span class="block truncate font-medium text-slate-900">' + esc(r.fullName) + '</span>' +
        '<span class="block truncate text-xs text-slate-500">' + esc(r.designation) + ' · ' + esc(r.employeeCode) + '</span></span></div></td>' +
        '<td class="px-6 py-4 text-slate-600">' + esc(r.department) + '</td>' +
        '<td class="px-6 py-4 text-slate-600"><a class="hover:underline" href="mailto:' + esc(r.email) + '">' + esc(r.email) + '</a>' + (r.phone ? '<span class="block text-xs text-slate-400">' + esc(r.phone) + '</span>' : '') + '</td>' +
        '<td class="px-6 py-4 text-slate-600">' + esc(r.location || '—') + '</td>' +
        '<td class="px-6 py-4"><span class="pill ' + tone + '">' + esc(String(status).replace('_', ' ') || '—') + '</span></td></tr>';
    }).join('') : '<tr><td colspan="5" class="px-6 py-10 text-center text-sm text-slate-500">No one matches that search.</td></tr>';
  }

  async function fetchAllEmployees(q) {
    var out = [];
    var page = 1;
    var total = Infinity;
    while (out.length < total && page <= 50) {
      var payload = await api.get('/employees?limit=100&page=' + page + (q ? '&q=' + encodeURIComponent(q) : ''));
      var rows = payload.employees || [];
      total = payload.total || 0;
      out = out.concat(rows);
      if (!rows.length) break;
      page += 1;
    }
    return out;
  }

  async function loadDirectory() {
    el('dir-body').innerHTML = '<tr><td colspan="5" class="px-6 py-10 text-center text-sm text-slate-500">Loading…</td></tr>';
    try {
      dirRows = await fetchAllEmployees(el('dir-q').value.trim());
    } catch (err) {
      dirRows = [];
    }
    var depts = Array.from(new Set(dirRows.map(function (r) { return r.department; }).filter(Boolean))).sort();
    var current = el('dir-dept').value;
    el('dir-dept').innerHTML = '<option value="">All departments</option>' + depts.map(function (d) { return '<option>' + esc(d) + '</option>'; }).join('');
    el('dir-dept').value = depts.indexOf(current) !== -1 ? current : '';
    renderDirectory();
  }

  function csvCell(value) {
    var text = String(value === null || value === undefined ? '' : value);
    // Spreadsheet formula injection guard.
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function exportCsv() {
    var dept = el('dir-dept').value;
    var rows = dirRows.filter(function (r) { return !dept || r.department === dept; });
    var head = ['Employee code', 'Name', 'Designation', 'Department', 'Email', 'Phone', 'Location', 'Status'];
    var lines = [head.map(csvCell).join(',')].concat(rows.map(function (r) {
      return [r.employeeCode, r.fullName, r.designation, r.department, r.email, r.phone, r.location, r.employmentStatus].map(csvCell).join(',');
    }));
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'employee-directory-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }

  function wireDirectory() {
    el('dir-q').addEventListener('input', function () {
      clearTimeout(state.dirTimer);
      state.dirTimer = setTimeout(loadDirectory, 250);
    });
    el('dir-dept').addEventListener('change', renderDirectory);
    el('dir-export').addEventListener('click', exportCsv);
  }

  /* ---------- Org chart ---------- */

  function nodeHtml(node, depth) {
    var kids = node.reports || [];
    var inner = '<span class="node' + (kids.length ? ' toggle' : '') + '" ' + (kids.length ? 'data-toggle="1" role="button" tabindex="0" aria-expanded="' + (depth < 2) + '"' : '') + '>' +
      '<span class="avatar">' + esc(initials(node.fullName)) + '</span>' +
      '<span class="min-w-0"><b>' + esc(node.fullName) + '</b><i>' + esc(node.designation) + ' · ' + esc(node.department) + '</i></span>' +
      (kids.length ? '<span class="count" title="People in this reporting line">' + node.teamSize + '</span>' : '') + '</span>';
    return '<li class="' + (kids.length && depth >= 2 ? 'is-collapsed' : '') + '">' + inner +
      (kids.length ? '<ul>' + kids.map(function (k) { return nodeHtml(k, depth + 1); }).join('') + '</ul>' : '') + '</li>';
  }

  async function loadChart() {
    try {
      var chart = await api.get('/company/org-chart');
      el('chart-total').textContent = chart.total + ' people · click a manager to expand or collapse';
      el('chart').innerHTML = chart.roots.length
        ? '<ul class="tree">' + chart.roots.map(function (r) { return nodeHtml(r, 0); }).join('') + '</ul>'
        : '<p class="text-sm text-slate-500">No employees to show yet.</p>';
    } catch (err) {
      el('chart').innerHTML = '<p class="text-sm text-slate-500">Could not load the org chart.</p>';
    }
  }

  function wireChart() {
    var toggle = function (node) {
      var li = node.closest('li');
      var collapsed = li.classList.toggle('is-collapsed');
      node.setAttribute('aria-expanded', String(!collapsed));
    };
    el('chart').addEventListener('click', function (e) {
      var node = e.target.closest('[data-toggle]');
      if (node) toggle(node);
    });
    el('chart').addEventListener('keydown', function (e) {
      var node = e.target.closest('[data-toggle]');
      if (node && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(node); }
    });
    var all = function (collapse) {
      el('chart').querySelectorAll('li').forEach(function (li) {
        if (li.querySelector(':scope > ul')) li.classList.toggle('is-collapsed', collapse);
      });
    };
    el('chart-expand').addEventListener('click', function () { all(false); });
    el('chart-collapse').addEventListener('click', function () { all(true); });
  }

  /* ---------- Offboarding ---------- */

  var OWNER = { hr: 'HR', manager: 'Manager', it: 'IT', finance: 'Finance', employee: 'Employee' };

  function renderOffboarding(cases) {
    var open = cases.filter(function (c) { return !c.complete; }).length;
    var badge = el('exit-count');
    badge.textContent = String(open);
    badge.classList.toggle('hidden', !open);

    el('exit-list').innerHTML = cases.length ? cases.map(function (c) {
      var pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
      return '<section class="card"><div class="flex flex-wrap items-center gap-3 border-b px-5 py-4" style="border-color:var(--border)">' +
        '<span class="avatar">' + esc(initials(c.fullName)) + '</span>' +
        '<div class="min-w-0"><p class="text-sm font-semibold text-slate-900">' + esc(c.fullName) + '</p>' +
        '<p class="text-xs text-slate-500">' + esc(c.designation) + ' · ' + esc(c.department) + (c.lastWorkingDay ? ' · last day ' + esc(fmtDate(c.lastWorkingDay)) : '') + '</p></div>' +
        '<span class="pill ' + (c.complete ? 'ok' : 'warn') + ' ml-auto">' + (c.complete ? 'Cleared' : c.done + ' of ' + c.total + ' done') + '</span></div>' +
        '<div class="kpi-bar" style="margin:0;border-radius:0;height:.22rem"><i style="width:' + pct + '%"></i></div>' +
        '<ul>' + c.tasks.map(function (t) {
          var done = t.status === 'done';
          var late = !done && t.dueOn && new Date(t.dueOn) < new Date();
          return '<li class="flex items-center gap-3 px-5 py-2.5" style="border-top:1px solid var(--border)">' +
            '<input type="checkbox" class="chk" data-task="' + esc(t.id) + '"' + (done ? ' checked' : '') + ' aria-label="' + esc(t.title) + '" />' +
            '<span class="min-w-0 flex-1 text-sm ' + (done ? 'text-slate-400 line-through' : 'text-slate-800') + '">' + esc(t.title) + '</span>' +
            '<span class="pill">' + esc(OWNER[t.owner] || t.owner) + '</span>' +
            '<span class="w-24 text-right text-xs ' + (late ? 'font-semibold text-red-600' : 'text-slate-400') + '">' + (done ? 'Done' : esc(fmtDate(t.dueOn))) + '</span></li>';
        }).join('') + '</ul></section>';
    }).join('') : '<div class="empty-note">No one is being offboarded. When you separate an employee in Core HR their checklist appears here.</div>';
  }

  async function loadOffboarding() {
    try {
      renderOffboarding((await api.get('/company/offboarding')).cases || []);
    } catch (err) {
      el('exit-list').innerHTML = '<div class="empty-note">Could not load offboarding cases.</div>';
    }
  }

  function wireOffboarding() {
    el('exit-list').addEventListener('change', async function (event) {
      var box = event.target.closest('[data-task]');
      if (!box) return;
      box.disabled = true;
      try {
        var result = await api.request('/company/offboarding/tasks/' + box.getAttribute('data-task'), { method: 'PATCH', body: { done: box.checked } });
        if (result.loginDeactivated) window.alert('Access revoked: this person can no longer sign in to PortoHR.');
      } catch (err) {
        window.alert(err.message || 'Could not update the checklist.');
      }
      loadOffboarding();
    });
  }

  /* ---------- Onboarding ---------- */

  function renderOnboarding(starters) {
    var badge = el('onboarding-count');
    badge.textContent = String(starters.length);
    badge.classList.toggle('hidden', !starters.length);

    el('onboarding-list').innerHTML = starters.length ? starters.map(function (s) {
      var pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
      var link = state.isHr ? '<a class="hover:underline" style="color:var(--primary)" href="/core-hr.html#/employee/' + esc(s.employee.id) + '">' + esc(s.employee.name) + '</a>' : esc(s.employee.name);
      return '<section class="card"><div class="flex flex-wrap items-center gap-3 border-b px-5 py-4" style="border-color:var(--border)">' +
        '<span class="avatar">' + esc(initials(s.employee.name)) + '</span>' +
        '<div class="min-w-0"><p class="text-sm font-semibold text-slate-900">' + link + '</p>' +
        '<p class="text-xs text-slate-500">' + esc(s.employee.designation) + ' · ' + esc(s.employee.department) + ' · joins ' + esc(fmtDate(s.employee.dateOfJoining)) + '</p></div>' +
        (s.overdue ? '<span class="pill bad ml-auto">' + s.overdue + ' overdue</span><span class="pill warn">' : '<span class="pill warn ml-auto">') + s.done + ' of ' + s.total + ' done</span></div>' +
        '<div class="kpi-bar" style="margin:0;border-radius:0;height:.22rem"><i style="width:' + pct + '%"></i></div>' +
        '<ul>' + s.tasks.map(function (t) {
          var done = t.status === 'done';
          var late = !done && t.dueOn && new Date(t.dueOn) < new Date();
          var mine = state.isHr || t.owner === 'manager' || t.owner === 'employee';
          return '<li class="flex items-center gap-3 px-5 py-2.5" style="border-top:1px solid var(--border)">' +
            '<input type="checkbox" class="chk" data-hire-task="' + esc(t.id) + '"' + (done ? ' checked' : '') + (mine ? '' : ' disabled') + ' aria-label="' + esc(t.title) + '" />' +
            '<span class="min-w-0 flex-1 text-sm ' + (done ? 'text-slate-400 line-through' : 'text-slate-800') + '">' + esc(t.title) + '</span>' +
            '<span class="pill">' + esc(OWNER[t.owner] || t.owner) + '</span>' +
            '<span class="w-24 text-right text-xs ' + (late ? 'font-semibold text-red-600' : 'text-slate-400') + '">' + (done ? 'Done' : esc(fmtDate(t.dueOn))) + '</span></li>';
        }).join('') + '</ul></section>';
    }).join('') : '<div class="empty-note">No one is being onboarded. Hire someone with the new-employee form and their checklist appears here.</div>';
  }

  async function loadOnboarding() {
    try {
      renderOnboarding((await api.get('/employees/onboarding')).starters || []);
    } catch (err) {
      el('onboarding-list').innerHTML = '<div class="empty-note">Could not load onboarding checklists.</div>';
    }
  }

  function wireOnboarding() {
    el('onboarding-list').addEventListener('change', async function (event) {
      var box = event.target.closest('[data-hire-task]');
      if (!box) return;
      box.disabled = true;
      try {
        await api.request('/employees/onboarding/' + box.getAttribute('data-hire-task'), { method: 'PATCH', body: { status: box.checked ? 'done' : 'pending' } });
      } catch (err) {
        window.alert(err.message || 'Could not update the checklist.');
      }
      loadOnboarding();
    });
  }

  /* ---------- Init ---------- */

  async function init() {
    var user = await shell.mount('company');
    if (!user) return;
    state.user = user;
    state.isHr = user.role === 'hr_admin';

    el('exit-tab').classList.toggle('hidden', !state.isHr);
    var canOnboard = state.isHr || user.role === 'manager';
    el('onboarding-tab').classList.toggle('hidden', !canOnboard);
    if (canOnboard) {
      wireOnboarding();
      api.get('/employees/onboarding').then(function (p) { renderOnboarding(p.starters || []); }).catch(function () {});
    }
    wireNews();
    wireDirectory();
    wireChart();
    if (state.isHr) {
      wireOffboarding();
      api.get('/company/offboarding').then(function (p) { renderOffboarding(p.cases || []); }).catch(function () {});
    }

    el('co-tabs').addEventListener('click', function (event) {
      var btn = event.target.closest('[data-tab]');
      if (btn) setTab(btn.getAttribute('data-tab'));
    });

    loadNews();
    loadMoments();
    var initial = (window.location.hash || '').replace('#', '');
    var allowed = TABS.indexOf(initial) !== -1 && (initial !== 'exit' || state.isHr) && (initial !== 'onboarding' || canOnboard);
    setTab(allowed ? initial : 'news');
  }

  init().catch(function (err) {
    if (err && err.status === 401) return;
    console.error('Company hub failed to initialise', err);
  });
})(window, document);
