/* Core HR → Import employees from a CSV: check first, then create. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var session = window.PortoHR.session;
  var el = function (id) { return document.getElementById(id); };
  var parsedRows = [];

  var TEMPLATE_HEADER = ['employeeCode', 'firstName', 'lastName', 'email', 'designation', 'department', 'dateOfJoining', 'baseSalary', 'currency', 'phone', 'dateOfBirth', 'gender', 'fatherName', 'cnic', 'address', 'team', 'grade', 'employmentType', 'employeeCategory', 'location', 'shiftType', 'annualLeaveDays', 'reportsToCode'];
  var TEMPLATE_EXAMPLE = ['PH-2001', 'Sara', 'Khan', 'sara.khan@company.com', 'Financial Analyst', 'Finance', '15/01/2024', '85000', 'PKR', '0300-1234567', '12/05/1994', 'female', 'Imran Khan', '34101-7373600-0', 'House 5, Gulberg, Lahore', 'FP&A', 'M3', 'full_time', 'non_executive', 'Lahore', 'general', '20', ''];

  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** A small RFC 4180 parser: quoted fields, doubled quotes, embedded newlines, comma/semicolon/tab. */
  function parseCsv(text) {
    text = String(text || '').replace(/^﻿/, '');
    var first = text.split(/\r?\n/)[0] || '';
    var delimiter = [',', ';', '\t'].reduce(function (best, d) {
      return first.split(d).length > first.split(best).length ? d : best;
    }, ',');
    var rows = [];
    var row = [];
    var field = '';
    var quoted = false;
    for (var i = 0; i < text.length; i += 1) {
      var ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
        } else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delimiter) { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i += 1;
        row.push(field); field = '';
        if (row.some(function (c) { return String(c).trim() !== ''; })) rows.push(row);
        row = [];
      } else field += ch;
    }
    row.push(field);
    if (row.some(function (c) { return String(c).trim() !== ''; })) rows.push(row);
    if (rows.length < 2) return [];
    var header = rows[0].map(function (h) { return h.trim(); });
    return rows.slice(1).map(function (cells) {
      var obj = {};
      header.forEach(function (name, i) { if (name) obj[name] = cells[i] === undefined ? '' : cells[i]; });
      return obj;
    });
  }

  function csvCell(value) {
    var text = String(value === null || value === undefined ? '' : value);
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function downloadTemplate() {
    var blob = new Blob(['﻿' + TEMPLATE_HEADER.join(',') + '\r\n' + TEMPLATE_EXAMPLE.map(csvCell).join(',') + '\r\n'], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'employee-import-template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function showError(message) {
    var box = el('import-error');
    box.textContent = message;
    box.classList.toggle('hidden', !message);
  }

  function open() {
    parsedRows = [];
    el('import-file').value = '';
    el('import-paste').value = '';
    showError('');
    el('import-step-file').classList.remove('hidden');
    el('import-step-preview').classList.add('hidden');
    el('import-modal').classList.remove('hidden');
  }

  function close() {
    var done = el('import-modal').dataset.done;
    el('import-modal').classList.add('hidden');
    if (done) { el('import-modal').dataset.done = ''; window.location.reload(); }
  }

  function resultRows(rows) {
    return '<div class="overflow-auto rounded-xl border" style="max-height:20rem;border-color:var(--border)"><table class="min-w-full text-xs"><thead><tr>' +
      '<th class="px-3 py-2 text-left">Line</th><th class="px-3 py-2 text-left">Code</th><th class="px-3 py-2 text-left">Name</th><th class="px-3 py-2 text-left">Result</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var notes = (r.errors || []).map(function (e) { return '<li class="text-red-600">' + esc(e) + '</li>'; }).concat((r.warnings || []).map(function (w) { return '<li class="text-amber-600">' + esc(w) + '</li>'; })).join('');
        var pill = r.created ? '<span class="pill ok">Created</span>' : r.ok ? '<span class="pill ok">Ready</span>' : '<span class="pill bad">Fix</span>';
        return '<tr><td class="px-3 py-2 align-top text-slate-400">' + r.line + '</td><td class="px-3 py-2 align-top font-medium">' + esc(r.employeeCode) + '</td><td class="px-3 py-2 align-top">' + esc(r.name) + '</td>' +
          '<td class="px-3 py-2 align-top">' + pill + (notes ? '<ul class="mt-1 list-disc pl-4">' + notes + '</ul>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function renderPreview(result) {
    var host = el('import-step-preview');
    var missing = result.missingDepartments || [];
    var allowDepartments = el('import-new-depts') ? el('import-new-depts').checked : false;
    host.innerHTML =
      '<div class="flex flex-wrap items-center gap-3 text-sm"><b>' + result.total + ' rows</b>' +
      '<span class="pill ok">' + result.valid + ' ready</span>' +
      (result.total - result.valid ? '<span class="pill bad">' + (result.total - result.valid) + ' need fixing</span>' : '') + '</div>' +
      '<label class="flex items-center gap-2" style="display:flex"><input id="import-new-depts" type="checkbox" class="chk" style="width:1rem;height:1rem;padding:0" ' + (allowDepartments ? 'checked' : '') + ' /> <span>Create departments that do not exist yet</span></label>' +
      resultRows(result.rows) +
      '<div id="import-error2" class="modal-error hidden"></div>' +
      '<div class="modal-actions"><button id="import-back" type="button" class="btn btn-secondary">Choose another file</button>' +
      '<button id="import-go" type="button" class="btn btn-primary"' + (result.valid ? '' : ' disabled') + '>Import ' + result.valid + ' employee' + (result.valid === 1 ? '' : 's') + '</button></div>';
    el('import-new-depts').addEventListener('change', function () { check(); });
    el('import-back').addEventListener('click', function () { el('import-step-preview').classList.add('hidden'); el('import-step-file').classList.remove('hidden'); });
    el('import-go').addEventListener('click', commit);
  }

  function options(commit) {
    var box = el('import-new-depts');
    return { rows: parsedRows, commit: commit, createMissingDepartments: Boolean(box && box.checked) };
  }

  async function check() {
    try {
      var result = await api.request('/employees/import', { method: 'POST', body: options(false) });
      el('import-step-file').classList.add('hidden');
      el('import-step-preview').classList.remove('hidden');
      renderPreview(result);
    } catch (err) {
      showError(err.message || 'Could not check the file');
    }
  }

  async function commit() {
    var button = el('import-go');
    button.disabled = true;
    button.textContent = 'Importing…';
    try {
      var result = await api.request('/employees/import', { method: 'POST', body: options(true) });
      el('import-modal').dataset.done = '1';
      var host = el('import-step-preview');
      host.innerHTML =
        '<div class="flex flex-wrap items-center gap-3 text-sm"><span class="pill ok">' + result.created + ' employees created</span>' +
        (result.failed ? '<span class="pill bad">' + result.failed + ' not created</span>' : '') + '</div>' +
        resultRows(result.rows) +
        '<div class="modal-actions"><button id="import-done" type="button" class="btn btn-primary">Done</button></div>';
      el('import-done').addEventListener('click', close);
    } catch (err) {
      var box = el('import-error2');
      box.textContent = err.message || 'The import failed';
      box.classList.remove('hidden');
      button.disabled = false;
      button.textContent = 'Try again';
    }
  }

  async function onCheck() {
    showError('');
    var file = el('import-file').files[0];
    var text = el('import-paste').value;
    if (file) text = await file.text();
    parsedRows = parseCsv(text);
    if (!parsedRows.length) return showError('No rows found. The first line must be the column headings, followed by one line per employee.');
    check();
  }

  function mount() {
    var user = session.getUser();
    var anchor = document.getElementById('btn-new-employee');
    if (!anchor || !user || user.role !== 'hr_admin') return;
    var button = document.createElement('button');
    button.type = 'button';
    button.id = 'btn-import';
    button.className = 'inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50';
    button.innerHTML = '<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>Import';
    var group = document.createElement('div');
    group.className = 'flex flex-wrap items-center gap-2';
    anchor.parentNode.insertBefore(group, anchor);
    group.appendChild(button);
    group.appendChild(anchor);
    button.addEventListener('click', open);
  }

  el('import-close').addEventListener('click', close);
  el('import-template').addEventListener('click', downloadTemplate);
  el('import-check').addEventListener('click', onCheck);
  el('import-modal').addEventListener('mousedown', function (e) { if (e.target === el('import-modal')) close(); });

  // The directory button is revealed once the session is verified.
  var tries = 0;
  var timer = window.setInterval(function () {
    tries += 1;
    if (document.getElementById('btn-new-employee') && window.PortoHR.session.getUser()) { window.clearInterval(timer); mount(); }
    if (tries > 40) window.clearInterval(timer);
  }, 150);
})(window, document);
