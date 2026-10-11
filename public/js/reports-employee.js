/* Reports: the full report for one employee, and the same report for a whole team. */
(function (window, document) {
  'use strict';

  var R = window.PortoHR.rep;
  var api = window.PortoHR.api;
  var S = R.state;
  var el = R.el;
  var esc = R.esc;

  var E = { person: null, report: null, picked: null, searchTimer: null, busy: false };

  function initials(name) {
    return String(name || '?').split(' ').filter(Boolean).slice(0, 2).map(function (p) { return p[0].toUpperCase(); }).join('');
  }

  /* ------------------------------------------------------------- drawing a report */

  function summaryHtml(items) {
    if (!items.length) return '';
    return '<dl class="rsum">' + items.map(function (it) {
      var cls = (it.strong ? 'strong ' : '') + (it.tone ? 'tone-' + it.tone : '');
      return '<div class="' + cls + '"><dt>' + esc(it.label) + '</dt><dd>' + esc(R.fmt(it.type, it.value, { currency: it.currency })) + '</dd></div>';
    }).join('') + '</dl>';
  }

  function tableHtml(t) {
    if (!t.rows.length) return '<p class="rtbl-none"><b>' + esc(t.title) + ':</b> none on record.</p>';
    var head = t.columns.map(function (c) { return '<th class="' + (R.isNumeric(c.type) ? 'n' : '') + '">' + esc(c.label) + '</th>'; }).join('');
    var body = t.rows.map(function (row) {
      return '<tr>' + t.columns.map(function (c) {
        var value = row[c.key];
        var empty = value === null || value === undefined || value === '';
        return '<td class="' + (R.isNumeric(c.type) ? 'n ' : '') + (empty ? 'nil' : '') + '">' + esc(R.fmt(c.type, value, { currency: t.currency })) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<h4 class="rtbl-title">' + esc(t.title) + '</h4>' + (t.note ? '<p class="rnote">' + esc(t.note) + '</p>' : '') +
      '<div class="rtbl-wrap"><table class="rtbl"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function sectionHtml(sec, prefix) {
    return '<section class="rsec" id="' + prefix + sec.key + '"><h3>' + esc(sec.title) + '</h3>' +
      (sec.note ? '<p class="rnote">' + esc(sec.note) + '</p>' : '') +
      summaryHtml(sec.summary || []) + (sec.tables || []).map(tableHtml).join('') + '</section>';
  }

  function reportHtml(report, prefix, withJump) {
    var emp = report.employee;
    var jump = withJump ? '<nav class="rep-jump no-print" aria-label="Jump to a section">' + report.sections.map(function (s) { return '<a href="#' + prefix + s.key + '" data-jump="' + prefix + s.key + '">' + esc(s.title) + '</a>'; }).join('') + '</nav>' : '';
    return '<article class="rep-doc">' +
      '<header class="rep-head"><div class="rep-avatar">' + esc(initials(emp.name)) + '</div>' +
      '<div><h2>' + esc(emp.name) + '</h2><p>' + esc([emp.code, emp.designation, emp.department].filter(Boolean).join(' · ')) + (emp.status ? ' · ' + esc(emp.status) : '') + '</p></div>' +
      '<div class="rep-meta">Period: ' + esc(R.fmtDate(report.period.from)) + ' – ' + esc(R.fmtDate(report.period.to)) + '<br />Prepared ' + esc(R.fmtDateTime(report.generatedAt)) + '<br />' + esc(report.viewer.scope) + ' view</div></header>' +
      jump + report.sections.map(function (s) { return sectionHtml(s, prefix); }).join('') + '</article>';
  }

  /* ---------------------------------------------------------------- spreadsheet */

  function reportLines(report) {
    var lines = [
      ['Employee report'],
      ['Name', report.employee.name], ['Employee code', report.employee.code], ['Designation', report.employee.designation], ['Department', report.employee.department],
      ['Period', report.period.from + ' to ' + report.period.to], ['Prepared', R.csvValue('datetime', report.generatedAt)], [],
    ];
    report.sections.forEach(function (sec) {
      lines.push([sec.title.toUpperCase()]);
      (sec.summary || []).forEach(function (it) { lines.push([it.label, R.csvValue(it.type, it.value)]); });
      (sec.tables || []).forEach(function (t) {
        if (!t.rows.length) return;
        lines.push([]);
        lines.push([t.title]);
        lines.push(t.columns.map(function (c) { return c.label; }));
        t.rows.forEach(function (row) { lines.push(t.columns.map(function (c) { return R.csvValue(c.type, row[c.key]); })); });
      });
      lines.push([]);
    });
    return lines;
  }

  /* ------------------------------------------------------------ choosing a period */

  function periodQuery() {
    var preset = el('emp-preset').value;
    if (preset === 'custom') {
      var from = el('emp-from').value;
      var to = el('emp-to').value;
      return from || to ? '&from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to) : '';
    }
    return preset === 'this_year' ? '' : '&preset=' + preset;
  }

  function chosenSections() {
    var boxes = R.$$('#emp-sections input');
    var on = boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; });
    el('emp-sections-count').textContent = boxes.length ? '(' + on.length + ' of ' + boxes.length + ')' : '';
    return on.length === boxes.length ? '' : on.join(',');
  }

  function drawSectionChoices(sections, keepOff) {
    el('emp-sections').innerHTML = sections.map(function (s) {
      return '<label class="rchip"><input type="checkbox" value="' + esc(s.key) + '"' + (keepOff && keepOff.indexOf(s.key) !== -1 ? '' : ' checked') + ' /> ' + esc(s.title) + '</label>';
    }).join('');
    chosenSections();
  }

  /* ----------------------------------------------------------------- the report */

  function queryString() {
    var sections = chosenSections();
    return '?x=1' + periodQuery() + (sections ? '&sections=' + encodeURIComponent(sections) : '');
  }

  async function build() {
    if (!E.person || E.busy) return;
    E.busy = true;
    el('emp-run').disabled = true;
    el('emp-status').textContent = 'Building the report…';
    try {
      var res = await api.get('/reports/employee/' + E.person.id + queryString());
      var off = R.$$('#emp-sections input').filter(function (b) { return !b.checked; }).map(function (b) { return b.value; });
      drawSectionChoices(res.report.available, off);
      E.report = res.report;
      E.person.name = res.report.employee.name;
      E.person.code = res.report.employee.code;
      drawChip();
      el('emp-out').innerHTML = reportHtml(res.report, 'sec-', true);
      ['emp-print', 'emp-csv', 'emp-link'].forEach(function (id) { el(id).classList.remove('hidden'); });
      el('emp-status').textContent = '';
      try { window.history.replaceState(null, '', '#/employee/' + E.person.id); } catch (err) { /* ignore */ }
    } catch (err) {
      el('emp-out').innerHTML = '<div class="rbanner bad">' + esc(err.message || 'Could not build the report') + '</div>';
      el('emp-status').textContent = '';
    } finally {
      E.busy = false;
      el('emp-run').disabled = false;
    }
  }

  function drawChip() {
    var p = E.person;
    el('emp-chip').innerHTML = '<span class="rchosen">' + esc(p.name) + (p.code ? ' · ' + esc(p.code) : '') + '<button type="button" data-clear aria-label="Choose someone else">&times;</button></span>';
    el('emp-chip').classList.remove('hidden');
  }

  function choose(person) {
    E.person = person;
    drawChip();
    el('emp-pick').classList.add('hidden');
    el('emp-results').classList.add('hidden');
    el('emp-q').value = '';
    el('emp-run').disabled = false;
    build();
  }

  function clearChoice() {
    E.person = null;
    el('emp-chip').classList.add('hidden');
    el('emp-pick').classList.remove('hidden');
    el('emp-run').disabled = true;
    ['emp-print', 'emp-csv', 'emp-link'].forEach(function (id) { el(id).classList.add('hidden'); });
    el('emp-out').innerHTML = '';
    try { window.history.replaceState(null, '', '#/employee'); } catch (err) { /* ignore */ }
    el('emp-q').focus();
  }

  async function search() {
    var q = el('emp-q').value.trim();
    var list = el('emp-results');
    try {
      var res = await api.get('/reports/people?limit=10&q=' + encodeURIComponent(q));
      list.innerHTML = res.people.length ? res.people.map(function (p) {
        return '<button type="button" data-person=\'' + esc(JSON.stringify(p)) + '\'>' + esc(p.name) + '<small>' + esc(p.code + ' · ' + (p.designation || '') + (p.department ? ' · ' + p.department : '')) + '</small></button>';
      }).join('') : '<button type="button" disabled>Nobody matches that</button>';
      list.classList.remove('hidden');
    } catch (err) { list.classList.add('hidden'); }
  }

  /** Open someone's report from a link (#/employee/<id>) or from another tab. */
  async function open(id) {
    if (E.person && E.person.id === id) return;
    // The name and code are filled in from the report itself once it arrives.
    choose({ id: id, name: 'Loading…', code: '' });
  }

  /* ------------------------------------------------------------------ team batch */

  async function buildTeam() {
    var dept = el('bulk-dept').value;
    var status = el('bulk-status');
    var out = el('bulk-out');
    el('bulk-go').disabled = true;
    el('bulk-print').classList.add('hidden');
    out.innerHTML = '';
    try {
      var res = await api.get('/reports/people?active=1&limit=50' + (dept ? '&department=' + encodeURIComponent(dept) : ''));
      var people = res.people;
      if (!people.length) { status.textContent = 'Nobody to report on.'; return; }
      var qs = queryString();
      var html = new Array(people.length);
      var next = 0;
      var done = 0;
      var worker = async function () {
        while (next < people.length) {
          var i = next;
          next += 1;
          try {
            // eslint-disable-next-line no-await-in-loop
            var r = await api.get('/reports/employee/' + people[i].id + qs);
            html[i] = reportHtml(r.report, 'b' + i + '-', false);
          } catch (err) {
            html[i] = '<div class="rbanner bad">' + esc(people[i].name) + ': ' + esc(err.message || 'could not be built') + '</div>';
          }
          done += 1;
          status.textContent = 'Built ' + done + ' of ' + people.length + '…';
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      out.innerHTML = html.join('');
      status.textContent = people.length + ' report' + (people.length === 1 ? '' : 's') + ' ready. Each starts on its own page when printed.';
      el('bulk-print').classList.remove('hidden');
      R.logUse({ kind: 'builder', dataset: 'employee_reports', name: 'Team reports: ' + (dept || 'everyone'), format: 'print', rowCount: people.length });
    } catch (err) {
      status.textContent = err.message || 'Could not build the reports.';
    } finally {
      el('bulk-go').disabled = false;
    }
  }

  /* ------------------------------------------------------------------------ wiring */

  function wire() {
    el('emp-q').addEventListener('input', function () { window.clearTimeout(E.searchTimer); E.searchTimer = window.setTimeout(search, 220); });
    el('emp-q').addEventListener('focus', search);
    el('emp-results').addEventListener('click', function (event) {
      var b = event.target.closest('[data-person]');
      if (b) choose(JSON.parse(b.getAttribute('data-person')));
    });
    el('emp-chip').addEventListener('click', function (event) { if (event.target.closest('[data-clear]')) clearChoice(); });
    document.addEventListener('click', function (event) { if (!event.target.closest('#emp-pick')) el('emp-results').classList.add('hidden'); });

    el('emp-preset').addEventListener('change', function () {
      var custom = el('emp-preset').value === 'custom';
      el('emp-custom').classList.toggle('hidden', !custom);
      if (!custom) build();
    });
    ['emp-from', 'emp-to'].forEach(function (id) { el(id).addEventListener('change', function () { if (el('emp-from').value && el('emp-to').value) build(); }); });
    el('emp-sections').addEventListener('change', function () { chosenSections(); });
    el('emp-run').addEventListener('click', build);

    el('emp-print').addEventListener('click', function () {
      if (!E.report) return;
      R.logUse({ kind: 'employee', employeeId: E.report.employee.id, format: 'print', sections: E.report.sections.map(function (s) { return s.key; }), period: E.report.period.from + ' to ' + E.report.period.to });
      document.body.classList.add('printing-single');
      R.printNow();
      window.setTimeout(function () { document.body.classList.remove('printing-single'); }, 800);
    });
    el('emp-csv').addEventListener('click', function () {
      if (!E.report) return;
      R.logUse({ kind: 'employee', employeeId: E.report.employee.id, format: 'csv', sections: E.report.sections.map(function (s) { return s.key; }), period: E.report.period.from + ' to ' + E.report.period.to });
      R.csvFile('employee-report-' + R.fileSafe(E.report.employee.code + '-' + E.report.employee.name) + '.csv', reportLines(E.report));
    });
    el('emp-link').addEventListener('click', function () {
      var url = window.location.origin + '/reports.html#/employee/' + E.report.employee.id;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { R.toast('Link copied'); }).catch(function () { window.prompt('Copy this link', url); });
    });

    el('emp-out').addEventListener('click', function (event) {
      var link = event.target.closest('[data-jump]');
      if (!link) return;
      event.preventDefault();
      var target = document.getElementById(link.getAttribute('data-jump'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    el('bulk-go').addEventListener('click', buildTeam);
    el('bulk-print').addEventListener('click', function () {
      document.body.classList.add('printing-bulk');
      R.printNow();
      window.setTimeout(function () { document.body.classList.remove('printing-bulk'); }, 800);
    });
  }

  async function init() {
    wire();
    drawSectionChoices(S.meta.employeeSections.filter(function (s) { return S.isHr || ['cases', 'audit'].indexOf(s.key) === -1; }), []);

    if (S.canTeam) {
      el('bulk').classList.remove('hidden');
      try {
        var values = await api.get('/reports/datasets/employees/values?column=department');
        el('bulk-dept').innerHTML = '<option value="">Everyone I can see (up to 50)</option>' + values.values.map(function (v) { return '<option>' + esc(v) + '</option>'; }).join('');
      } catch (err) { el('bulk-dept').innerHTML = '<option value="">Everyone I can see (up to 50)</option>'; }
    }

    if (!S.canTeam) {
      // An employee can only report on themselves, so skip the search and show it.
      el('emp-pick').classList.add('hidden');
      try {
        var mine = await api.get('/reports/people?limit=1');
        if (mine.people.length && !/^#\/employee\//.test(window.location.hash)) choose(mine.people[0]);
        else if (!mine.people.length) el('emp-out').innerHTML = '<div class="rbanner warn">Your login is not linked to an employee record yet, so there is no report to show. Ask HR to link it.</div>';
      } catch (err) { /* the message shows when a build is attempted */ }
    }
  }

  R.hooks.init_employee = init;
  R.hooks.openEmployee = open;
  R.hooks.currentEmployeeId = function () { return E.person ? E.person.id : ''; };
})(window, document);
