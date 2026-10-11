/* New employee: one full-screen form that captures everything at hire time. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var shell = window.PortoHR.shell;
  var DRAFT_KEY = 'portohr.newEmployeeDraft';
  var BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
  var uid = 0;

  var S = { user: null, meta: null, positions: [], grades: [], manager: null, submitting: false, done: false, saveTimer: null, searchTimer: null };

  var el = function (id) { return document.getElementById(id); };
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function cap(text) { var s = String(text).replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); }
  function toast(message, tone) {
    var node = document.createElement('div');
    node.className = 'max-w-sm rounded-lg border px-4 py-2.5 text-sm shadow-lg ' + (tone === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800');
    node.textContent = message;
    el('toasts').appendChild(node);
    window.setTimeout(function () { node.remove(); }, 4200);
  }
  function money(n) { return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }); }

  /* ------------------------------------------------------------ field builders */

  function optionsHtml(list, selected, blank) {
    var html = blank !== undefined ? '<option value="">' + esc(blank) + '</option>' : '';
    (list || []).forEach(function (item) {
      var value = typeof item === 'object' ? item.value : item;
      var label = typeof item === 'object' ? (item.label === item.value ? cap(item.label) : item.label) : cap(item);
      html += '<option value="' + esc(value) + '"' + (String(value) === String(selected) ? ' selected' : '') + '>' + esc(label) + '</option>';
    });
    return html;
  }

  /** One labelled control. `name` is the dotted path the value is sent under. */
  function fld(name, label, o) {
    o = o || {};
    var id = 'f' + (++uid);
    var type = o.type || 'text';
    var attrs = 'id="' + id + '" name="' + name + '"' + (o.disabled ? ' disabled' : '');
    var control;
    if (type === 'select') {
      control = '<select ' + attrs + '>' + optionsHtml(o.options, o.value, o.blank) + '</select>';
    } else if (type === 'textarea') {
      control = '<textarea ' + attrs + ' rows="2" maxlength="300">' + esc(o.value || '') + '</textarea>';
    } else {
      control = '<input ' + attrs + ' type="' + type + '"' +
        (o.value !== undefined ? ' value="' + esc(o.value) + '"' : '') +
        (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') +
        (o.min !== undefined ? ' min="' + o.min + '"' : '') +
        (o.max !== undefined ? ' max="' + o.max + '"' : '') +
        (o.step ? ' step="' + o.step + '"' : '') +
        (o.maxlength ? ' maxlength="' + o.maxlength + '"' : '') +
        (type === 'number' ? ' inputmode="decimal"' : '') + ' />';
    }
    return '<div class="fld ' + (o.span || 's4') + '" data-field="' + name + '"><label for="' + id + '">' + esc(label) +
      (o.req ? '<span class="req" title="Required">*</span>' : '') + '</label>' + control +
      (o.hint ? '<span class="hint"' + (o.hintId ? ' id="' + o.hintId + '"' : '') + '>' + esc(o.hint) + '</span>' : (o.hintId ? '<span class="hint" id="' + o.hintId + '"></span>' : '')) +
      '<span class="err" role="alert"></span></div>';
  }
  function chk(name, label, checked) {
    return '<label class="chk"><input type="checkbox" name="' + name + '"' + (checked ? ' checked' : '') + ' /> ' + esc(label) + '</label>';
  }
  function sub(title) { return '<h3 class="nw-sub">' + esc(title) + '</h3>'; }

  /* ------------------------------------------------------------ repeating rows */

  var LISTS = {
    allowances: {
      prefix: 'pay.allowances', noun: 'Allowance', add: 'Add allowance', empty: 'No fixed allowances. Add housing, transport, mobile and the like.',
      fields: function (p) {
        return fld(p + '.label', 'Allowance', { span: 's6', placeholder: 'Housing, Transport, Mobile…', maxlength: 60 }) +
          fld(p + '.amount', 'Amount per month', { span: 's4', type: 'number', min: 0, step: 'any' });
      },
    },
    family: {
      prefix: 'family', noun: 'Person', add: 'Add family member or contact', empty: 'No one added yet. At least one emergency contact is strongly recommended.',
      fields: function (p, i) {
        return fld(p + '.name', 'Full name', { span: 's4', req: true, maxlength: 80 }) +
          fld(p + '.relationship', 'Relationship', { span: 's4', type: 'select', options: S.meta.relationships, value: 'spouse' }) +
          fld(p + '.phone', 'Phone', { span: 's4', type: 'tel', maxlength: 30 }) +
          fld(p + '.dateOfBirth', 'Date of birth', { span: 's4', type: 'date' }) +
          fld(p + '.occupation', 'Occupation', { span: 's4', maxlength: 60 }) +
          fld(p + '.email', 'Email', { span: 's4', type: 'email' }) +
          '<div class="chk-flags" style="grid-column:span 12">' + chk(p + '.isEmergency', 'Emergency contact', i === 0) + chk(p + '.isDependent', 'Dependent', false) + chk(p + '.isNominee', 'Nominee', false) + '</div>';
      },
    },
    education: {
      prefix: 'education', noun: 'Qualification', add: 'Add qualification', empty: 'No qualifications added.',
      fields: function (p) {
        return fld(p + '.title', 'Degree or certificate', { span: 's6', req: true, placeholder: 'BS Computer Science', maxlength: 120 }) +
          fld(p + '.type', 'Kind', { span: 's3', type: 'select', options: S.meta.qualificationTypes, value: 'education' }) +
          fld(p + '.level', 'Level', { span: 's3', placeholder: 'Matric, Bachelor, Masters…', maxlength: 40 }) +
          fld(p + '.institution', 'Institution', { span: 's6', maxlength: 120 }) +
          fld(p + '.discipline', 'Subject', { span: 's3', maxlength: 80 }) +
          fld(p + '.result', 'Result / CGPA', { span: 's3', maxlength: 30 }) +
          fld(p + '.issuedOn', 'Date awarded', { span: 's3', type: 'date' }) +
          fld(p + '.preference', 'Importance', { span: 's3', type: 'select', options: [{ value: 'primary', label: 'Main qualification' }, { value: 'secondary', label: 'Second' }, { value: 'tertiary', label: 'Third' }], blank: 'Not ranked' });
      },
    },
    experience: {
      prefix: 'experience', noun: 'Job', add: 'Add previous job', empty: 'No previous experience added.',
      fields: function (p) {
        return fld(p + '.organization', 'Organisation', { span: 's6', req: true, maxlength: 120 }) +
          fld(p + '.designation', 'Designation', { span: 's6', maxlength: 100 }) +
          fld(p + '.fromYear', 'From (year)', { span: 's3', type: 'number', min: 1950, max: new Date().getFullYear(), step: 1 }) +
          fld(p + '.toYear', 'To (year)', { span: 's3', type: 'number', min: 1950, max: new Date().getFullYear(), step: 1 }) +
          fld(p + '.leavingCause', 'Reason for leaving', { span: 's6', maxlength: 120 });
      },
    },
    documents: {
      prefix: 'documents', noun: 'Document', add: 'Add document', empty: 'No documents yet. You can add them later from the employee profile.',
      fields: function (p) {
        return fld(p + '.type', 'Type', { span: 's4', type: 'select', options: S.meta.documentTypes, value: 'cnic', req: true }) +
          fld(p + '.title', 'Title', { span: 's8', placeholder: 'CNIC front and back', maxlength: 120 }) +
          fld(p + '.reference', 'Reference number', { span: 's4', maxlength: 100 }) +
          fld(p + '.issuedOn', 'Issued on', { span: 's3', type: 'date' }) +
          fld(p + '.expiresOn', 'Expires on', { span: 's3', type: 'date' }) +
          fld(p + '.confidentiality', 'Visibility', { span: 's3', type: 'select', options: S.meta.confidentiality, value: 'general' }) +
          '<div class="fld s12"><label>Attach the file now (optional)</label><input type="file" data-file accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" /><span class="hint" data-file-note>PDF, image or Word, up to 5 MB. Uploaded right after the employee is created.</span></div>';
      },
    },
  };

  function rowsHost(kind) { return el('rows-' + kind); }
  function rowsOf(kind) { return $$('.nw-row', rowsHost(kind)); }

  function addRow(kind) {
    var def = LISTS[kind];
    var host = rowsHost(kind);
    var index = rowsOf(kind).length;
    var holder = document.createElement('div');
    holder.innerHTML = '<div class="nw-row" data-list="' + kind + '"><button type="button" class="rm" data-rm title="Remove" aria-label="Remove this entry">&times;</button><p class="rowno"></p><div class="nw-grid">' + def.fields(def.prefix + '.' + index, index) + '</div></div>';
    host.appendChild(holder.firstChild);
    syncRows(kind);
    return host.lastChild;
  }

  /** Keeps the index inside every field name equal to the row's position, so server errors land on the right row. */
  function syncRows(kind) {
    var def = LISTS[kind];
    var rows = rowsOf(kind);
    rows.forEach(function (row, i) {
      $$('[name],[data-field]', row).forEach(function (node) {
        ['name', 'data-field'].forEach(function (attr) {
          var value = node.getAttribute(attr);
          if (value) node.setAttribute(attr, value.replace(/\.\d+\./, '.' + i + '.'));
        });
      });
      $('.rowno', row).textContent = def.noun + ' ' + (i + 1);
    });
    var empty = el('empty-' + kind);
    if (empty) empty.classList.toggle('hidden', rows.length > 0);
    if (kind === 'allowances') updateGross();
  }

  function listBlock(kind) {
    var def = LISTS[kind];
    return '<div id="rows-' + kind + '" class="nw-rows"></div><div id="empty-' + kind + '" class="nw-empty">' + esc(def.empty) + '</div>' +
      '<button type="button" class="btn btn-secondary btn-sm nw-add" data-add="' + kind + '">+ ' + esc(def.add) + '</button>';
  }

  /* ------------------------------------------------------------ sections */

  var SECTIONS = [
    { id: 'personal', title: 'Personal details', blurb: 'Who they are', req: ['personal.firstName', 'personal.lastName'] },
    { id: 'contact', title: 'Contact & address', blurb: 'How to reach them', req: ['contact.email'] },
    { id: 'job', title: 'Job & organisation', blurb: 'Where they sit and when they start', req: ['employment.employeeCode', 'employment.dateOfJoining', 'organization.department', 'organization.designation'] },
    { id: 'pay', title: 'Pay & bank', blurb: 'Salary, allowances and how they are paid', req: ['pay.baseSalary'] },
    { id: 'statutory', title: 'Statutory & tax', blurb: 'EOBI, provident fund, tax and social security', req: [], optional: true, checks: true },
    { id: 'family', title: 'Family & emergency contacts', blurb: 'Dependants, nominees and who to call', req: [], optional: true },
    { id: 'background', title: 'Education & experience', blurb: 'Qualifications and previous jobs', req: [], optional: true },
    { id: 'documents', title: 'Documents', blurb: 'ID, certificates and contracts', req: [], optional: true },
    { id: 'access', title: 'Access & onboarding', blurb: 'Login and first-weeks checklist', req: [], optional: true, checks: true },
  ];

  function sectionHtml(sec, inner) {
    return '<section class="nw-sec" id="sec-' + sec.id + '" data-sec="' + sec.id + '"><header><h2>' + esc(sec.title) + '</h2><span>' + esc(sec.blurb) + (sec.optional ? ' · optional' : '') + '</span></header>' + inner + '</section>';
  }

  function personalHtml() {
    var m = S.meta;
    return '<div class="nw-grid">' +
      fld('personal.firstName', 'First name', { span: 's4', req: true, maxlength: 60 }) +
      fld('personal.middleName', 'Middle name', { span: 's4', maxlength: 60 }) +
      fld('personal.lastName', 'Last name', { span: 's4', req: true, maxlength: 60 }) +
      fld('personal.preferredName', 'Preferred name', { span: 's4', hint: 'What colleagues call them', maxlength: 60 }) +
      fld('personal.fatherName', "Father's / husband's name", { span: 's4', maxlength: 80 }) +
      fld('personal.dateOfBirth', 'Date of birth', { span: 's4', type: 'date' }) +
      fld('personal.gender', 'Gender', { span: 's3', type: 'select', options: m.genders, blank: 'Select' }) +
      fld('personal.maritalStatus', 'Marital status', { span: 's3', type: 'select', options: m.maritalStatuses, blank: 'Select' }) +
      fld('personal.nationality', 'Nationality', { span: 's3', type: 'select', options: m.nationalities, value: 'PK' }) +
      fld('personal.bloodGroup', 'Blood group', { span: 's3', type: 'select', options: BLOOD, blank: 'Unknown' }) +
      fld('personal.cnic', 'CNIC', { span: 's4', placeholder: '42101-1234567-8', hint: 'Needed for payroll tax and EOBI', maxlength: 15 }) +
      fld('personal.passportNumber', 'Passport number', { span: 's4', maxlength: 20 }) +
      fld('personal.mobile', 'Personal mobile', { span: 's4', type: 'tel', placeholder: '0300-1234567', maxlength: 20 }) +
      fld('personal.personalEmail', 'Personal email', { span: 's6', type: 'email' }) +
      '</div>';
  }

  function addressBlock(i, type, title) {
    var p = 'contact.addresses.' + i;
    return sub(title) + '<div class="nw-grid"><input type="hidden" name="' + p + '.type" value="' + type + '" />' +
      fld(p + '.line1', 'Address line 1', { span: 's6', maxlength: 200 }) +
      fld(p + '.line2', 'Address line 2', { span: 's6', maxlength: 200 }) +
      fld(p + '.city', 'City', { span: 's4', maxlength: 60 }) +
      fld(p + '.postalCode', 'Postal code', { span: 's4', maxlength: 12 }) +
      fld(p + '.country', 'Country', { span: 's4', value: 'PK', maxlength: 2, hint: 'Two-letter code' }) + '</div>';
  }

  function contactHtml() {
    return sub('Work contact') + '<div class="nw-grid">' +
      fld('contact.email', 'Work email', { span: 's6', type: 'email', req: true, hint: 'Also the login name if you create an account below' }) +
      fld('contact.phone', 'Office phone / extension', { span: 's6', type: 'tel', maxlength: 20 }) + '</div>' +
      addressBlock(0, 'permanent', 'Permanent address') +
      '<p style="margin:1rem 0 0"><label class="chk"><input type="checkbox" id="same-addr" /> Current address is the same as permanent</label></p>' +
      addressBlock(1, 'current', 'Current address');
  }

  function jobHtml() {
    var m = S.meta;
    var seats = S.positions.map(function (p) {
      var title = p.title + (p.team ? ' · ' + p.team.name : '') + ' (' + p.positionCode + ')';
      return { value: p._id || p.id, label: title };
    });
    var grades = S.grades.map(function (g) { return { value: g.code, label: g.code + ' · ' + g.name }; });
    return sub('Employment') + '<div class="nw-grid">' +
      fld('employment.employeeCode', 'Employee code', { span: 's4', req: true, maxlength: 20, hint: 'Suggested automatically. You can change it.' }) +
      fld('employment.dateOfJoining', 'Date of joining', { span: 's4', type: 'date', req: true }) +
      fld('employment.employmentType', 'Employment type', { span: 's4', type: 'select', options: m.employmentTypes, value: 'full_time' }) +
      fld('employment.employmentStatus', 'Status', { span: 's3', type: 'select', options: [{ value: 'probation', label: 'On probation' }, { value: 'confirmed', label: 'Confirmed' }], value: 'probation' }) +
      fld('employment.probationEndDate', 'Probation ends', { span: 's3', type: 'date', hintId: 'probation-hint' }) +
      fld('employment.confirmationDate', 'Confirmed on', { span: 's3', type: 'date', hint: 'Only if already confirmed' }) +
      fld('employment.employeeCategory', 'Category', { span: 's3', type: 'select', options: m.employeeCategories, value: 'non_executive' }) +
      fld('employment.payGroup', 'Pay group', { span: 's4', type: 'select', options: m.payGroups, value: 'monthly_pk' }) +
      fld('employment.annualLeaveDays', 'Annual leave days', { span: 's4', type: 'number', min: 0, max: 365, step: 1, hint: 'Leave blank for the company default' }) +
      fld('employment.location', 'Location', { span: 's4', type: 'select', options: m.locations, blank: 'Company default' }) +
      fld('employment.legalEntity', 'Legal entity', { span: 's6', placeholder: 'Company default', maxlength: 100 }) +
      fld('employment.costCenter', 'Cost centre', { span: 's6', maxlength: 40 }) +
      '</div>' + sub('Position in the organisation') + '<div class="nw-grid">' +
      fld('organization.position', 'Vacant position', { span: 's12', type: 'select', options: seats, blank: 'No fixed position (a seat is created automatically)', hint: 'Picking a position fills the title, grade and team from it.' }) +
      fld('organization.department', 'Department', { span: 's4', type: 'select', options: m.departments, blank: 'Select', req: true }) +
      fld('organization.team', 'Team', { span: 's4', maxlength: 60 }) +
      fld('organization.designation', 'Designation', { span: 's4', req: true, maxlength: 100 }) +
      fld('organization.grade', 'Grade', { span: 's4', type: 'select', options: grades, blank: 'No grade' }) +
      '<div class="fld s8" data-field="organization.reportsTo"><label for="mgr-q">Reports to</label>' +
      '<input type="hidden" name="organization.reportsTo" />' +
      '<div id="mgr-chip" class="hidden"></div>' +
      '<div class="pick" id="mgr-pick"><input id="mgr-q" type="search" placeholder="Search by name or employee code" autocomplete="off" /><div id="mgr-list" class="pick-list hidden"></div></div>' +
      '<span class="err" role="alert"></span></div>' +
      '</div>' + sub('Time & attendance') + '<div class="nw-grid">' +
      fld('organization.shiftType', 'Shift', { span: 's4', type: 'select', options: m.shiftTypes.map(function (s) { return { value: s.value, label: s.label + ' (' + s.startTime + '–' + s.endTime + ')' }; }), value: 'general' }) +
      fld('organization.attendanceMode', 'Attendance', { span: 's4', type: 'select', options: [{ value: 'punch', label: 'Clocks in and out' }, { value: 'exempt', label: 'Exempt (no punching)' }], value: 'punch' }) +
      '<div class="fld s12" data-field="organization.restDays"><span class="lbl">Weekly rest days</span><div class="chk-group">' +
      m.weekdays.map(function (d) { return '<label class="chk"><input type="checkbox" data-multi name="organization.restDays" value="' + d.value + '"' + (d.value === 'saturday' || d.value === 'sunday' ? ' checked' : '') + ' /> ' + esc(d.label) + '</label>'; }).join('') +
      '</div><span class="err" role="alert"></span></div></div>';
  }

  function payHtml() {
    var m = S.meta;
    return '<div class="nw-grid">' +
      fld('pay.baseSalary', 'Basic salary per month', { span: 's4', type: 'number', min: 0, step: 'any', req: true, hint: 'Enter 0 for an unpaid role' }) +
      fld('pay.currency', 'Currency', { span: 's4', type: 'select', options: m.currencies, value: 'PKR' }) + '</div>' +
      sub('Fixed allowances') + listBlock('allowances') +
      '<div class="nw-total"><span>Gross per month</span><b id="gross">PKR 0</b></div>' +
      sub('How they are paid') + '<div class="nw-grid">' +
      fld('pay.payment.method', 'Payment method', { span: 's4', type: 'select', options: m.paymentMethods, value: 'bank_transfer' }) +
      fld('pay.payment.bankName', 'Bank', { span: 's4', maxlength: 60 }) +
      fld('pay.payment.branch', 'Branch', { span: 's4', maxlength: 60 }) +
      fld('pay.payment.accountTitle', 'Account title', { span: 's4', hint: 'Defaults to the employee name', maxlength: 80 }) +
      fld('pay.payment.accountNumber', 'Account number', { span: 's4', maxlength: 30 }) +
      fld('pay.payment.iban', 'IBAN', { span: 's4', placeholder: 'PK36MEZN0001230123456789', maxlength: 34 }) + '</div>';
  }

  function statutoryHtml() {
    return '<div class="nw-grid">' +
      fld('statutory.eobiNumber', 'EOBI number', { span: 's4', hint: 'Leave blank if not registered', maxlength: 30 }) +
      fld('statutory.ntn', 'NTN (tax number)', { span: 's4', maxlength: 20 }) +
      fld('statutory.socialSecurityNumber', 'Social security number', { span: 's4', maxlength: 30 }) +
      '<div class="fld s4"><span class="lbl">Provident fund</span><div class="chk-flags">' + chk('statutory.pfEnrolled', 'Enrolled in provident fund', false) + '</div></div>' +
      fld('statutory.pfNumber', 'PF membership number', { span: 's4', maxlength: 30 }) + '</div>';
  }

  function accessHtml() {
    return '<div class="nw-grid">' +
      '<div class="fld s6"><span class="lbl">Login</span><div class="chk-flags">' + chk('access.createLogin', 'Create a login so they can sign in', true) + '</div><span class="hint">A temporary password is generated and shown once, after saving.</span></div>' +
      fld('access.role', 'Role', { span: 's6', type: 'select', options: [{ value: 'employee', label: 'Employee' }, { value: 'manager', label: 'Manager' }, { value: 'hr_admin', label: 'HR Admin' }], value: 'employee' }) +
      '<div class="fld s12"><span class="lbl">Onboarding</span><div class="chk-flags">' + chk('onboarding.createChecklist', 'Start the onboarding checklist (contract, documents, IT, induction, goals, probation review)', true) + '</div></div></div>';
  }

  function render() {
    var html = [
      '<div id="nw-errs"></div><div id="nw-note"></div>',
      sectionHtml(SECTIONS[0], personalHtml()),
      sectionHtml(SECTIONS[1], contactHtml()),
      sectionHtml(SECTIONS[2], jobHtml()),
      sectionHtml(SECTIONS[3], payHtml()),
      sectionHtml(SECTIONS[4], statutoryHtml()),
      sectionHtml(SECTIONS[5], listBlock('family')),
      sectionHtml(SECTIONS[6], sub('Education') + listBlock('education') + sub('Previous experience') + listBlock('experience')),
      sectionHtml(SECTIONS[7], listBlock('documents')),
      sectionHtml(SECTIONS[8], accessHtml()),
    ].join('');
    el('nw-form').innerHTML = html;

    el('nw-rail').innerHTML = SECTIONS.map(function (sec, i) {
      return '<li><button type="button" class="nw-step" data-go="' + sec.id + '"><span class="n">' + (i + 1) + '</span><span class="t">' + esc(sec.title) + (sec.optional ? '<br /><span class="opt">Optional</span>' : '') + '</span></button></li>';
    }).join('');
  }

  /* ------------------------------------------------------------ reading and writing the form */

  function setPath(obj, path, value) {
    var parts = path.split('.');
    var node = obj;
    parts.forEach(function (part, i) {
      var last = i === parts.length - 1;
      var nextNumeric = !last && /^\d+$/.test(parts[i + 1]);
      if (last) { node[part] = value; return; }
      if (node[part] === undefined) node[part] = nextNumeric ? [] : {};
      node = node[part];
    });
  }
  function getPath(obj, path) {
    return path.split('.').reduce(function (node, part) { return node === undefined || node === null ? undefined : node[part]; }, obj);
  }

  function collect() {
    var out = {};
    $$('#nw-form [name]').forEach(function (input) {
      if (input.type === 'checkbox' && input.hasAttribute('data-multi')) {
        if (getPath(out, input.name) === undefined) setPath(out, input.name, []);
        if (input.checked) getPath(out, input.name).push(input.value);
      } else if (input.type === 'checkbox') {
        setPath(out, input.name, input.checked);
      } else {
        setPath(out, input.name, input.value);
      }
    });
    return out;
  }

  function flatten(value, prefix, into) {
    if (Array.isArray(value) && value.every(function (v) { return typeof v !== 'object'; })) { into[prefix] = value; return into; }
    if (value && typeof value === 'object') {
      Object.keys(value).forEach(function (key) { flatten(value[key], prefix ? prefix + '.' + key : key, into); });
    } else {
      into[prefix] = value;
    }
    return into;
  }

  function fill(data) {
    Object.keys(LISTS).forEach(function (kind) {
      var wanted = (getPath(data, LISTS[kind].prefix) || []).length;
      while (rowsOf(kind).length < wanted) addRow(kind);
    });
    var flat = flatten(data, '', {});
    Object.keys(flat).forEach(function (path) {
      var nodes = $$('#nw-form [name="' + path + '"]');
      if (!nodes.length || /addresses\.\d+\.type$/.test(path)) return;
      var value = flat[path];
      nodes.forEach(function (node) {
        if (node.type === 'checkbox' && node.hasAttribute('data-multi')) node.checked = Array.isArray(value) && value.indexOf(node.value) !== -1;
        else if (node.type === 'checkbox') node.checked = value === true;
        else if (node.type !== 'file') node.value = value === null || value === undefined ? '' : value;
      });
    });
  }

  /* ------------------------------------------------------------ live helpers */

  function updateGross() {
    var base = Number(($('[name="pay.baseSalary"]') || {}).value) || 0;
    var extra = $$('#rows-allowances [name$=".amount"]').reduce(function (sum, node) { return sum + (Number(node.value) || 0); }, 0);
    var currency = ($('[name="pay.currency"]') || {}).value || 'PKR';
    var node = el('gross');
    if (node) node.textContent = currency + ' ' + money(base + extra);
  }

  function updateProbationHint() {
    var joining = ($('[name="employment.dateOfJoining"]') || {}).value;
    var hint = el('probation-hint');
    if (!hint) return;
    var grade = S.grades.filter(function (g) { return g.code === ($('[name="organization.grade"]') || {}).value; })[0];
    var days = (grade && grade.probationDays) || 90;
    if (!joining) { hint.textContent = 'Blank uses the grade default (90 days if no grade)'; return; }
    var end = new Date(joining + 'T00:00:00Z');
    end.setUTCDate(end.getUTCDate() + days);
    hint.textContent = 'Blank = ' + days + ' days, ending ' + end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  function syncAddress() {
    var same = el('same-addr');
    ['line1', 'line2', 'city', 'postalCode', 'country'].forEach(function (key) {
      var from = $('[name="contact.addresses.0.' + key + '"]');
      var to = $('[name="contact.addresses.1.' + key + '"]');
      if (!from || !to) return;
      if (same.checked) to.value = from.value;
      to.readOnly = same.checked;
    });
  }

  function applyPosition() {
    var id = ($('[name="organization.position"]') || {}).value;
    var seat = S.positions.filter(function (p) { return (p._id || p.id) === id; })[0];
    if (!seat) return;
    var set = function (name, value) { var node = $('[name="' + name + '"]'); if (node && value) node.value = value; };
    set('organization.designation', seat.title);
    if (seat.team) {
      set('organization.team', seat.team.name);
      if (S.meta.departments.indexOf(seat.team.name) !== -1) set('organization.department', seat.team.name);
    }
    if (seat.grade) set('organization.grade', seat.grade.code);
    if (seat.location && S.meta.locations.indexOf(seat.location) !== -1) set('employment.location', seat.location);
    updateProbationHint();
  }

  /* ------------------------------------------------------------ manager picker */

  function setManager(person) {
    S.manager = person;
    $('[name="organization.reportsTo"]').value = person ? person.id : '';
    el('mgr-chip').innerHTML = person ? '<span class="pick-chip">' + esc(person.label) + '<button type="button" data-clear-mgr aria-label="Remove manager">&times;</button></span>' : '';
    el('mgr-chip').classList.toggle('hidden', !person);
    el('mgr-pick').classList.toggle('hidden', Boolean(person));
    el('mgr-q').value = '';
    el('mgr-list').classList.add('hidden');
  }

  function searchManagers() {
    var term = el('mgr-q').value.trim();
    var list = el('mgr-list');
    if (term.length < 2) { list.classList.add('hidden'); return; }
    api.get('/employees?limit=8&q=' + encodeURIComponent(term)).then(function (res) {
      var people = (res.employees || []).filter(function (e) { return ['resigned', 'terminated'].indexOf(e.employmentStatus) === -1; });
      list.innerHTML = people.length ? people.map(function (e) {
        return '<button type="button" data-mgr="' + esc(e._id || e.id) + '" data-label="' + esc(e.firstName + ' ' + e.lastName + ' (' + e.employeeCode + ')') + '">' + esc(e.firstName + ' ' + e.lastName) + '<small>' + esc(e.employeeCode + ' · ' + (e.designation || '') + (e.department ? ' · ' + e.department : '')) + '</small></button>';
      }).join('') : '<button type="button" disabled>No matching colleague</button>';
      list.classList.remove('hidden');
    }).catch(function () { list.classList.add('hidden'); });
  }

  /* ------------------------------------------------------------ progress, rail, scrollspy */

  function filled(name) { var node = $('[name="' + name + '"]'); return Boolean(node && String(node.value).trim()); }

  /** An optional section counts as done once something has been typed in it (defaults in dropdowns do not count). */
  function sectionHasContent(node, sec) {
    return $$('input, textarea', node).some(function (c) {
      if (c.type === 'hidden' || c.type === 'file' || c.id === 'same-addr' || c.id === 'mgr-q') return false;
      if (c.type === 'checkbox') return Boolean(sec.checks) && c.checked;
      return Boolean(String(c.value).trim());
    });
  }

  function refreshProgress() {
    var required = [];
    SECTIONS.forEach(function (sec) { required = required.concat(sec.req); });
    var done = required.filter(filled).length;
    var pct = Math.round((done / required.length) * 100);
    el('nw-pct').textContent = pct + '%';
    el('nw-pct-note').textContent = done + ' of ' + required.length + ' required fields done';
    el('nw-bar').style.width = pct + '%';
    SECTIONS.forEach(function (sec) {
      var step = $('[data-go="' + sec.id + '"]');
      var node = el('sec-' + sec.id);
      var complete = sec.req.length ? sec.req.every(filled) : sectionHasContent(node, sec);
      step.classList.toggle('is-done', complete);
      step.classList.toggle('has-err', Boolean($('.fld.has-err', node)));
    });
  }

  function spy() {
    var scroller = el('nw-scroll');
    var base = scroller.getBoundingClientRect().top;
    var current = SECTIONS[0].id;
    SECTIONS.forEach(function (sec) { if (el('sec-' + sec.id).getBoundingClientRect().top - base <= 140) current = sec.id; });
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) current = SECTIONS[SECTIONS.length - 1].id;
    $$('.nw-step').forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-go') === current); });
  }

  /* ------------------------------------------------------------ drafts (kept per tab, so nothing sensitive outlives the session) */

  function saveDraft() {
    try {
      window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ at: Date.now(), data: collect(), manager: S.manager }));
      var note = el('nw-draft');
      note.textContent = 'Draft saved ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      note.classList.add('is-saved');
    } catch (err) { /* storage unavailable: the form still works, it just cannot keep a draft */ }
  }
  function queueDraft() { window.clearTimeout(S.saveTimer); S.saveTimer = window.setTimeout(saveDraft, 600); }
  function clearDraft() { try { window.sessionStorage.removeItem(DRAFT_KEY); } catch (err) { /* ignore */ } }
  function loadDraft() {
    try { return JSON.parse(window.sessionStorage.getItem(DRAFT_KEY)); } catch (err) { return null; }
  }

  /* ------------------------------------------------------------ errors */

  function clearErrors() {
    $$('.fld.has-err').forEach(function (n) { n.classList.remove('has-err'); });
    el('nw-errs').innerHTML = '';
  }

  function fieldLabel(wrapper) {
    var label = wrapper && $('label, .lbl', wrapper);
    return label ? label.textContent.replace(/\*$/, '').trim() : '';
  }

  function showErrors(details, message) {
    clearErrors();
    var items = [];
    (details || []).forEach(function (d) {
      var wrapper = $('[data-field="' + d.field + '"]');
      if (wrapper) {
        wrapper.classList.add('has-err');
        $('.err', wrapper).textContent = d.message;
      }
      var row = wrapper && wrapper.closest('.nw-row');
      var where = row ? $('.rowno', row).textContent + ' · ' : '';
      items.push('<li>' + (wrapper ? '<a data-focus="' + d.field + '">' + esc(where + (fieldLabel(wrapper) || d.field)) + '</a>: ' : '') + esc(d.message) + '</li>');
    });
    el('nw-errs').innerHTML = '<div class="nw-banner bad" role="alert"><b>' + esc(message || 'Please correct the highlighted fields') + '</b>' + (items.length ? '<ul>' + items.join('') + '</ul>' : '') + '</div>';
    refreshProgress();
    var first = $('.fld.has-err');
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else el('nw-scroll').scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ------------------------------------------------------------ submit */

  function setBusy(busy) {
    S.submitting = busy;
    ['nw-submit', 'nw-submit-top'].forEach(function (id) {
      el(id).disabled = busy;
      el(id).textContent = busy ? 'Creating…' : 'Create employee';
    });
  }

  async function submit(event) {
    event.preventDefault();
    if (S.submitting) return;
    clearErrors();
    setBusy(true);
    try {
      var result = await api.post('/employees/onboard', collect());
      await finish(result);
    } catch (err) {
      if (err.details && err.details.length) showErrors(err.details, err.message);
      else { showErrors([], err.message || 'Could not create the employee'); }
    } finally {
      setBusy(false);
    }
  }

  function fileRows() {
    return rowsOf('documents').map(function (row) { return $('[data-file]', row).files[0] || null; });
  }

  async function finish(result) {
    var files = fileRows();
    clearDraft();
    S.done = true;
    var e = result.employee;
    var credentials = result.login
      ? '<div class="nw-cred"><b>Login created</b><span>Sign-in email: <b>' + esc(result.login.email) + '</b> · Role: ' + esc(result.login.role) + '</span><span>Temporary password: <code id="tmp-pw">' + esc(result.login.temporaryPassword) + '</code> <button type="button" class="btn btn-secondary btn-sm" id="copy-pw">Copy</button></span><span class="hint" style="font-size:.75rem;color:var(--muted)">Shown only now. They will be asked to choose a new password at first sign-in. Share it privately.</span></div>'
      : '';
    var warnings = (result.warnings || []).length
      ? '<div class="nw-banner warn"><b>Saved, but please look at this</b><ul>' + result.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>'
      : '';
    var withFiles = (result.documents || []).filter(function (d) { return d.id && files[d.index]; });
    var uploads = withFiles.length
      ? '<div class="nw-banner"><b>Uploading documents</b><ul class="nw-up" id="nw-up">' + withFiles.map(function (d) { return '<li data-up="' + d.id + '"><span class="wait">…</span><span>' + esc(d.title || d.type) + ' <i>(' + esc(files[d.index].name) + ')</i></span></li>'; }).join('') + '</ul></div>'
      : '';
    var noFile = (result.documents || []).filter(function (d) { return d.id && !files[d.index]; }).length;
    el('nw-main').classList.add('hidden');
    el('nw-foot').classList.add('hidden');
    el('nw-submit-top').classList.add('hidden');
    el('nw-reset').classList.add('hidden');
    el('nw-draft').textContent = '';
    var done = el('nw-done');
    done.classList.remove('hidden');
    done.innerHTML = '<div class="nw-done-card">' +
      '<div class="nw-hero"><h2>' + esc(e.name) + ' is on board</h2><p>' + esc(e.employeeCode) + ' · ' + esc(e.designation) + ' · ' + esc(e.department) + (e.dateOfJoining ? ' · joins ' + new Date(e.dateOfJoining).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '') + '</p></div>' +
      credentials + warnings + uploads +
      (noFile ? '<p class="msg" style="font-size:.82rem;color:var(--muted);margin:0">' + noFile + ' document record' + (noFile === 1 ? ' has' : 's have') + ' no file attached yet. Attach them from the employee profile.</p>' : '') +
      (result.checklist ? '<div class="nw-banner">An onboarding checklist with <b>' + result.checklist + ' tasks</b> was started. Track it under <a href="/company.html#onboarding">Company Hub &rarr; Onboarding</a>.</div>' : '') +
      '<div class="nw-actions"><a class="btn btn-primary" href="/core-hr.html#/employee/' + esc(e.id) + '">Open the profile</a><button type="button" class="btn btn-secondary" id="add-another">Add another employee</button><a class="btn btn-ghost" href="/core-hr.html">Back to Core HR</a></div></div>';
    done.scrollTop = 0;

    var copy = el('copy-pw');
    if (copy) copy.addEventListener('click', function () {
      var text = el('tmp-pw').textContent;
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { copy.textContent = 'Copied'; }).catch(function () {
        var range = document.createRange(); range.selectNodeContents(el('tmp-pw')); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); copy.textContent = 'Press Ctrl+C';
      });
    });
    el('add-another').addEventListener('click', function () { window.location.reload(); });

    for (var i = 0; i < withFiles.length; i += 1) {
      var d = withFiles[i];
      var row = $('[data-up="' + d.id + '"] span', done);
      try {
        // eslint-disable-next-line no-await-in-loop
        await api.upload('/employees/' + e.id + '/documents/' + d.id + '/file', files[d.index]);
        row.className = 'ok'; row.textContent = '✓';
      } catch (err) {
        row.className = 'no'; row.textContent = '✗';
        row.parentNode.appendChild(document.createTextNode(' ' + (err.message || 'Upload failed') + '. Attach it from the profile.'));
      }
    }
  }

  /* ------------------------------------------------------------ events */

  function wire() {
    var form = el('nw-form');
    form.addEventListener('submit', submit);

    form.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && event.target.tagName === 'INPUT' && event.target.type !== 'submit') event.preventDefault();
    });

    form.addEventListener('input', function (event) {
      var wrapper = event.target.closest('.fld');
      if (wrapper && wrapper.classList.contains('has-err')) wrapper.classList.remove('has-err');
      if (event.target.id === 'mgr-q') { window.clearTimeout(S.searchTimer); S.searchTimer = window.setTimeout(searchManagers, 250); return; }
      var name = event.target.name || '';
      if (name === 'pay.baseSalary' || name === 'pay.currency' || /^pay\.allowances\./.test(name)) updateGross();
      if (name === 'employment.dateOfJoining') updateProbationHint();
      if (el('same-addr') && el('same-addr').checked && /^contact\.addresses\.0\./.test(name)) syncAddress();
      refreshProgress();
      queueDraft();
    });

    form.addEventListener('change', function (event) {
      var t = event.target;
      if (t.name === 'organization.position') applyPosition();
      if (t.name === 'organization.grade') updateProbationHint();
      if (t.id === 'same-addr') syncAddress();
      if (t.hasAttribute && t.hasAttribute('data-file')) {
        var note = $('[data-file-note]', t.closest('.fld'));
        var file = t.files[0];
        if (file && file.size > 5 * 1024 * 1024) { t.value = ''; note.textContent = 'That file is over 5 MB. Choose a smaller one.'; return; }
        note.textContent = file ? file.name + ' · ' + Math.max(1, Math.round(file.size / 1024)) + ' KB. Uploaded right after saving.' : 'PDF, image or Word, up to 5 MB. Uploaded right after the employee is created.';
      }
      refreshProgress();
      queueDraft();
    });

    form.addEventListener('click', function (event) {
      var add = event.target.closest('[data-add]');
      if (add) { addRow(add.getAttribute('data-add')); refreshProgress(); queueDraft(); var rows = rowsOf(add.getAttribute('data-add')); var last = rows[rows.length - 1]; var first = last && $('input:not([type=hidden]):not([type=checkbox]), select', last); if (first) first.focus(); return; }
      var rm = event.target.closest('[data-rm]');
      if (rm) { var row = rm.closest('.nw-row'); var kind = row.getAttribute('data-list'); row.remove(); syncRows(kind); refreshProgress(); queueDraft(); return; }
      var pick = event.target.closest('[data-mgr]');
      if (pick) { setManager({ id: pick.getAttribute('data-mgr'), label: pick.getAttribute('data-label') }); queueDraft(); return; }
      if (event.target.closest('[data-clear-mgr]')) { setManager(null); el('mgr-q').focus(); queueDraft(); return; }
      var goto = event.target.closest('[data-focus]');
      if (goto) {
        var node = $('[name="' + goto.getAttribute('data-focus') + '"]');
        if (node) { node.scrollIntoView({ behavior: 'smooth', block: 'center' }); if (node.type !== 'hidden') node.focus({ preventScroll: true }); }
      }
    });

    // Bring the search box to mid-screen so its result list is not hidden under the bottom bar.
    form.addEventListener('focusin', function (event) {
      if (event.target.id === 'mgr-q') event.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    document.addEventListener('click', function (event) {
      if (!event.target.closest('#mgr-pick')) el('mgr-list').classList.add('hidden');
    });

    el('nw-rail').addEventListener('click', function (event) {
      var go = event.target.closest('[data-go]');
      if (go) el('sec-' + go.getAttribute('data-go')).scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    var ticking = false;
    el('nw-scroll').addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () { spy(); ticking = false; });
    });

    el('nw-reset').addEventListener('click', function () {
      if (window.confirm('Clear everything you have entered on this form?')) { clearDraft(); window.location.reload(); }
    });
  }

  /* ------------------------------------------------------------ start */

  function denied(message) {
    el('nw-main').innerHTML = '<div style="margin:auto;padding:2rem;text-align:center"><h2 style="font-family:var(--font-display);font-size:1.4rem">' + esc(message) + '</h2><p style="margin-top:.6rem;color:var(--muted)">Ask an HR admin to add the employee.</p><p style="margin-top:1rem"><a class="btn btn-primary" href="/core-hr.html">Back to Core HR</a></p></div>';
    el('nw-foot').classList.add('hidden');
    el('nw-submit-top').classList.add('hidden');
    el('nw-reset').classList.add('hidden');
  }

  async function init() {
    S.user = await shell.mount('core_hr');
    if (!S.user) return;
    if (S.user.role !== 'hr_admin') { denied('Only HR admins can add employees'); return; }

    try {
      var loaded = await Promise.all([
        api.get('/employees/meta'),
        api.get('/org/positions?status=vacant'),
        api.get('/org/grades'),
        api.get('/employees/next-code'),
      ]);
      S.meta = loaded[0].meta;
      S.positions = loaded[1].positions || [];
      S.grades = (loaded[2].grades || []).filter(function (g) { return g.status !== 'inactive'; });
      var nextCode = loaded[3].employeeCode;
    } catch (err) {
      denied(err.message || 'Could not load the form');
      return;
    }

    render();
    wire();
    var draft = loadDraft();
    if (!draft || !draft.data) addRow('family');
    $('[name="employment.employeeCode"]').value = nextCode || '';

    if (draft && draft.data) {
      fill(draft.data);
      if (draft.manager) setManager(draft.manager);
      el('nw-note').innerHTML = '<div class="nw-banner"><b>Your unsaved draft was restored</b> from ' + new Date(draft.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + '. Use <i>Start over</i> at the top to clear it.</div>';
    }
    updateGross();
    updateProbationHint();
    refreshProgress();
    spy();
    $('[name="personal.firstName"]').focus();
  }

  init().catch(function (err) {
    toast((err && err.message) || 'Something went wrong', 'error');
  });
})(window, document);
