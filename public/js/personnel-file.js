/* Core HR: the personnel file tab, laid out like the paper file HR offices keep. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var state = { host: null, id: null, file: null, year: null };

  function esc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function date(key) {
    if (!key) return '';
    var d = new Date(String(key).slice(0, 10) + 'T00:00:00Z');
    return isNaN(d.getTime()) ? esc(key) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  function num(n) { return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
  function show(v) { return v === null || v === undefined || v === '' ? '<span class="pf-nil">—</span>' : esc(v); }

  /* ------------------------------------------------------------- pieces */

  function dl(items) {
    return '<dl class="pf-dl">' + items.map(function (i) {
      return '<div><dt>' + esc(i[0]) + '</dt><dd>' + (i[2] ? i[1] : show(i[1])) + '</dd></div>';
    }).join('') + '</dl>';
  }

  /** A numbered table. `cols` are [label, key | function(row), 'n' for numeric]. */
  function table(cols, rows, opts) {
    opts = opts || {};
    if (!rows.length) return '<p class="pf-empty">' + esc(opts.empty || 'Nothing on record.') + '</p>';
    var head = '<th class="n">Sr#</th>' + cols.map(function (c) { return '<th class="' + (c[2] || '') + '">' + esc(c[0]) + '</th>'; }).join('') + (opts.remove ? '<th class="pf-x"></th>' : '');
    var body = rows.map(function (r, i) {
      return '<tr><td class="n">' + (i + 1) + '</td>' + cols.map(function (c) {
        var v = typeof c[1] === 'function' ? c[1](r) : r[c[1]];
        return '<td class="' + (c[2] || '') + '">' + (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? esc(date(v)) : show(v)) + '</td>';
      }).join('') + (opts.remove ? '<td class="pf-x">' + (r.source === 'manual' && state.file.canEdit ? '<button type="button" class="pf-del" data-del="' + opts.remove + '" data-id="' + esc(r.id) + '" title="Remove this entry" aria-label="Remove this entry">&times;</button>' : (r.source === 'system' || r.source === 'case' ? '<span class="pf-auto" title="Taken from the system records">auto</span>' : '')) + '</td>' : '') + '</tr>';
    }).join('');
    return '<div class="pf-wrap"><table class="pf-tbl"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function block(title, inner, action) {
    return '<section class="pf-block"><header><h3>' + esc(title) + '</h3>' + (action || '') + '</header>' + inner + '</section>';
  }
  var addBtn = function (list, label) { return state.file.canEdit ? '<button type="button" class="pf-add" data-add="' + list + '">+ ' + esc(label) + '</button>' : ''; };

  /* ------------------------------------------------------------- drawing */

  function draw() {
    var f = state.file;
    var b = f.basic;
    var years = [];
    var thisYear = new Date().getFullYear();
    for (var y = thisYear; y >= thisYear - 5; y -= 1) years.push(y);
    var salary = b.currentSalary ? b.currentSalary.currency + ' ' + num(b.currentSalary.amount) + ' basic · ' + num(b.currentSalary.gross) + ' gross' : null;

    var html = '<div class="pf-bar no-print"><h2>Personnel file</h2><span class="pf-grow"></span>' +
      '<label class="pf-year">Year <select data-year>' + years.map(function (y) { return '<option' + (y === f.year ? ' selected' : '') + '>' + y + '</option>'; }).join('') + '</select></label>' +
      (f.canEdit ? '<button type="button" class="btn btn-secondary btn-sm" data-edit-details>Edit file details</button>' : '') +
      '<button type="button" class="btn btn-secondary btn-sm" data-print>Print file</button></div>';

    html += block('Basic employee profile', dl([
      ['Name', b.name], ['Employee #', b.employeeNo], ['Legacy code', b.legacyCode], ['Unit code', b.unitCode], ['D.O.J.', date(b.dateOfJoining), true],
      ['Grade', b.grade], ['Current salary', salary], ['Father / husband name', b.fatherName], ['Designation', b.designation], ['Division', b.division],
      ['Department', b.department], ['Section', b.section], ['Employment category', b.employmentCategory], ['Status', b.status],
    ]));

    html += block('Promotion record', table([['Date', 'date'], ['Old designation', 'oldDesignation'], ['New designation', 'newDesignation']], f.promotions, { remove: 'promotions', empty: 'No promotions recorded.' }), addBtn('promotions', 'Add promotion'));
    html += block('Qualification', table([['Qualification', 'qualification'], ['Degree / category', 'category'], ['Discipline / subject', 'discipline'], ['Division', 'division'], ['Year', 'year'], ['Institution', 'institution'], ['Preference', 'preference']], f.qualifications, { empty: 'No qualifications recorded. Add them on the Education & career tab.' }));
    html += block('Experience', table([['Organization', 'organization'], ['From', 'from'], ['To', 'to'], ['Designation', 'designation'], ['Leaving cause', 'leavingCause'], ['Brief description', 'description']], f.experience, { empty: 'No previous experience recorded. Add it on the Education & career tab.' }));
    html += block('Transfer record', table([['Date', 'date'], ['From section', 'fromSection'], ['To section', 'toSection']], f.transfers, { remove: 'transfers', empty: 'No transfers recorded.' }), addBtn('transfers', 'Add transfer'));
    if (f.discipline) html += block('Discipline record', table([['Description', 'description'], ['Decision', 'decision'], ['Date', 'date']], f.discipline, { remove: 'discipline', empty: 'No discipline records.' }), addBtn('discipline', 'Add record'));
    html += block('Employee reward', table([['Awarding authority', 'authority'], ['Description / reward', 'description'], ['Date', 'date']], f.rewards, { empty: 'No rewards recorded.' }));

    var lv = f.leave;
    html += block('Leave record ' + lv.year, lv.rows.length
      ? '<div class="pf-wrap"><table class="pf-tbl"><thead><tr><th>Detail</th>' + lv.rows.map(function (r) { return '<th class="n">' + esc(r.type) + '</th>'; }).join('') + '<th class="n">Total leave</th></tr></thead><tbody>' +
        '<tr><td>Entitled</td>' + lv.rows.map(function (r) { return '<td class="n">' + num(r.entitled) + '</td>'; }).join('') + '<td class="n">' + num(lv.total.entitled) + '</td></tr>' +
        '<tr><td>Availed</td>' + lv.rows.map(function (r) { return '<td class="n">' + num(r.availed) + '</td>'; }).join('') + '<td class="n">' + num(lv.total.availed) + '</td></tr>' +
        '<tr class="pf-strong"><td>Balance</td>' + lv.rows.map(function (r) { return '<td class="n">' + num(r.balance) + '</td>'; }).join('') + '<td class="n">' + num(lv.total.balance) + '</td></tr></tbody></table></div>'
      : '<p class="pf-empty">No leave types apply.</p>');

    if (f.family) html += block('Family status', table([['Name', 'name'], ['Relation', 'relation'], ['Age', 'age', 'n'], ['Occupation', 'occupation'], ['Dependent', function (r) { return r.dependent ? 'Yes' : 'No'; }]], f.family, { empty: 'No family members recorded. Add them on the Family tab.' }));
    html += block('Training', table([['From', 'from'], ['To', 'to'], ['Institute', 'institute'], ['Description', 'description']], f.training, { remove: 'training', empty: 'No training recorded.' }), addBtn('training', 'Add training'));

    if (f.personal) {
      var p = f.personal;
      html += block('Personal record', dl([
        ['CNIC', p.cnic], ['Date of birth', date(p.dateOfBirth), true], ['Shift', p.shift], ['Blood group', p.bloodGroup], ['Confirmation date', date(p.confirmationDate), true],
        ['Marriage date', date(p.marriageDate), true], ['Approval date', date(p.approvalDate), true], ['EOBI #', p.eobiNo], ['Joined as', p.joinedAs], ['S.S.N. #', p.ssn],
        ['Gender', p.gender], ['Rest day', p.restDay], ['Group insurance', p.groupInsurance], ['PF entitled date', date(p.pfEntitledDate), true],
        ['Permanent address', p.permanentAddress], ['Postal address', p.postalAddress], ['Contact number', p.contactNumber],
      ]));
    }

    var a = f.annual;
    html += block('Annual record ' + a.year, dl([
      ['Total days', num(a.totalDays)], ['Working days', num(a.workingDays)], ['Leaves', num(a.leaves)], ['Absents', num(a.absents)], ['LWP', num(a.lwp)],
      ['Attendance %', a.attendancePercent === null ? null : a.attendancePercent + '%'],
    ]));

    if (f.personal) {
      var pay = f.payment;
      html += block('Payment details', pay ? dl([['Pay method', pay.payMethod], ['Bank', pay.bank], ['Branch', pay.branch], ['City', pay.city], ['ACC#', pay.accountNo]]) : '<p class="pf-empty">No payment account on record.</p>');
      html += block('Nominations of heirs', table([['Full name', 'fullName'], ['Father name', 'fatherName'], ['Husband name', 'husbandName'], ['Relation', 'relation'], ['Share (%)', 'share', 'n']], f.heirs, { remove: 'heirs', empty: 'No heirs nominated.' }), addBtn('heirs', 'Add heir'));
    }

    state.host.innerHTML = '<div class="pf">' + html + '</div>';
  }

  /* ------------------------------------------------------------- forms */

  var FORMS = {
    details: { title: 'Edit file details', fields: [['legacyCode', 'Legacy code'], ['unitCode', 'Unit code'], ['division', 'Division'], ['section', 'Section', 'text', 'Changing the section records a transfer automatically.'], ['joinedAs', 'Joined as'], ['groupInsurance', 'Group insurance (policy / status)'], ['contactNumber', 'Contact number'], ['marriageDate', 'Marriage date', 'date'], ['approvalDate', 'Approval date', 'date'], ['pfEntitledDate', 'PF entitled date', 'date'], ['postalAddress', 'Postal address', 'textarea']] },
    promotions: { title: 'Add a promotion', fields: [['date', 'Date', 'date'], ['oldDesignation', 'Old designation'], ['newDesignation', 'New designation']] },
    transfers: { title: 'Add a transfer', fields: [['date', 'Date', 'date'], ['fromSection', 'From section'], ['toSection', 'To section']] },
    discipline: { title: 'Add a discipline record', fields: [['date', 'Date', 'date'], ['description', 'Description', 'textarea'], ['decision', 'Decision']] },
    training: { title: 'Add training', fields: [['from', 'From', 'date'], ['to', 'To', 'date'], ['institute', 'Institute'], ['description', 'Description', 'textarea']] },
    heirs: { title: 'Add an heir', fields: [['fullName', 'Full name'], ['fatherName', 'Father name'], ['husbandName', 'Husband name'], ['relation', 'Relation'], ['share', 'Share (%)', 'number']] },
  };

  function openForm(kind) {
    var def = FORMS[kind];
    var current = kind === 'details' ? state.file.details || {} : {};
    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = '<form class="modal-box" novalidate><h2>' + esc(def.title) + '</h2><div class="modal-error hidden" data-err role="alert"></div>' +
      def.fields.map(function (f) {
        var type = f[2] || 'text';
        var v = current[f[0]] || '';
        var input = type === 'textarea' ? '<textarea name="' + f[0] + '" rows="3" maxlength="400">' + esc(v) + '</textarea>' : '<input name="' + f[0] + '" type="' + type + '"' + (type === 'number' ? ' min="0" max="100" step="any"' : '') + ' value="' + esc(v) + '" />';
        return '<label>' + esc(f[1]) + input + (f[3] ? '<span class="pf-hint">' + esc(f[3]) + '</span>' : '') + '</label>';
      }).join('') + '<div class="modal-actions"><button type="button" class="btn btn-secondary" data-cancel>Cancel</button><button type="submit" class="btn btn-primary">Save</button></div></form>';
    document.body.appendChild(modal);
    var form = modal.querySelector('form');
    var close = function () { modal.remove(); };
    modal.querySelector('[data-cancel]').addEventListener('click', close);
    modal.addEventListener('mousedown', function (e) { if (e.target === modal) close(); });
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var body = {};
      Array.prototype.forEach.call(form.elements, function (el) { if (el.name) body[el.name] = el.value; });
      try {
        var res = kind === 'details'
          ? await api.request('/employees/' + state.id + '/personnel-file?year=' + state.year, { method: 'PUT', body: body })
          : await api.post('/employees/' + state.id + '/personnel-file/' + kind + '?year=' + state.year, body);
        state.file = res.file;
        close();
        draw();
      } catch (err) {
        var box = modal.querySelector('[data-err]');
        box.textContent = (err.details && err.details.length ? err.details.map(function (d) { return d.message; }).join(' · ') : err.message) || 'Could not save';
        box.classList.remove('hidden');
      }
    });
    var first = form.querySelector('input, textarea');
    if (first) first.focus();
  }

  /* ------------------------------------------------------------- printing */

  var PRINT_CSS = 'body{font:12px/1.4 system-ui,sans-serif;color:#111;margin:18px}h1{font-size:18px;margin:0 0 2px}h3{font-size:13px;margin:16px 0 4px;border-bottom:1px solid #999;padding-bottom:2px;text-transform:uppercase;letter-spacing:.04em}' +
    '.pf-dl{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 14px;margin:0}.pf-dl div{break-inside:avoid}.pf-dl dt{font-size:10px;text-transform:uppercase;color:#555}.pf-dl dd{margin:0;font-weight:600}' +
    'table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #bbb;padding:3px 5px;text-align:left}th{background:#eee;font-size:10px;text-transform:uppercase}.n{text-align:right}.pf-nil{color:#888}.pf-x,.pf-add,.pf-bar{display:none}.pf-empty{color:#666;margin:2px 0}section{break-inside:avoid}';

  function print() {
    var w = window.open('', '_blank');
    if (!w) { window.alert('Allow pop-ups for this site to print the file.'); return; }
    var clone = state.host.querySelector('.pf').cloneNode(true);
    Array.prototype.forEach.call(clone.querySelectorAll('.no-print, .pf-del, .pf-auto, .pf-add'), function (n) { n.remove(); });
    w.document.write('<!doctype html><title>Personnel file ' + esc(state.file.basic.employeeNo) + '</title><style>' + PRINT_CSS + '</style><h1>Personnel file: ' + esc(state.file.basic.name) + ' (' + esc(state.file.basic.employeeNo) + ')</h1><p>Printed ' + new Date().toLocaleString('en-GB') + '</p>' + clone.innerHTML);
    w.document.close();
    w.focus();
    w.print();
  }

  /* ------------------------------------------------------------- wiring */

  async function load() {
    try {
      var res = await api.get('/employees/' + state.id + '/personnel-file' + (state.year ? '?year=' + state.year : ''));
      state.file = res.file;
      state.year = res.file.year;
      draw();
    } catch (err) {
      state.host.innerHTML = '<p class="pf-empty">' + esc(err.message || 'Could not load the personnel file.') + '</p>';
    }
  }

  function mount(host, employeeId) {
    state.host = host;
    state.id = employeeId;
    state.year = null;
    host.innerHTML = '<p class="pf-empty">Loading the personnel file…</p>';
    host.addEventListener('click', async function (event) {
      if (event.target.closest('[data-print]')) return print();
      if (event.target.closest('[data-edit-details]')) return openForm('details');
      var add = event.target.closest('[data-add]');
      if (add) return openForm(add.getAttribute('data-add'));
      var del = event.target.closest('[data-del]');
      if (del && window.confirm('Remove this entry?')) {
        try {
          var res = await api.request('/employees/' + state.id + '/personnel-file/' + del.getAttribute('data-del') + '/' + del.getAttribute('data-id') + '?year=' + state.year, { method: 'DELETE' });
          state.file = res.file;
          draw();
        } catch (err) { window.alert(err.message || 'Could not remove it'); }
      }
      return undefined;
    });
    host.addEventListener('change', function (event) {
      if (event.target.matches('[data-year]')) { state.year = Number(event.target.value); load(); }
    });
    load();
  }

  window.PortoHR = window.PortoHR || {};
  window.PortoHR.personnelFile = { mount: mount };
})(window, document);
