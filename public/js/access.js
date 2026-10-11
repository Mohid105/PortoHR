/* Admin → Users & access and Departments. Loaded after admin.js; loads lazily per tab. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var shell = window.PortoHR.shell;
  var ROLES = [['employee', 'Employee'], ['manager', 'Manager'], ['hr_admin', 'HR Admin']];
  var me = null;
  var loaded = {};
  var submitHandler = null;

  function el(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toast(message, tone) {
    var node = document.createElement('div');
    node.className = 'pointer-events-auto rounded-lg border px-4 py-2.5 text-sm shadow-lg ' +
      (tone === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800');
    node.textContent = message;
    el('toasts').appendChild(node);
    window.setTimeout(function () { node.remove(); }, 3500);
  }

  function fmt(value) {
    var d = new Date(value);
    return isNaN(d.getTime()) ? 'Never' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* ---------- Modal ---------- */

  function openModal(opts) {
    el('access-title').textContent = opts.title;
    el('access-sub').textContent = opts.sub || '';
    el('access-sub').classList.toggle('hidden', !opts.sub);
    el('access-fields').innerHTML = opts.fields || '';
    el('access-result').classList.add('hidden');
    el('access-error').classList.add('hidden');
    el('access-submit').textContent = opts.submit || 'Save';
    el('access-submit').classList.remove('hidden');
    el('access-cancel').textContent = 'Cancel';
    submitHandler = opts.onSubmit;
    el('access-modal').classList.remove('hidden');
    var first = el('access-fields').querySelector('input,select');
    if (first) first.focus();
  }

  function closeModal() { el('access-modal').classList.add('hidden'); }

  function showSecret(user, password, verb) {
    el('access-title').textContent = verb;
    el('access-sub').textContent = 'Share this once, privately. It cannot be shown again.';
    el('access-sub').classList.remove('hidden');
    el('access-fields').innerHTML = '';
    el('access-result').innerHTML =
      '<div style="padding:.9rem 1rem;border:1px dashed var(--border-strong);border-radius:.7rem;background:var(--surface-alt)">' +
      '<p class="text-xs text-slate-500">' + esc(user.fullName) + ' · ' + esc(user.email) + '</p>' +
      '<p class="mt-1 flex items-center justify-between gap-3"><code id="secret-text" style="font-size:1.05rem;font-weight:650;letter-spacing:.02em">' + esc(password) + '</code>' +
      '<button type="button" id="secret-copy" class="btn btn-secondary btn-sm">Copy</button></p></div>';
    el('access-result').classList.remove('hidden');
    el('access-submit').classList.add('hidden');
    el('access-cancel').textContent = 'Done';
    el('secret-copy').addEventListener('click', function () {
      if (navigator.clipboard) navigator.clipboard.writeText(password).then(function () { toast('Copied'); });
    });
  }

  function wireModal() {
    el('access-cancel').addEventListener('click', closeModal);
    el('access-modal').addEventListener('mousedown', function (e) { if (e.target === el('access-modal')) closeModal(); });
    el('access-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!submitHandler) return;
      var button = el('access-submit');
      button.disabled = true;
      try {
        await submitHandler();
      } catch (err) {
        el('access-error').textContent = err.message || 'Something went wrong.';
        el('access-error').classList.remove('hidden');
      } finally {
        button.disabled = false;
      }
    });
  }

  function roleOptions(selected) {
    return ROLES.map(function (r) { return '<option value="' + r[0] + '"' + (r[0] === selected ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('');
  }

  /* ---------- Users ---------- */

  var users = [];
  var unlinked = [];

  function render() {
    el('users-unlinked').innerHTML = unlinked.length
      ? '<div class="rounded-xl border px-4 py-3 text-sm" style="border-color:color-mix(in srgb,var(--warning) 40%,var(--border));background:color-mix(in srgb,var(--warning) 9%,var(--surface))">' +
        '<b>' + unlinked.length + ' employee' + (unlinked.length === 1 ? '' : 's') + ' cannot sign in yet.</b> ' +
        unlinked.slice(0, 4).map(function (e) { return esc(e.fullName); }).join(', ') + (unlinked.length > 4 ? ' and ' + (unlinked.length - 4) + ' more' : '') +
        ' <button type="button" class="font-semibold underline" data-open-create>Create logins</button></div>'
      : '';

    el('users-board').innerHTML = '<div class="overflow-x-auto"><table class="min-w-full text-sm"><thead><tr>' +
      '<th class="px-6 py-3.5 text-left">Account</th><th class="px-6 py-3.5 text-left">Role</th><th class="px-6 py-3.5 text-left">Status</th>' +
      '<th class="px-6 py-3.5 text-left">Last sign-in</th><th class="px-6 py-3.5 text-right">Actions</th></tr></thead><tbody>' +
      users.map(function (u) {
        var self = me && u.id === me.id;
        return '<tr><td class="px-6 py-4"><span class="block font-medium text-slate-900">' + esc(u.fullName) + (self ? ' <span class="pill info">You</span>' : '') + '</span>' +
          '<span class="block text-xs text-slate-500">' + esc(u.email) + ' · ' + esc(u.employeeId) + '</span></td>' +
          '<td class="px-6 py-4"><select data-role="' + esc(u.id) + '" class="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"' + (self ? ' disabled' : '') + '>' + roleOptions(u.role) + '</select></td>' +
          '<td class="px-6 py-4">' + (u.isActive ? '<span class="pill ok">Active</span>' : '<span class="pill bad">Deactivated</span>') +
          (u.locked ? ' <span class="pill bad" title="Too many wrong passwords">Locked</span>' : '') +
          (u.mustChangePassword ? ' <span class="pill warn" title="Has not chosen their own password yet">Temp password</span>' : '') + '</td>' +
          '<td class="px-6 py-4 text-slate-500">' + esc(fmt(u.lastLoginAt)) + '</td>' +
          '<td class="px-6 py-4 text-right">' +
          (self ? '' : (u.locked ? '<button type="button" class="btn-ghost" data-unlock="' + esc(u.id) + '">Unlock</button>' : '') + '<button type="button" class="btn-ghost" data-revoke="' + esc(u.id) + '" title="Sign this person out of every device">Sign out</button><button type="button" class="btn-ghost" data-reset="' + esc(u.id) + '">Reset password</button>' +
            '<button type="button" class="btn-ghost" data-toggle="' + esc(u.id) + '">' + (u.isActive ? 'Deactivate' : 'Reactivate') + '</button>') +
          '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  var REASON = { ok: ['Signed in', 'ok'], bad_password: ['Wrong password', 'warn'], unknown_user: ['Unknown email', 'warn'], locked: ['Blocked: locked', 'bad'], deactivated: ['Blocked: deactivated', 'bad'] };

  function renderActivity(events) {
    var host = el('users-activity');
    if (!host) return;
    host.innerHTML = '<div class="flex items-center justify-between px-6 py-4"><div><h3 class="text-sm font-semibold text-slate-900">Recent sign-in activity</h3>' +
      '<p class="text-xs text-slate-500">Successful and failed attempts, newest first. Kept for 180 days.</p></div>' +
      '<label class="flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" id="act-failed" class="chk" style="width:1rem;height:1rem" /> Failures only</label></div>' +
      (events.length ? '<div class="overflow-x-auto"><table class="min-w-full text-sm"><thead><tr><th class="px-6 py-3 text-left">When</th><th class="px-6 py-3 text-left">Email</th><th class="px-6 py-3 text-left">Result</th><th class="px-6 py-3 text-left">IP address</th><th class="px-6 py-3 text-left">Device</th></tr></thead><tbody>' +
        events.map(function (e) {
          var r = REASON[e.reason] || [e.reason, ''];
          return '<tr><td class="px-6 py-2.5 whitespace-nowrap text-slate-600">' + esc(new Date(e.createdAt).toLocaleString()) + '</td><td class="px-6 py-2.5">' + esc(e.email || '—') + '</td>' +
            '<td class="px-6 py-2.5"><span class="pill ' + r[1] + '">' + esc(r[0]) + '</span></td><td class="px-6 py-2.5 text-slate-500">' + esc(e.ip || '—') + '</td>' +
            '<td class="px-6 py-2.5 text-xs text-slate-400" style="max-width:18rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(e.userAgent || '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="px-6 pb-8 text-center text-sm text-slate-500">No sign-in activity yet.</p>');
    var box = el('act-failed');
    if (box) {
      box.checked = Boolean(host.__failedOnly);
      box.addEventListener('change', function () { host.__failedOnly = box.checked; loadActivity(); });
    }
  }

  async function loadActivity() {
    var host = el('users-activity');
    var failed = host && host.__failedOnly;
    try {
      renderActivity((await api.get('/admin/security/events?limit=40' + (failed ? '&failed=1' : ''))).events || []);
    } catch (err) {
      /* activity is a convenience */
    }
  }

  async function loadUsers() {
    var results = await Promise.all([api.get('/admin/users'), api.get('/admin/users/unlinked')]);
    users = results[0].users || [];
    unlinked = results[1].employees || [];
    render();
    loadActivity();
  }

  function openCreate(preselect) {
    if (!unlinked.length) { toast('Every active employee already has a login.'); return; }
    openModal({
      title: 'Create a login',
      sub: 'Pick an employee. Their work email becomes the username.',
      submit: 'Create login',
      fields:
        '<label>Employee<select id="cu-emp">' + unlinked.map(function (e) {
          return '<option value="' + esc(e.id) + '"' + (e.id === preselect ? ' selected' : '') + '>' + esc(e.fullName) + ' — ' + esc(e.designation) + ' (' + esc(e.email) + ')</option>';
        }).join('') + '</select></label>' +
        '<label>Role<select id="cu-role">' + roleOptions('employee') + '</select></label>',
      onSubmit: async function () {
        var result = await api.request('/admin/users', { method: 'POST', body: { employee: el('cu-emp').value, role: el('cu-role').value } });
        await loadUsers();
        showSecret(result.user, result.temporaryPassword, 'Login created');
      },
    });
  }

  function wireUsers() {
    el('user-new').addEventListener('click', function () { openCreate(); });
    el('users-unlinked').addEventListener('click', function (e) { if (e.target.closest('[data-open-create]')) openCreate(); });

    el('users-board').addEventListener('change', async function (event) {
      var select = event.target.closest('[data-role]');
      if (!select) return;
      try {
        await api.request('/admin/users/' + select.getAttribute('data-role'), { method: 'PATCH', body: { role: select.value } });
        toast('Role updated');
      } catch (err) {
        toast(err.message, 'error');
      }
      loadUsers();
    });

    el('users-board').addEventListener('click', function (event) {
      var reset = event.target.closest('[data-reset]');
      var toggle = event.target.closest('[data-toggle]');
      var unlock = event.target.closest('[data-unlock]');
      var revoke = event.target.closest('[data-revoke]');
      var find = function (id) { return users.filter(function (u) { return u.id === id; })[0]; };
      if (unlock) {
        api.request('/admin/users/' + unlock.getAttribute('data-unlock') + '/unlock', { method: 'POST' })
          .then(function () { toast('Account unlocked'); loadUsers(); })
          .catch(function (err) { toast(err.message, 'error'); });
      }
      if (revoke) {
        var who = find(revoke.getAttribute('data-revoke'));
        if (!window.confirm('Sign ' + who.fullName + ' out of every device? They will need to sign in again.')) return;
        api.request('/admin/users/' + who.id + '/revoke-sessions', { method: 'POST' })
          .then(function () { toast('All sessions ended for ' + who.fullName); })
          .catch(function (err) { toast(err.message, 'error'); });
      }
      if (reset) {
        var target = find(reset.getAttribute('data-reset'));
        if (!window.confirm('Reset the password for ' + target.fullName + '? They will be signed out of all sessions.')) return;
        api.request('/admin/users/' + target.id + '/reset-password', { method: 'POST' }).then(function (result) {
          openModal({ title: 'Password reset', fields: '', submit: '' });
          showSecret(result.user, result.temporaryPassword, 'Password reset');
          loadUsers();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
      if (toggle) {
        var u = find(toggle.getAttribute('data-toggle'));
        var verb = u.isActive ? 'Deactivate' : 'Reactivate';
        if (!window.confirm(verb + ' the login for ' + u.fullName + '?')) return;
        api.request('/admin/users/' + u.id, { method: 'PATCH', body: { isActive: !u.isActive } })
          .then(function () { toast(verb + 'd ' + u.fullName); loadUsers(); })
          .catch(function (err) { toast(err.message, 'error'); });
      }
    });
  }

  /* ---------- Departments ---------- */

  var depts = [];
  var clusters = [];

  function renderDepts() {
    el('dept-board').innerHTML = '<div class="overflow-x-auto"><table class="min-w-full text-sm"><thead><tr>' +
      '<th class="px-6 py-3.5 text-left">Department</th><th class="px-6 py-3.5 text-left">Cluster</th><th class="px-6 py-3.5 text-right">Active people</th>' +
      '<th class="px-6 py-3.5 text-left">Status</th><th class="px-6 py-3.5 text-right">Actions</th></tr></thead><tbody>' +
      depts.map(function (d) {
        return '<tr><td class="px-6 py-4"><span class="block font-medium text-slate-900">' + esc(d.name) + '</span><span class="block text-xs text-slate-400">' + esc(d.code) + '</span></td>' +
          '<td class="px-6 py-4 text-slate-600">' + esc(d.clusterName || '—') + '</td>' +
          '<td class="px-6 py-4 text-right tabular-nums">' + d.headcount + '</td>' +
          '<td class="px-6 py-4">' + (d.status === 'active' ? '<span class="pill ok">Active</span>' : '<span class="pill">Closed</span>') + '</td>' +
          '<td class="px-6 py-4 text-right"><button type="button" class="btn-ghost" data-rename="' + esc(d.id) + '">Rename</button>' +
          '<button type="button" class="btn-ghost" data-close="' + esc(d.id) + '">' + (d.status === 'active' ? 'Close' : 'Reopen') + '</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  async function loadDepts() {
    var payload = await api.get('/org/departments');
    depts = payload.departments || [];
    clusters = payload.clusters || [];
    renderDepts();
  }

  function wireDepts() {
    el('dept-new').addEventListener('click', function () {
      openModal({
        title: 'Add a department',
        submit: 'Add department',
        fields:
          '<label>Department name<input id="dp-name" maxlength="80" required /></label>' +
          '<label>Cluster / division<select id="dp-cluster">' + clusters.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('') +
          '<option value="">New cluster…</option></select></label>' +
          '<label id="dp-new-wrap" class="hidden">New cluster name<input id="dp-new" maxlength="80" /></label>',
        onSubmit: async function () {
          var cluster = el('dp-cluster').value;
          await api.request('/org/departments', { method: 'POST', body: { name: el('dp-name').value, cluster: cluster || undefined, clusterName: cluster ? undefined : el('dp-new').value } });
          closeModal();
          toast('Department added');
          loadDepts();
        },
      });
      var sync = function () { el('dp-new-wrap').classList.toggle('hidden', el('dp-cluster').value !== ''); };
      el('dp-cluster').addEventListener('change', sync);
      sync();
    });

    el('dept-board').addEventListener('click', function (event) {
      var rename = event.target.closest('[data-rename]');
      var close = event.target.closest('[data-close]');
      var find = function (id) { return depts.filter(function (d) { return d.id === id; })[0]; };
      if (rename) {
        var d = find(rename.getAttribute('data-rename'));
        openModal({
          title: 'Rename ' + d.name,
          sub: 'Everyone currently in this department moves to the new name.',
          submit: 'Rename',
          fields: '<label>New name<input id="dp-rename" maxlength="80" value="' + esc(d.name) + '" required /></label>',
          onSubmit: async function () {
            await api.request('/org/departments/' + d.id, { method: 'PATCH', body: { name: el('dp-rename').value } });
            closeModal();
            toast('Department renamed');
            loadDepts();
          },
        });
      }
      if (close) {
        var dept = find(close.getAttribute('data-close'));
        var next = dept.status === 'active' ? 'inactive' : 'active';
        api.request('/org/departments/' + dept.id, { method: 'PATCH', body: { status: next } })
          .then(function () { toast(next === 'inactive' ? 'Department closed' : 'Department reopened'); loadDepts(); })
          .catch(function (err) { toast(err.message, 'error'); });
      }
    });
  }

  /* ---------- Init ---------- */

  function init() {
    wireModal();
    wireUsers();
    wireDepts();
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
    document.querySelectorAll('.tab-btn').forEach(function (button) {
      button.addEventListener('click', function () {
        var tab = button.getAttribute('data-tab');
        if (tab === 'users') loadUsers().catch(function (err) { toast(err.message, 'error'); });
        if (tab === 'departments') loadDepts().catch(function (err) { toast(err.message, 'error'); });
      });
    });
    me = window.PortoHR.session.getUser();
  }

  init();
})(window, document);
