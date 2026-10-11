/* Reports: shared state, value formatting, tab routing and start-up. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var shell = window.PortoHR.shell;

  var R = (window.PortoHR.rep = {
    state: { user: null, isHr: false, meta: null, tz: 'UTC', tab: 'employee' },
    hooks: {},
  });
  var S = R.state;

  R.el = function (id) { return document.getElementById(id); };
  R.$ = function (sel, root) { return (root || document).querySelector(sel); };
  R.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  R.esc = function (value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  R.cap = function (text) { var s = String(text).replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); };

  R.toast = function (message, tone) {
    var node = document.createElement('div');
    node.className = 'max-w-sm rounded-lg border px-4 py-2.5 text-sm shadow-lg ' + (tone === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800');
    node.textContent = message;
    R.el('toasts').appendChild(node);
    window.setTimeout(function () { node.remove(); }, 4200);
  };

  /* ------------------------------------------------------------- formatting */

  var DAY = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' };

  R.fmtDate = function (key) {
    if (!key) return '—';
    var d = new Date(String(key).slice(0, 10) + 'T00:00:00Z');
    return isNaN(d.getTime()) ? String(key) : d.toLocaleDateString('en-GB', DAY);
  };
  R.fmtDateTime = function (iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: S.tz }) + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: S.tz });
  };
  R.fmtTime = function (iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: S.tz });
  };
  R.fmtNumber = function (n, fraction) {
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: fraction === undefined ? 2 : fraction });
  };

  function optionLabel(options, value) {
    var hit = (options || []).filter(function (o) { return (typeof o === 'object' ? o.value : o) === value; })[0];
    return hit && typeof hit === 'object' ? hit.label : null;
  }

  /** One cell as text. `type` is the column type the server declared. */
  R.fmt = function (type, value, extra) {
    if (value === null || value === undefined || value === '') return '—';
    switch (type) {
      case 'date': return R.fmtDate(value);
      case 'datetime': return R.fmtDateTime(value);
      case 'time': return R.fmtTime(value);
      case 'money': return (extra && extra.currency ? extra.currency + ' ' : '') + R.fmtNumber(value, 2);
      case 'hours': return R.fmtNumber(value, 2) + ' h';
      case 'percent': return R.fmtNumber(value, 1) + '%';
      case 'number': return R.fmtNumber(value, 2);
      case 'bool': return value === true || value === 'true' ? 'Yes' : 'No';
      case 'enum': return optionLabel(extra && extra.options, value) || R.cap(value);
      default: return String(value);
    }
  };

  R.isNumeric = function (type) { return ['number', 'money', 'hours', 'percent'].indexOf(type) !== -1; };

  /** The same value for a spreadsheet: raw numbers, ISO dates, plain text. */
  R.csvValue = function (type, value, extra) {
    if (value === null || value === undefined) return '';
    if (type === 'datetime') {
      var d = new Date(value);
      if (isNaN(d.getTime())) return value;
      var parts = {};
      new Intl.DateTimeFormat('en-GB', { timeZone: S.tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).forEach(function (p) { parts[p.type] = p.value; });
      return parts.year + '-' + parts.month + '-' + parts.day + ' ' + parts.hour + ':' + parts.minute;
    }
    if (type === 'time') return R.fmtTime(value);
    if (type === 'bool') return value === true ? 'Yes' : 'No';
    if (type === 'enum') return optionLabel(extra && extra.options, value) || R.cap(value);
    return value;
  };

  R.csvFile = function (filename, lines) {
    var cell = window.PortoHR.csv.cell;
    var blob = new Blob(['﻿' + lines.map(function (row) { return row.map(cell).join(','); }).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  };

  R.fileSafe = function (text) { return String(text || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'report'; };

  R.logUse = function (body) { api.post('/reports/log', body).catch(function () { /* the audit trail is best-effort */ }); };

  R.printNow = function () {
    // Give the browser a beat to apply any layout change before the dialog opens.
    window.setTimeout(function () { window.print(); }, 60);
  };

  /* -------------------------------------------------------------------- tabs */

  function setTab(tab, push) {
    S.tab = tab;
    R.$$('#r-tabs .rtab').forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-tab') === tab); });
    ['employee', 'library', 'builder'].forEach(function (name) { R.el('tab-' + name).classList.toggle('hidden', name !== tab); });
    if (push !== false) {
      try { window.history.replaceState(null, '', tab === 'employee' ? '#/employee' + (R.hooks.currentEmployeeId ? '/' + R.hooks.currentEmployeeId() : '') : '#/' + tab); } catch (err) { /* ignore */ }
    }
  }
  R.setTab = setTab;

  function routeFromHash() {
    var hash = window.location.hash || '';
    var match = /^#\/employee\/([A-Za-z0-9]+)/.exec(hash);
    if (match) { setTab('employee', false); if (R.hooks.openEmployee) R.hooks.openEmployee(match[1]); return; }
    if (hash.indexOf('#/library') === 0) return setTab('library', false);
    if (hash.indexOf('#/builder') === 0) return setTab('builder', false);
    setTab('employee', false);
  }

  /** Reloads the list of saved reports after one is saved or deleted. */
  R.reloadMeta = async function () {
    S.meta = await api.get('/reports/meta');
    if (R.hooks.metaChanged) R.hooks.metaChanged();
  };

  async function init() {
    var user = await shell.mount('reports');
    if (!user) return;
    S.user = user;
    S.isHr = user.role === 'hr_admin';
    S.canTeam = S.isHr || user.role === 'manager';

    S.meta = await api.get('/reports/meta');
    S.tz = S.meta.timezone || 'UTC';

    R.el('r-tabs').addEventListener('click', function (event) {
      var btn = event.target.closest('[data-tab]');
      if (btn) setTab(btn.getAttribute('data-tab'));
    });
    document.addEventListener('click', function (event) {
      var go = event.target.closest('[data-goto]');
      if (go) { event.preventDefault(); setTab(go.getAttribute('data-goto')); }
    });

    ['employee', 'builder'].forEach(function (name) { if (R.hooks['init_' + name]) R.hooks['init_' + name](); });
    if (R.hooks.init_library) R.hooks.init_library();
    window.addEventListener('hashchange', routeFromHash);
    routeFromHash();
  }

  R.start = function () {
    init().catch(function (err) {
      if (err && err.status === 401) return;
      R.toast((err && err.message) || 'Could not open Reports', 'error');
    });
  };

  // The tab scripts register their hooks first; start once the whole page has loaded.
  window.addEventListener('load', function () { R.start(); });
})(window, document);
