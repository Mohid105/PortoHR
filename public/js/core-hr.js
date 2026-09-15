/* Core HR: employee directory, create/edit slide-over, and profile view. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var shell = window.PortoHR.shell;

  var state = {
    user: null,
    meta: null,
    employees: [],
    managers: [],
    page: 1,
    limit: 25,
    total: 0,
    pages: 1,
    filters: { q: '', department: '', employmentStatus: '', shiftType: '' },
    editingId: null,
    panelMode: 'create',
    pendingDelete: null,
    pendingDecision: null,
    queue: [],
    queueCanApprove: false,
  };

  var el = function (id) {
    return document.getElementById(id);
  };

  // ---------------------------------------------------------------- helpers

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(
      /[&<>"']/g,
      function (char) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
      }
    );
  }

  function initials(name) {
    return (name || '?')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(function (part) {
        return part[0].toUpperCase();
      })
      .join('');
  }

  function canManage() {
    return state.user && state.user.role === 'hr_admin';
  }

  function isSelfRecord(employee) {
    if (!state.user || !employee) return false;
    return employee.email === state.user.email || employee.employeeCode === state.user.employeeId;
  }

  function canRequest(employee) {
    return canManage() || isSelfRecord(employee);
  }

  /** Maker-checker: the person who requested a row cannot also activate it. */
  function isOwnRequest(row) {
    return Boolean(row && state.user && row.requestedBy && row.requestedBy === state.user.id);
  }

  function canActOnAssignment(row) {
    if (!row || row.status !== 'pending') return false;
    if (isOwnRequest(row)) return false;
    return state.queueCanApprove || (row.canDecide === true);
  }

  var ASSIGNMENT_TONES = {
    pending: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    scheduled: 'bg-sky-50 text-sky-700 ring-sky-600/20',
    active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    superseded: 'bg-slate-100 text-slate-600 ring-slate-500/20',
    rejected: 'bg-red-50 text-red-700 ring-red-600/20',
    cancelled: 'bg-slate-100 text-slate-500 ring-slate-400/20',
    ended: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  };

  function assignmentBadge(status) {
    var match = ((state.meta && state.meta.assignmentStatuses) || []).filter(function (item) {
      return item.value === status;
    })[0];
    return (
      '<span class="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ' +
      (ASSIGNMENT_TONES[status] || ASSIGNMENT_TONES.pending) +
      '">' +
      escapeHtml(match ? match.label : status) +
      '</span>'
    );
  }

  function formatMoney(amount, currency) {
    if (typeof amount !== 'number') return '—';
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency || 'USD',
        maximumFractionDigits: 0,
      }).format(amount);
    } catch (err) {
      return (currency || '') + ' ' + amount.toLocaleString();
    }
  }

  function formatDate(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function toDateInput(value) {
    if (!value) return '';
    var date = new Date(value);
    return isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  }

  function labelFor(collection, value) {
    var match = (collection || []).filter(function (item) {
      return item.value === value;
    })[0];
    return match ? match.label : value || '—';
  }

  var STATUS_TONES = {
    confirmed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    probation: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    notice_period: 'bg-orange-50 text-orange-700 ring-orange-600/20',
    resigned: 'bg-slate-100 text-slate-600 ring-slate-500/20',
    terminated: 'bg-red-50 text-red-700 ring-red-600/20',
  };

  function statusBadge(status) {
    var tone = STATUS_TONES[status] || STATUS_TONES.resigned;
    return (
      '<span class="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ' +
      tone +
      '">' +
      escapeHtml(labelFor(state.meta && state.meta.employmentStatuses, status)) +
      '</span>'
    );
  }

  function dayChips(days) {
    if (!days || !days.length) return '<span class="text-slate-400">None</span>';
    return days
      .map(function (day) {
        return (
          '<span class="inline-flex rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">' +
          escapeHtml(labelFor(state.meta && state.meta.weekdays, day)) +
          '</span>'
        );
      })
      .join(' ');
  }

  function avatar(name, size) {
    var dimensions = size === 'lg' ? 'h-16 w-16 text-lg' : 'h-9 w-9 text-xs';
    return (
      '<span class="flex shrink-0 items-center justify-center rounded-full bg-slate-100 font-semibold text-slate-600 ' +
      dimensions +
      '">' +
      escapeHtml(initials(name)) +
      '</span>'
    );
  }

  // ----------------------------------------------------------------- toasts

  function toast(message, tone) {
    var toneClass =
      tone === 'error'
        ? 'border-red-200 bg-red-50 text-red-800'
        : 'border-emerald-200 bg-emerald-50 text-emerald-800';
    var node = document.createElement('div');
    node.className =
      'rounded-lg border px-4 py-2.5 text-sm shadow-lg transition-opacity duration-300 ' + toneClass;
    node.textContent = message;
    el('toasts').appendChild(node);
    window.setTimeout(function () {
      node.classList.add('opacity-0');
      window.setTimeout(function () {
        node.remove();
      }, 300);
    }, 3200);
  }

  // ------------------------------------------------------------ meta/options

  function fillSelect(select, options, blankLabel) {
    var html = blankLabel === null ? '' : '<option value="">' + escapeHtml(blankLabel) + '</option>';
    html += (options || [])
      .map(function (option) {
        var value = typeof option === 'string' ? option : option.value;
        var label = typeof option === 'string' ? option : option.label;
        return '<option value="' + escapeHtml(value) + '">' + escapeHtml(label) + '</option>';
      })
      .join('');
    select.innerHTML = html;
  }

  function applyMeta() {
    var meta = state.meta;

    fillSelect(el('filter-department'), meta.departments, 'All departments');
    fillSelect(el('filter-status'), meta.employmentStatuses, 'All statuses');
    fillSelect(el('filter-shift'), meta.shiftTypes, 'All shifts');

    fillSelect(el('f-department'), meta.departments, 'Select…');
    fillSelect(el('f-gender'), meta.genders, 'Not specified');
    fillSelect(el('f-employmentType'), meta.employmentTypes, null);
    fillSelect(el('f-employmentStatus'), meta.employmentStatuses, null);
    fillSelect(el('f-shiftType'), meta.shiftTypes, null);
    fillSelect(el('f-currency'), meta.currencies, null);
    fillSelect(el('f-location'), meta.locations || [], 'Select…');
    fillSelect(el('f-employeeCategory'), meta.employeeCategories || [], null);
    fillSelect(el('f-nationality'), meta.nationalities || [], 'Not specified');
    fillSelect(el('f-maritalStatus'), meta.maritalStatuses || [], 'Not specified');
    fillSelect(el('f-event'), meta.personnelEvents || [], 'Infer from fields');

    el('rest-days').innerHTML = meta.weekdays
      .map(function (day) {
        return (
          '<label class="cursor-pointer">' +
          '<input type="checkbox" name="restDays" value="' +
          escapeHtml(day.value) +
          '" class="peer sr-only" />' +
          '<span class="inline-flex rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition peer-checked:border-slate-900 peer-checked:bg-slate-900 peer-checked:text-white">' +
          escapeHtml(day.label) +
          '</span></label>'
        );
      })
      .join('');
  }

  // ------------------------------------------------------------------ table

  function employeeRow(employee) {
    var compensation = employee.compensation || {};
    var gross = compensation.restricted
      ? '<span class="inline-flex items-center gap-1 text-xs text-slate-400">' +
        '<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>' +
        'Restricted</span>'
      : '<span class="font-medium text-slate-900">' +
        escapeHtml(formatMoney(employee.grossSalary, compensation.currency)) +
        '</span>';

    var manageButtons = canManage()
      ? '<button type="button" data-edit="' +
        employee.id +
        '" class="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900">Edit</button>' +
        '<button type="button" data-delete="' +
        employee.id +
        '" class="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50">Remove</button>'
      : '';

    return (
      '<tr class="transition hover:bg-slate-50">' +
      '<td class="px-6 py-4">' +
      '<a href="#/employee/' +
      employee.id +
      '" class="flex items-center gap-3">' +
      avatar(employee.fullName) +
      '<span class="min-w-0">' +
      '<span class="block truncate text-sm font-medium text-slate-900">' +
      escapeHtml(employee.fullName) +
      '</span>' +
      '<span class="block truncate text-xs text-slate-500">' +
      escapeHtml(employee.employeeCode) +
      ' · ' +
      escapeHtml(employee.designation) +
      '</span></span></a></td>' +
      '<td class="px-6 py-4 text-slate-700">' +
      escapeHtml(employee.department) +
      '</td>' +
      '<td class="px-6 py-4 text-slate-700">' +
      (employee.team ? escapeHtml(employee.team) : '<span class="text-slate-400">—</span>') +
      '</td>' +
      '<td class="px-6 py-4">' +
      '<span class="block text-slate-700">' +
      escapeHtml(employee.shift ? employee.shift.label : employee.shiftType) +
      '</span>' +
      (employee.shift && employee.shift.startTime
        ? '<span class="block text-xs text-slate-400">' +
          escapeHtml(employee.shift.startTime + ' – ' + employee.shift.endTime) +
          '</span>'
        : '') +
      '</td>' +
      '<td class="px-6 py-4"><div class="flex flex-wrap gap-1">' +
      dayChips(employee.restDays) +
      '</div></td>' +
      '<td class="px-6 py-4">' +
      statusBadge(employee.employmentStatus) +
      (employee.hasPendingAssignment
        ? '<span class="ml-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">Pending</span>'
        : '') +
      '</td>' +
      '<td class="px-6 py-4 text-right">' +
      gross +
      '</td>' +
      '<td class="px-6 py-4 text-right"><div class="flex justify-end gap-1">' +
      '<a href="#/employee/' +
      employee.id +
      '" class="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900">View</a>' +
      manageButtons +
      '</div></td>' +
      '</tr>'
    );
  }

  function renderRows() {
    el('employee-rows').innerHTML = state.employees.map(employeeRow).join('');
    el('table-empty').classList.toggle('hidden', state.employees.length > 0);
    el('table-error').classList.add('hidden');

    var first = state.total === 0 ? 0 : (state.page - 1) * state.limit + 1;
    var last = Math.min(state.page * state.limit, state.total);
    el('table-summary').textContent =
      state.total === 0
        ? 'No records'
        : 'Showing ' + first + '–' + last + ' of ' + state.total + ' employees';

    el('page-prev').disabled = state.page <= 1;
    el('page-next').disabled = state.page >= state.pages;
  }

  function buildQuery() {
    var params = ['page=' + state.page, 'limit=' + state.limit];
    Object.keys(state.filters).forEach(function (key) {
      if (state.filters[key]) params.push(key + '=' + encodeURIComponent(state.filters[key]));
    });
    return '?' + params.join('&');
  }

  async function loadQueue() {
    var box = el('changes-queue');
    if (!box) return;
    if (state.user.role !== 'manager' && state.user.role !== 'hr_admin') {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }
    try {
      var result = await api.get('/employees/changes?scope=queue');
      state.queue = result.assignments || [];
      state.queueCanApprove = result.canApprove;
      renderQueue();
    } catch (err) {
      if (err.status === 401) return;
      box.classList.add('hidden');
    }
  }

  function renderQueue() {
    var box = el('changes-queue');
    if (!state.queue.length) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }
    box.classList.remove('hidden');
    box.innerHTML =
      '<div class="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-card">' +
      '<div class="flex flex-wrap items-center justify-between gap-2">' +
      '<div>' +
      '<h2 class="text-sm font-semibold text-amber-950">Maker-checker queue</h2>' +
      '<p class="text-xs text-amber-800">Role and salary changes waiting for approval before the new dated assignment goes live.</p>' +
      '</div>' +
      '<span class="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-600/20">' +
      state.queue.length +
      '</span></div>' +
      '<ul class="mt-3 space-y-2">' +
      state.queue
        .map(function (row) {
          var person = row.employeeSnapshot || {};
          return (
            '<li class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-100 bg-white px-3 py-2.5">' +
            '<div>' +
            '<a href="#/employee/' +
            escapeHtml(person.id || '') +
            '" class="text-sm font-medium text-slate-900 hover:underline">' +
            escapeHtml(person.fullName || 'Employee') +
            '</a>' +
            '<p class="text-xs text-slate-500">' +
            escapeHtml((row.changedFields || []).join(', ') || 'Assignment') +
            (row.reason ? ' · ' + escapeHtml(row.reason) : '') +
            '</p></div>' +
            (canActOnAssignment(row)
              ? '<div class="flex gap-2">' +
                '<button type="button" data-queue-decide="' +
                escapeHtml(row.id) +
                '" data-decision="approved" class="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">Approve</button>' +
                '<button type="button" data-queue-decide="' +
                escapeHtml(row.id) +
                '" data-decision="rejected" class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700">Reject</button>' +
                '</div>'
              : '<p class="text-xs text-amber-800">Waiting for a checker</p>') +
            '</li>'
          );
        })
        .join('') +
      '</ul></div>';

    box.querySelectorAll('[data-queue-decide]').forEach(function (button) {
      button.addEventListener('click', function () {
        openDecision(button.getAttribute('data-queue-decide'), button.getAttribute('data-decision'));
      });
    });
  }

  function openDecision(id, decision) {
    state.pendingDecision = { id: id, status: decision };
    el('decision-title').textContent = decision === 'approved' ? 'Approve assignment' : 'Reject assignment';
    el('decision-text').textContent =
      decision === 'approved'
        ? 'This dated row will become the current assignment. The previous active row is closed, not overwritten.'
        : 'The pending row will stay on the history as rejected and will not change the live assignment.';
    el('decision-note').value = '';
    el('decision-error').classList.add('hidden');
    el('decision-backdrop').classList.remove('hidden');
    el('decision-backdrop').classList.add('flex');
  }

  function closeDecision() {
    state.pendingDecision = null;
    el('decision-backdrop').classList.add('hidden');
    el('decision-backdrop').classList.remove('flex');
  }

  async function confirmDecision() {
    if (!state.pendingDecision) return;
    var decision = state.pendingDecision;
    if (decision.status === 'rejected' && !el('decision-note').value.trim()) {
      el('decision-error').textContent = 'A rejection needs a short note.';
      el('decision-error').classList.remove('hidden');
      return;
    }
    try {
      await api.request('/employees/assignments/' + decision.id + '/status', {
        method: 'PATCH',
        body: { status: decision.status, decisionNote: el('decision-note').value.trim() },
      });
      closeDecision();
      toast(decision.status === 'approved' ? 'Assignment activated' : 'Change rejected');
      await loadEmployees();
      await loadQueue();
      var id = currentEmployeeId();
      if (id) await renderProfile(id);
    } catch (err) {
      if (err.status === 401) return;
      el('decision-error').textContent = err.message;
      el('decision-error').classList.remove('hidden');
    }
  }

  async function loadEmployees() {
    try {
      var result = await api.get('/employees' + buildQuery());
      state.employees = result.employees;
      state.total = result.total;
      state.pages = result.pages;
      state.page = result.page;
      renderRows();
    } catch (err) {
      if (err.status === 401) return;
      el('employee-rows').innerHTML = '';
      el('table-empty').classList.add('hidden');
      el('table-error').classList.remove('hidden');
      el('table-error-text').textContent = err.message;
      el('table-summary').textContent = '—';
    }
  }

  // ------------------------------------------------------------- form panel

  function clearFieldErrors() {
    el('form-error').classList.add('hidden');
    el('form-error').textContent = '';
    document.querySelectorAll('[data-error-for]').forEach(function (node) {
      node.textContent = '';
      node.classList.add('hidden');
    });
    document.querySelectorAll('#employee-form [aria-invalid]').forEach(function (node) {
      node.removeAttribute('aria-invalid');
    });
  }

  function setFieldError(field, message) {
    var node = document.querySelector('[data-error-for="' + field + '"]');
    if (node) {
      node.textContent = message;
      node.classList.remove('hidden');
    }
    // Compensation errors arrive as dotted schema paths; the input is named by its leaf.
    var inputName = field.indexOf('.') === -1 ? field : field.split('.').pop();
    var input = document.querySelector('#employee-form [name="' + inputName + '"]');
    if (input) input.setAttribute('aria-invalid', 'true');
  }

  function allowanceRow(allowance) {
    var item = allowance || { label: '', amount: '' };
    return (
      '<div class="flex items-center gap-2" data-allowance-row>' +
      '<input type="text" data-allowance-label placeholder="Housing" value="' +
      escapeHtml(item.label) +
      '" class="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10" />' +
      '<input type="number" min="0" step="0.01" data-allowance-amount placeholder="0.00" value="' +
      escapeHtml(item.amount) +
      '" class="w-32 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10" />' +
      '<button type="button" data-remove-allowance class="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600" aria-label="Remove allowance">' +
      '<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>' +
      '</button></div>'
    );
  }

  function syncAllowanceState() {
    var rows = document.querySelectorAll('[data-allowance-row]');
    el('allowance-empty').classList.toggle('hidden', rows.length > 0);
    updateGrossPreview();
  }

  function updateGrossPreview() {
    var base = Number(el('f-baseSalary').value) || 0;
    var total = base;
    document.querySelectorAll('[data-allowance-amount]').forEach(function (input) {
      total += Number(input.value) || 0;
    });
    el('gross-preview').textContent = formatMoney(total, el('f-currency').value);
  }

  function updateShiftHint() {
    var shift = (state.meta.shiftTypes || []).filter(function (item) {
      return item.value === el('f-shiftType').value;
    })[0];
    el('shift-hint').textContent =
      shift && shift.startTime ? shift.startTime + ' – ' + shift.endTime : 'Timing varies by roster';
  }

  function fillForm(employee) {
    var form = el('employee-form');
    form.reset();
    clearFieldErrors();

    var compensation = (employee && employee.compensation) || {};
    var values = {
      employeeCode: employee ? employee.employeeCode : '',
      firstName: employee ? employee.firstName : '',
      lastName: employee ? employee.lastName : '',
      preferredName: employee ? employee.preferredName || (employee.person && employee.person.preferredName) || '' : '',
      fatherName: employee && employee.person ? employee.person.fatherName || '' : '',
      email: employee ? employee.email : '',
      phone: employee ? employee.phone : '',
      dateOfBirth: employee ? toDateInput(employee.dateOfBirth) : '',
      gender: employee ? employee.gender : '',
      nationality: employee && employee.person ? employee.person.nationality || '' : '',
      maritalStatus: employee && employee.person ? employee.person.maritalStatus || '' : '',
      cnic: employee && employee.person && employee.person.nationalIds && employee.person.nationalIds[0] ? employee.person.nationalIds[0].number : '',
      address: employee ? employee.address : '',
      designation: employee ? employee.designation : '',
      department: employee ? employee.department : '',
      team: employee ? employee.team : '',
      location: employee ? employee.location || '' : '',
      employeeCategory: employee ? employee.employeeCategory || '' : '',
      event: '',
      eventReason: '',
      position: employee && employee.currentPosition ? employee.currentPosition.id || employee.currentPosition : '',
      phone: employee ? employee.phone : '',
      dateOfBirth: employee ? toDateInput(employee.dateOfBirth) : '',
      gender: employee ? employee.gender : '',
      address: employee ? employee.address : '',
      designation: employee ? employee.designation : '',
      department: employee ? employee.department : '',
      team: employee ? employee.team : '',
      employmentType: employee ? employee.employmentType : 'full_time',
      employmentStatus: employee ? employee.employmentStatus : 'probation',
      dateOfJoining: employee ? toDateInput(employee.dateOfJoining) : '',
      shiftType: employee ? employee.shiftType : 'general',
      annualLeaveDays: employee && employee.annualLeaveDays !== undefined ? employee.annualLeaveDays : 20,
      currency: compensation.currency || 'USD',
      baseSalary: compensation.baseSalary === undefined ? '' : compensation.baseSalary,
      effectiveFrom: employee ? toDateInput(new Date()) : '',
      reason: '',
    };

    Object.keys(values).forEach(function (name) {
      var input = form.querySelector('[name="' + name + '"]');
      if (input) input.value = values[name] === null ? '' : values[name];
    });

    var restDays = (employee && employee.restDays) || ['saturday', 'sunday'];
    form.querySelectorAll('[name="restDays"]').forEach(function (box) {
      box.checked = restDays.indexOf(box.value) !== -1;
    });

    var managerId = '';
    if (employee && employee.reportsTo) {
      managerId = employee.reportsTo.id || employee.reportsTo._id || employee.reportsTo;
    }
    el('f-reportsTo').value = managerId || '';

    el('allowance-rows').innerHTML = (compensation.fixedAllowances || []).map(allowanceRow).join('');
    syncAllowanceState();
    updateShiftHint();
  }

  /** Manager options exclude the record being edited so nobody can report to themselves. */
  async function loadManagerOptions(excludeId) {
    try {
      var result = await api.get('/employees?limit=100');
      state.managers = result.employees;
    } catch (err) {
      state.managers = [];
    }

    var options = state.managers
      .filter(function (candidate) {
        return candidate.id !== excludeId;
      })
      .map(function (candidate) {
        return {
          value: candidate.id,
          label: candidate.fullName + ' · ' + candidate.designation,
        };
      });

    var current = el('f-reportsTo').value;
    fillSelect(el('f-reportsTo'), options, 'No manager');
    el('f-reportsTo').value = current;
  }

  function setRequestMode(requestOnly) {
    var locked = [
      'employeeCode',
      'firstName',
      'lastName',
      'email',
      'phone',
      'dateOfBirth',
      'gender',
      'address',
      'employmentType',
      'employmentStatus',
      'dateOfJoining',
      'annualLeaveDays',
    ];
    var form = el('employee-form');
    locked.forEach(function (name) {
      var input = form.querySelector('[name="' + name + '"]');
      if (input && name !== 'employeeCode') input.disabled = requestOnly;
    });
    el('f-employeeCode').disabled = Boolean(state.editingId);
  }

  async function openPanel(employee, mode) {
    state.editingId = employee ? employee.id : null;
    state.panelMode = mode || (employee ? 'edit' : 'create');

    var requesting = state.panelMode === 'request';
    el('panel-title').textContent = requesting
      ? 'Request assignment change'
      : employee
        ? 'Edit employee'
        : 'Create employee';
    el('panel-subtitle').textContent = requesting
      ? 'Role and salary changes go to your manager before they take effect.'
      : employee
        ? employee.fullName + ' · ' + employee.employeeCode
        : 'Add a new record to the directory';
    el('panel-submit-text').textContent = requesting
      ? 'Submit for approval'
      : employee
        ? 'Save changes'
        : 'Create employee';

    fillForm(employee);
    setRequestMode(requesting);
    loadPositionOptions();

    el('panel-backdrop').classList.remove('hidden');
    el('panel').classList.remove('translate-x-full');
    document.body.classList.add('overflow-hidden');

    await loadManagerOptions(state.editingId);
    if (employee && employee.reportsTo) {
      el('f-reportsTo').value = employee.reportsTo.id || employee.reportsTo._id || '';
    }
    el(requesting ? 'f-designation' : 'f-firstName').focus();
  }

  function closePanel() {
    el('panel').classList.add('translate-x-full');
    el('panel-backdrop').classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    state.editingId = null;
    state.panelMode = 'create';
    setRequestMode(false);
  }

  function readForm() {
    var form = el('employee-form');
    var value = function (name) {
      var input = form.querySelector('[name="' + name + '"]');
      return input ? input.value.trim() : '';
    };

    var restDays = Array.prototype.slice
      .call(form.querySelectorAll('[name="restDays"]:checked'))
      .map(function (box) {
        return box.value;
      });

    var allowances = Array.prototype.slice
      .call(document.querySelectorAll('[data-allowance-row]'))
      .map(function (row) {
        return {
          label: row.querySelector('[data-allowance-label]').value.trim(),
          amount: row.querySelector('[data-allowance-amount]').value,
        };
      });

    return {
      employeeCode: value('employeeCode').toUpperCase(),
      firstName: value('firstName'),
      lastName: value('lastName'),
      preferredName: value('preferredName'),
      fatherName: value('fatherName'),
      email: value('email').toLowerCase(),
      phone: value('phone'),
      dateOfBirth: value('dateOfBirth') || null,
      gender: value('gender'),
      nationality: value('nationality'),
      maritalStatus: value('maritalStatus'),
      address: value('address'),
      designation: value('designation'),
      department: value('department'),
      team: value('team'),
      location: value('location'),
      employeeCategory: value('employeeCategory'),
      event: value('event'),
      eventReason: value('eventReason'),
      position: value('position') || null,
      employmentType: value('employmentType'),
      phone: value('phone'),
      dateOfBirth: value('dateOfBirth') || null,
      gender: value('gender'),
      address: value('address'),
      designation: value('designation'),
      department: value('department'),
      team: value('team'),
      employmentType: value('employmentType'),
      employmentStatus: value('employmentStatus'),
      dateOfJoining: value('dateOfJoining') || null,
      reportsTo: value('reportsTo') || null,
      shiftType: value('shiftType'),
      annualLeaveDays: value('annualLeaveDays') === '' ? 0 : Number(value('annualLeaveDays')),
      restDays: restDays,
      compensation: {
        currency: value('currency'),
        baseSalary: value('baseSalary') === '' ? null : Number(value('baseSalary')),
        fixedAllowances: allowances.map(function (item) {
          return { label: item.label, amount: item.amount === '' ? null : Number(item.amount) };
        }),
      },
      effectiveFrom: value('effectiveFrom') || null,
      reason: value('reason'),
      nationalIds: value('cnic') ? [{ type: 'cnic', number: value('cnic'), issuingCountry: 'PK' }] : undefined,
    };
  }

  function validate(payload) {
    var errors = {};

    if (!payload.employeeCode) errors.employeeCode = 'Employee code is required';
    else if (!/^[A-Z0-9-]{3,20}$/.test(payload.employeeCode))
      errors.employeeCode = 'Use 3–20 letters, numbers or hyphens';

    if (!payload.firstName) errors.firstName = 'First name is required';
    if (!payload.lastName) errors.lastName = 'Last name is required';

    if (!payload.email) errors.email = 'Work email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email))
      errors.email = 'Enter a valid email address';

    if (!payload.designation) errors.designation = 'Designation is required';
    if (!payload.department) errors.department = 'Select a department';
    if (!payload.dateOfJoining) errors.dateOfJoining = 'Date of joining is required';

    if (payload.restDays.length > 3) errors.restDays = 'Pick no more than three rest days';

    var salary = payload.compensation.baseSalary;
    if (salary === null || isNaN(salary)) errors['compensation.baseSalary'] = 'Base salary is required';
    else if (salary < 0) errors['compensation.baseSalary'] = 'Base salary cannot be negative';

    var allowances = payload.compensation.fixedAllowances;
    for (var i = 0; i < allowances.length; i++) {
      if (!allowances[i].label || allowances[i].amount === null || isNaN(allowances[i].amount)) {
        errors['compensation.fixedAllowances'] = 'Every allowance needs a name and an amount';
        break;
      }
      if (allowances[i].amount < 0) {
        errors['compensation.fixedAllowances'] = 'Allowance amounts cannot be negative';
        break;
      }
    }

    return errors;
  }

  function setSubmitting(submitting) {
    el('panel-submit').disabled = submitting;
    el('panel-spinner').classList.toggle('hidden', !submitting);
  }

  async function submitForm(event) {
    event.preventDefault();
    clearFieldErrors();

    var payload = readForm();
    var errors = validate(payload);
    var fields = Object.keys(errors);

    if (fields.length) {
      fields.forEach(function (field) {
        setFieldError(field, errors[field]);
      });
      el('form-error').textContent = 'Please correct the highlighted fields.';
      el('form-error').classList.remove('hidden');
      return;
    }

    // The code is immutable after creation, so it is not part of an edit payload.
    if (state.editingId) delete payload.employeeCode;

    setSubmitting(true);
    try {
      var result = state.editingId
        ? await api.request('/employees/' + state.editingId, { method: 'PATCH', body: payload })
        : await api.post('/employees', payload);

      toast(
        result.pending
          ? 'Sent for checker approval — org, role, shift and salary do not go live until approved.'
          : result.scheduled
            ? 'Future-dated assignment stored. Current values stay until the effective date.'
            : state.editingId
              ? result.employee.fullName + ' updated'
              : result.employee.fullName + ' added to the directory'
      );

      var editedId = state.editingId;
      closePanel();
      await loadEmployees();
      await loadQueue();
      if (editedId && location.hash.indexOf(editedId) !== -1) await renderProfile(editedId);
    } catch (err) {
      if (err.details && err.details.length) {
        err.details.forEach(function (detail) {
          setFieldError(detail.field, detail.message);
        });
      }
      el('form-error').textContent = err.message;
      el('form-error').classList.remove('hidden');
    } finally {
      setSubmitting(false);
    }
  }

  // ----------------------------------------------------------------- delete

  function askDelete(employee) {
    state.pendingDelete = employee;
    el('confirm-text').textContent =
      'This permanently removes ' +
      employee.fullName +
      ' (' +
      employee.employeeCode +
      ') from the directory. This cannot be undone.';
    el('confirm-backdrop').classList.remove('hidden');
    el('confirm-backdrop').classList.add('flex');
  }

  function closeConfirm() {
    el('confirm-backdrop').classList.add('hidden');
    el('confirm-backdrop').classList.remove('flex');
    state.pendingDelete = null;
  }

  async function confirmDelete() {
    if (!state.pendingDelete) return;
    var employee = state.pendingDelete;
    closeConfirm();

    try {
      var result = await api.request('/employees/' + employee.id, { method: 'DELETE' });
      toast(result.message);
      if (location.hash) location.hash = '';
      await loadEmployees();
      await loadQueue();
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'error');
    }
  }

  // ---------------------------------------------------------------- profile

  function detail(term, description) {
    return (
      '<div><dt class="text-xs text-slate-500">' +
      escapeHtml(term) +
      '</dt><dd class="mt-0.5 text-sm font-medium text-slate-900">' +
      description +
      '</dd></div>'
    );
  }

  function card(title, body, extraClass) {
    return (
      '<section class="rounded-xl border border-slate-200 bg-white p-6 shadow-card ' +
      (extraClass || '') +
      '">' +
      '<h2 class="text-xs font-semibold uppercase tracking-wider text-slate-400">' +
      escapeHtml(title) +
      '</h2>' +
      body +
      '</section>'
    );
  }

  function compensationCard(employee) {
    var compensation = employee.compensation || {};

    if (compensation.restricted) {
      return card(
        'Compensation',
        '<div class="mt-4 flex items-start gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">' +
          '<svg class="mt-0.5 h-5 w-5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>' +
          '<div><p class="text-sm font-medium text-slate-700">Restricted</p>' +
          '<p class="mt-0.5 text-sm text-slate-500">Salary details are visible to HR Admins, the employee themselves, and their direct manager.</p></div></div>'
      );
    }

    var currency = compensation.currency;
    var allowances = compensation.fixedAllowances || [];

    var allowanceRows = allowances.length
      ? allowances
          .map(function (item) {
            return (
              '<div class="flex items-center justify-between py-2 text-sm">' +
              '<span class="text-slate-600">' +
              escapeHtml(item.label) +
              '</span><span class="font-medium text-slate-900">' +
              escapeHtml(formatMoney(item.amount, currency)) +
              '</span></div>'
            );
          })
          .join('')
      : '<p class="py-2 text-sm text-slate-400">No fixed allowances.</p>';

    return card(
      'Compensation',
      '<div class="mt-4 flex items-baseline justify-between">' +
        '<span class="text-sm text-slate-600">Base salary</span>' +
        '<span class="text-2xl font-semibold tracking-tight text-slate-900">' +
        escapeHtml(formatMoney(compensation.baseSalary, currency)) +
        '</span></div>' +
        '<div class="mt-4 border-t border-slate-100 pt-2">' +
        '<p class="pb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Fixed allowances</p>' +
        '<div class="divide-y divide-slate-100">' +
        allowanceRows +
        '</div></div>' +
        '<div class="mt-4 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5">' +
        '<span class="text-sm font-medium text-slate-700">Gross monthly</span>' +
        '<span class="text-sm font-semibold text-slate-900">' +
        escapeHtml(formatMoney(employee.grossSalary, currency)) +
        '</span></div>'
    );
  }

  function profileHtml(employee) {
    var manager = employee.reportsTo;
    var managerText = manager
      ? '<a href="#/employee/' +
        (manager.id || manager._id) +
        '" class="text-slate-900 underline-offset-2 hover:underline">' +
        escapeHtml((manager.firstName || '') + ' ' + (manager.lastName || '')) +
        '</a>'
      : '<span class="text-slate-400">—</span>';

    var perms = employee.permissions || {};
    var person = employee.person || {};
    var actions = '';
    if (canManage()) {
      actions =
        '<div class="flex flex-wrap gap-2">' +
        '<button type="button" data-profile-edit class="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">Change</button>' +
        (['resigned', 'terminated'].indexOf(employee.employmentStatus) === -1
          ? '<button type="button" data-profile-separate class="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700">Separate</button>'
          : '<button type="button" data-profile-rehire class="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700">Rehire</button>') +
        '<button type="button" data-profile-delete class="rounded-lg border border-red-200 bg-white px-3.5 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50">Remove</button>' +
        '</div>';
    } else if (canRequest(employee)) {
      actions =
        '<button type="button" data-profile-request class="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">Request assignment change</button>';
    }

    var workingDays = 7 - ((employee.restDays && employee.restDays.length) || 0);
    var tab = currentProfileTab();
    var tabs = [
      ['overview', 'Overview'],
      ['personal', 'Personal'],
      ['employment', 'Employment'],
      ['compensation', 'Pay'],
      ['statutory', 'Statutory'],
      ['family', 'Family'],
      ['qualifications', 'Qualifications'],
      ['documents', 'Documents'],
      ['history', 'History'],
    ]
      .map(function (item) {
        var active = tab === item[0];
        return (
          '<a href="#/employee/' +
          employee.id +
          (item[0] === 'overview' ? '' : '/' + item[0]) +
          '" class="rounded-lg px-3 py-1.5 text-sm font-medium ' +
          (active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100') +
          '">' +
          item[1] +
          '</a>'
        );
      })
      .join('');

    function listTable(rows, empty) {
      if (!rows) return '<p class="mt-4 text-sm text-slate-500">' + empty + '</p>';
      return rows;
    }

    var cnic = (person.nationalIds && person.nationalIds[0] && person.nationalIds[0].number) || '';
    var overview =
      '<div class="mt-4 grid gap-4 lg:grid-cols-3">' +
      card(
        'Employment',
        '<dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-5">' +
          detail('Department', escapeHtml(employee.department)) +
          detail('Team', employee.team ? escapeHtml(employee.team) : '<span class="text-slate-400">—</span>') +
          detail('Position / designation', escapeHtml(employee.designation)) +
          detail('Grade', employee.grade ? escapeHtml(employee.grade) : '<span class="text-slate-400">—</span>') +
          detail('Location', employee.location ? escapeHtml(employee.location) : '<span class="text-slate-400">—</span>') +
          detail('Reports to', managerText) +
          detail('Date of joining', escapeHtml(formatDate(employee.dateOfJoining))) +
          detail('Probation end', escapeHtml(formatDate(employee.probationEndDate))) +
          '</dl>'
      ) +
      card(
        'Schedule',
        '<dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-5">' +
          detail('Shift', escapeHtml(employee.shift ? employee.shift.label : employee.shiftType)) +
          detail(
            'Working window',
            employee.shift && employee.shift.startTime
              ? escapeHtml(employee.shift.startTime + ' – ' + employee.shift.endTime)
              : '<span class="text-slate-400">Varies by roster</span>'
          ) +
          detail('Working days', workingDays + ' per week') +
          detail('Rest days', '<div class="flex flex-wrap gap-1">' + dayChips(employee.restDays) + '</div>') +
          detail('Annual leave', (employee.annualLeaveDays || 0) + ' days') +
          '</dl>'
      ) +
      compensationCard(employee) +
      '</div>' +
      currentAssignmentCard(employee);

    var personal =
      '<div class="mt-4">' +
      card(
        'Personal & contact',
        '<dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-5">' +
          detail('Preferred name', escapeHtml(employee.preferredName || person.preferredName || '—')) +
          detail('Father / guardian', escapeHtml(person.fatherName || '—')) +
          detail('Date of birth', escapeHtml(formatDate(employee.dateOfBirth))) +
          detail('Nationality', escapeHtml(person.nationality || '—')) +
          detail('Marital status', escapeHtml(person.maritalStatus || '—')) +
          detail('CNIC', cnic ? escapeHtml(cnic) : '<span class="text-slate-400">—</span>') +
          detail('Work email', escapeHtml(employee.email)) +
          detail('Mobile', escapeHtml(person.mobile || employee.phone || '—')) +
          detail('Address', escapeHtml(employee.address || '—')) +
          '</dl>'
      ) +
      '</div>';

    var familyRows = (employee.family || [])
      .map(function (row) {
        return (
          '<li class="flex justify-between gap-3 border-b border-slate-100 py-3 text-sm"><span>' +
          escapeHtml(row.name) +
          ' · ' +
          escapeHtml(row.relationship) +
          (row.isEmergency ? ' · emergency' : '') +
          '</span><span class="text-slate-500">' +
          escapeHtml(row.phone || '') +
          '</span></li>'
        );
      })
      .join('');
    var family = card(
      'Family, dependents & emergency',
      (perms.canEditLowRisk
        ? '<button type="button" data-add="family" class="mt-3 text-xs font-medium text-slate-700 underline">Add person</button>'
        : '') +
        (familyRows ? '<ul class="mt-2">' + familyRows + '</ul>' : '<p class="mt-4 text-sm text-slate-500">No family or emergency contacts on file.</p>')
    );

    var qualRows = (employee.qualifications || [])
      .map(function (row) {
        return (
          '<li class="border-b border-slate-100 py-3 text-sm"><p class="font-medium text-slate-900">' +
          escapeHtml(row.title) +
          '</p><p class="text-xs text-slate-500">' +
          escapeHtml(row.type + (row.institution ? ' · ' + row.institution : '')) +
          '</p></li>'
        );
      })
      .join('');
    var qualifications = card(
      'Qualifications & skills',
      (perms.canEditLowRisk
        ? '<button type="button" data-add="qualification" class="mt-3 text-xs font-medium text-slate-700 underline">Add qualification</button>'
        : '') +
        (qualRows ? '<ul class="mt-2">' + qualRows + '</ul>' : '<p class="mt-4 text-sm text-slate-500">No qualifications recorded.</p>')
    );

    var docRows = (employee.documents || [])
      .map(function (row) {
        return (
          '<li class="border-b border-slate-100 py-3 text-sm"><p class="font-medium text-slate-900">' +
          escapeHtml(row.title || row.type) +
          '</p><p class="text-xs text-slate-500">v' +
          row.version +
          ' · ' +
          escapeHtml(row.verificationStatus) +
          (row.expiresOn ? ' · exp ' + formatDate(row.expiresOn) : '') +
          (row.expired ? ' · expired' : row.expiringSoon ? ' · expiring' : '') +
          '</p></li>'
        );
      })
      .join('');
    var documents = card(
      'Documents',
      (canManage() || perms.canEditLowRisk
        ? '<button type="button" data-add="document" class="mt-3 text-xs font-medium text-slate-700 underline">Add document</button>'
        : '') +
        (docRows ? '<ul class="mt-2">' + docRows + '</ul>' : '<p class="mt-4 text-sm text-slate-500">No documents in the personnel file.</p>')
    );

    var bankRows = (employee.bankAccounts || [])
      .map(function (row) {
        return (
          '<li class="border-b border-slate-100 py-3 text-sm">' +
          assignmentBadge(row.status) +
          '<p class="mt-1 font-medium">' +
          escapeHtml(row.bankName || row.method) +
          '</p><p class="text-xs text-slate-500">' +
          escapeHtml(row.accountNumber || row.iban || '') +
          '</p></li>'
        );
      })
      .join('');
    var statRows = (employee.statutory || [])
      .map(function (row) {
        return (
          '<li class="border-b border-slate-100 py-3 text-sm">' +
          assignmentBadge(row.status) +
          '<p class="mt-1 font-medium">' +
          escapeHtml(row.scheme) +
          '</p><p class="text-xs text-slate-500">' +
          escapeHtml(row.membershipNumber || (row.covered ? 'Covered' : 'Not covered')) +
          '</p></li>'
        );
      })
      .join('');
    var compensationTab =
      '<div class="mt-4 grid gap-4 lg:grid-cols-2">' +
      compensationCard(employee) +
      card(
        'Bank / payment',
        (perms.canEditLowRisk
          ? '<button type="button" data-add="bank" class="mt-3 text-xs font-medium text-slate-700 underline">Request bank change</button>'
          : '') +
          (bankRows ? '<ul class="mt-2">' + bankRows + '</ul>' : '<p class="mt-4 text-sm text-slate-500">No payment instruction on file.</p>')
      ) +
      '</div>';
    var statutoryTab = card(
      'Statutory & benefits',
      (canManage()
        ? '<button type="button" data-add="statutory" class="mt-3 text-xs font-medium text-slate-700 underline">Add coverage</button>'
        : '') +
        (statRows ? '<ul class="mt-2">' + statRows + '</ul>' : '<p class="mt-4 text-sm text-slate-500">No statutory enrolments.</p>')
    );
    var employmentTab =
      '<div class="mt-4 grid gap-4 lg:grid-cols-2">' +
      card(
        'Employment & organization',
        '<dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-5">' +
          detail('Legal entity', escapeHtml(employee.legalEntity || 'PortoHR (Pvt) Ltd')) +
          detail('Category', escapeHtml(employee.employeeCategory || '—')) +
          detail('Pay group', escapeHtml(employee.payGroup || '—')) +
          detail('Org role', escapeHtml(employee.orgRole || '—')) +
          detail('Last working day', escapeHtml(formatDate(employee.lastWorkingDay))) +
          detail('Confirmation', escapeHtml(formatDate(employee.confirmationDate))) +
          '</dl>'
      ) +
      currentAssignmentCard(employee) +
      '</div>';
    var historyTab =
      timelineCard(employee, perms) +
      card(
        'Audit log',
        (employee.audit || []).length
          ? '<ul class="mt-3">' +
            (employee.audit || [])
              .map(function (row) {
                return (
                  '<li class="border-b border-slate-100 py-2 text-xs text-slate-600">' +
                  escapeHtml(formatDate(row.createdAt)) +
                  ' · ' +
                  escapeHtml(row.actorName || row.role || '') +
                  ' · ' +
                  escapeHtml(row.action) +
                  (row.summary ? ' — ' + escapeHtml(row.summary) : '') +
                  '</li>'
                );
              })
              .join('') +
            '</ul>'
          : '<p class="mt-4 text-sm text-slate-500">No audit entries yet.</p>'
      );

    var body = overview;
    if (tab === 'personal') body = personal;
    else if (tab === 'employment') body = employmentTab;
    else if (tab === 'compensation') body = compensationTab;
    else if (tab === 'statutory') body = statutoryTab;
    else if (tab === 'family') body = family;
    else if (tab === 'qualifications') body = qualifications;
    else if (tab === 'documents') body = documents;
    else if (tab === 'history') body = historyTab;

    return (
      '<a href="#" class="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-900">' +
      '<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" /></svg>' +
      'Back to directory</a>' +
      '<div class="mt-4 flex flex-wrap items-start justify-between gap-6 rounded-xl border border-slate-200 bg-white p-6 shadow-card">' +
      '<div class="flex items-center gap-5">' +
      avatar(employee.fullName, 'lg') +
      '<div>' +
      '<h1 class="text-xl font-semibold tracking-tight text-slate-900">' +
      escapeHtml(employee.preferredName || employee.fullName) +
      '</h1>' +
      '<p class="mt-0.5 text-sm text-slate-500">' +
      escapeHtml(employee.designation) +
      ' · ' +
      escapeHtml(employee.department) +
      (employee.location ? ' · ' + escapeHtml(employee.location) : '') +
      (employee.grade ? ' · ' + escapeHtml(employee.grade) : '') +
      '</p>' +
      '<div class="mt-3 flex flex-wrap items-center gap-2">' +
      statusBadge(employee.employmentStatus) +
      '<span class="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">' +
      escapeHtml(employee.employeeCode) +
      '</span></div></div></div>' +
      actions +
      '</div>' +
      pendingBanner(employee) +
      '<nav class="mt-4 flex flex-wrap gap-1">' +
      tabs +
      '</nav>' +
      body
    );
  }

  function pendingBanner(employee) {
    var pending = employee.pendingAssignment;
    if (!pending) return '';
    var own = isOwnRequest(pending);
    return (
      '<div class="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">' +
      '<p class="font-medium">A role or salary change is waiting for a checker</p>' +
      '<p class="mt-0.5 text-amber-800">' +
      escapeHtml((pending.changedFields || []).join(', ') || 'Assignment') +
      ' from ' +
      escapeHtml(formatDate(pending.effectiveFrom)) +
      (pending.reason ? ' · ' + escapeHtml(pending.reason) : '') +
      (own ? '. You requested this change, so someone else must approve it.' : '.') +
      '</p></div>'
    );
  }

  function fieldChips(fields) {
    if (!fields || !fields.length) return '';
    return (
      '<div class="mt-2 flex flex-wrap gap-1">' +
      fields
        .map(function (field) {
          return (
            '<span class="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">' +
            escapeHtml(field) +
            '</span>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function assignmentSummary(row, showPay) {
    var pay = '';
    if (showPay && row.compensation && !row.compensation.restricted) {
      pay =
        '<p class="mt-1 text-sm text-slate-600">Gross ' +
        escapeHtml(formatMoney(row.grossSalary, row.compensation.currency)) +
        '</p>';
    }
    return (
      '<p class="text-sm font-medium text-slate-900">' +
      escapeHtml(row.designation) +
      ' · ' +
      escapeHtml(row.department) +
      (row.team ? ' · ' + escapeHtml(row.team) : '') +
      '</p>' +
      '<p class="mt-0.5 text-xs text-slate-500">' +
      escapeHtml(row.shift ? row.shift.label : row.shiftType) +
      ' · ' +
      escapeHtml(formatDate(row.effectiveFrom)) +
      (row.effectiveTo ? ' – ' + escapeHtml(formatDate(row.effectiveTo)) : ' – present') +
      '</p>' +
      pay +
      fieldChips(row.changedFields) +
      (row.reason ? '<p class="mt-2 text-sm text-slate-600">' + escapeHtml(row.reason) + '</p>' : '')
    );
  }

  function currentAssignmentCard(employee) {
    var current = employee.currentAssignment;
    if (!current) {
      return '<div class="mt-4">' + card('Current assignment', '<p class="mt-4 text-sm text-slate-500">No active assignment yet.</p>') + '</div>';
    }
    var showPay = !(employee.compensation && employee.compensation.restricted);
    return (
      '<div class="mt-4">' +
      card(
        'Current assignment',
        '<div class="mt-4 flex flex-wrap items-start justify-between gap-3">' +
          '<div>' +
          assignmentSummary(current, showPay) +
          '</div>' +
          assignmentBadge('active') +
          '</div>'
      ) +
      '</div>'
    );
  }

  function timelineCard(employee, perms) {
    var history = employee.history || [];
    if (!history.length) return '';
    var showPay = !(employee.compensation && employee.compensation.restricted);
    var items = history
      .map(function (row) {
        var actions = '';
        if (row.status === 'pending' && perms.canDecide && !isOwnRequest(row)) {
          actions =
            '<div class="mt-3 flex gap-2">' +
            '<button type="button" data-decide="' +
            escapeHtml(row.id) +
            '" data-decision="approved" class="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">Approve</button>' +
            '<button type="button" data-decide="' +
            escapeHtml(row.id) +
            '" data-decision="rejected" class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700">Reject</button>' +
            '</div>';
        }
        return (
          '<li class="relative pl-8">' +
          '<span class="absolute left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ' +
          (row.status === 'active' ? 'bg-slate-900' : row.status === 'pending' ? 'bg-amber-500' : 'bg-slate-300') +
          '"></span>' +
          '<div class="flex flex-wrap items-start justify-between gap-2">' +
          '<div class="min-w-0">' +
          assignmentSummary(row, showPay) +
          actions +
          '</div>' +
          assignmentBadge(row.status) +
          '</div></li>'
        );
      })
      .join('');

    return (
      '<div class="mt-4">' +
      card(
        'Assignment history',
        '<p class="mt-1 text-xs text-slate-500">Each department, team, shift, role or salary change is a new dated row. Previous values stay on the record.</p>' +
          '<ol class="relative mt-5 space-y-6 border-l border-slate-200">' +
          items +
          '</ol>'
      ) +
      '</div>'
    );
  }

  async function renderProfile(id) {
    var view = el('view-profile');
    view.innerHTML =
      '<p class="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Loading employee…</p>';

    try {
      var result = await api.get('/employees/' + id);
      view.innerHTML = profileHtml(result.employee);

      var editButton = view.querySelector('[data-profile-edit]');
      if (editButton)
        editButton.addEventListener('click', function () {
          openPanel(result.employee);
        });

      var deleteButton = view.querySelector('[data-profile-delete]');
      if (deleteButton)
        deleteButton.addEventListener('click', function () {
          askDelete(result.employee);
        });

      var requestButton = view.querySelector('[data-profile-request]');
      if (requestButton)
        requestButton.addEventListener('click', function () {
          openPanel(result.employee, 'request');
        });

      var separateButton = view.querySelector('[data-profile-separate]');
      if (separateButton)
        separateButton.addEventListener('click', function () {
          openRecord('separate', result.employee);
        });
      var rehireButton = view.querySelector('[data-profile-rehire]');
      if (rehireButton)
        rehireButton.addEventListener('click', function () {
          openRecord('rehire', result.employee);
        });
      view.querySelectorAll('[data-add]').forEach(function (button) {
        button.addEventListener('click', function () {
          openRecord(button.getAttribute('data-add'), result.employee);
        });
      });

      view.querySelectorAll('[data-decide]').forEach(function (button) {
        button.addEventListener('click', function () {
          openDecision(button.getAttribute('data-decide'), button.getAttribute('data-decision'));
        });
      });
    } catch (err) {
      if (err.status === 401) return;
      view.innerHTML =
        '<div class="rounded-xl border border-slate-200 bg-white p-10 text-center">' +
        '<h2 class="text-sm font-semibold text-red-700">Could not load this employee</h2>' +
        '<p class="mt-1 text-sm text-slate-500">' +
        escapeHtml(err.message) +
        '</p>' +
        '<a href="#" class="mt-4 inline-block text-sm font-medium text-slate-900 underline-offset-2 hover:underline">Back to directory</a></div>';
    }
  }

  // ---------------------------------------------------------------- routing

  function currentEmployeeId() {
    var match = /^#\/employee\/([A-Za-z0-9]+)(?:\/[a-z]+)?$/.exec(window.location.hash);
    return match ? match[1] : null;
  }

  function currentProfileTab() {
    var match = /^#\/employee\/[A-Za-z0-9]+\/([a-z]+)$/.exec(window.location.hash);
    return match ? match[1] : 'overview';
  }

  function currentView() {
    if (window.location.hash.indexOf('#/org') === 0) return 'org';
    if (window.location.hash.indexOf('#/reports') === 0) return 'reports';
    if (currentEmployeeId()) return 'profile';
    return 'list';
  }

  async function handleRoute() {
    var view = currentView();
    el('view-list').classList.toggle('hidden', view !== 'list');
    el('view-profile').classList.toggle('hidden', view !== 'profile');
    el('view-org').classList.toggle('hidden', view !== 'org');
    el('view-reports').classList.toggle('hidden', view !== 'reports');

    if (view === 'profile') await renderProfile(currentEmployeeId());
    else el('view-profile').innerHTML = '';
    if (view === 'org') await renderOrg();
    if (view === 'reports') await renderReports();
  }

  async function loadAlerts() {
    var box = el('alerts-strip');
    if (!box) return;
    try {
      var result = await api.get('/employees/alerts');
      var items = result.alerts || [];
      if (!items.length) {
        box.classList.add('hidden');
        box.innerHTML = '';
        return;
      }
      box.classList.remove('hidden');
      box.innerHTML =
        '<div class="rounded-xl border border-slate-200 bg-white p-4 shadow-card">' +
        '<h2 class="text-sm font-semibold text-slate-900">Alerts</h2>' +
        '<ul class="mt-3 space-y-2">' +
        items
          .slice(0, 8)
          .map(function (item) {
            var emp = item.employee || {};
            var name = emp.fullName || ((emp.firstName || '') + ' ' + (emp.lastName || '')).trim();
            return (
              '<li class="flex flex-wrap items-center justify-between gap-2 text-sm">' +
              '<span class="text-slate-700">' +
              escapeHtml(item.message) +
              (name ? ' · ' + escapeHtml(name) : '') +
              '</span>' +
              (emp.id || emp._id
                ? '<a href="#/employee/' +
                  escapeHtml(String(emp.id || emp._id)) +
                  '" class="text-xs font-medium text-slate-900 underline">Open</a>'
                : '') +
              '</li>'
            );
          })
          .join('') +
        '</ul></div>';
    } catch (err) {
      box.classList.add('hidden');
    }
  }

  async function renderOrg() {
    var view = el('view-org');
    view.innerHTML = '<p class="text-sm text-slate-500">Loading organization…</p>';
    try {
      var units = await api.get('/org/units');
      var grades = await api.get('/org/grades');
      var positions = await api.get('/org/positions');
      view.innerHTML =
        '<div class="flex items-end justify-between gap-4"><div><h1 class="text-2xl font-semibold tracking-tight">Organization</h1><p class="mt-1 text-sm text-slate-500">Cluster → department → team → approved position. Headcount is derived from position FTE.</p></div><a href="#" class="text-sm text-slate-600 underline">Back to directory</a></div>' +
        '<div class="mt-6 grid gap-4 lg:grid-cols-2">' +
        card(
          'Teams',
          '<ul class="mt-3 divide-y divide-slate-100">' +
            (units.units || [])
              .filter(function (row) {
                return row.type === 'team';
              })
              .map(function (row) {
                return (
                  '<li class="py-2 text-sm"><span class="font-medium text-slate-900">' +
                  escapeHtml(row.name) +
                  '</span> <span class="text-xs text-slate-500">' +
                  escapeHtml(row.code) +
                  '</span></li>'
                );
              })
              .join('') +
            '</ul>'
        ) +
        card(
          'Grades',
          '<ul class="mt-3 divide-y divide-slate-100">' +
            (grades.grades || [])
              .map(function (row) {
                return (
                  '<li class="py-2 text-sm"><span class="font-medium">' +
                  escapeHtml(row.code) +
                  '</span> · ' +
                  escapeHtml(row.name) +
                  '</li>'
                );
              })
              .join('') +
            '</ul>'
        ) +
        '</div>' +
        '<div class="mt-4">' +
        card(
          'Positions',
          '<div class="mt-3 overflow-x-auto"><table class="min-w-full text-sm"><thead><tr class="text-left text-xs uppercase text-slate-500"><th class="py-2">Code</th><th>Title</th><th>Grade</th><th>Team</th><th>Status</th></tr></thead><tbody>' +
            (positions.positions || [])
              .map(function (row) {
                return (
                  '<tr class="border-t border-slate-100"><td class="py-2">' +
                  escapeHtml(row.positionCode) +
                  '</td><td>' +
                  escapeHtml(row.title) +
                  '</td><td>' +
                  escapeHtml((row.grade && (row.grade.code || row.grade.name)) || '—') +
                  '</td><td>' +
                  escapeHtml((row.team && row.team.name) || '—') +
                  '</td><td>' +
                  escapeHtml(row.status) +
                  '</td></tr>'
                );
              })
              .join('') +
            '</tbody></table></div>'
        ) +
        '</div>';
    } catch (err) {
      view.innerHTML = '<p class="text-sm text-red-600">' + escapeHtml(err.message) + '</p>';
    }
  }

  async function renderReports() {
    var view = el('view-reports');
    view.innerHTML = '<p class="text-sm text-slate-500">Loading reports…</p>';
    try {
      var result = await api.get('/employees/reports');
      var report = result.report || {};
      view.innerHTML =
        '<div class="flex items-end justify-between gap-4"><div><h1 class="text-2xl font-semibold tracking-tight">Core HR reports</h1><p class="mt-1 text-sm text-slate-500">Headcount, vacancies and pending maker-checker items.</p></div><a href="#" class="text-sm text-slate-600 underline">Back to directory</a></div>' +
        '<div class="mt-6 grid gap-4 lg:grid-cols-2">' +
        card(
          'Employment status',
          '<ul class="mt-3 space-y-2">' +
            (report.byStatus || [])
              .map(function (row) {
                return (
                  '<li class="flex justify-between text-sm"><span>' +
                  escapeHtml(labelFor(state.meta.employmentStatuses, row.status)) +
                  '</span><span class="font-medium">' +
                  row.count +
                  '</span></li>'
                );
              })
              .join('') +
            '</ul>'
        ) +
        card(
          'Department headcount',
          '<ul class="mt-3 space-y-2">' +
            (report.byDepartment || [])
              .map(function (row) {
                return (
                  '<li class="flex justify-between text-sm"><span>' +
                  escapeHtml(row.department) +
                  '</span><span class="font-medium">' +
                  row.count +
                  '</span></li>'
                );
              })
              .join('') +
            '</ul>'
        ) +
        card(
          'Team headcount vs vacant FTE',
          '<ul class="mt-3 space-y-2">' +
            (report.teams || [])
              .map(function (row) {
                return (
                  '<li class="flex justify-between text-sm"><span>' +
                  escapeHtml(row.name) +
                  '</span><span>' +
                  row.filled +
                  ' / ' +
                  row.approved +
                  ' · vacant ' +
                  row.vacant +
                  '</span></li>'
                );
              })
              .join('') +
            '</ul>'
        ) +
        card('Pending assignment changes', '<p class="mt-4 text-2xl font-semibold">' + (report.pendingChanges || 0) + '</p>') +
        '</div>';
    } catch (err) {
      view.innerHTML = '<p class="text-sm text-red-600">' + escapeHtml(err.message) + '</p>';
    }
  }

  var recordContext = null;

  function fieldInput(name, label, type) {
    return (
      '<div><label class="block text-sm font-medium text-slate-700">' +
      label +
      '</label><input name="' +
      name +
      '" type="' +
      (type || 'text') +
      '" class="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div>'
    );
  }

  function openRecord(kind, employee) {
    recordContext = { kind: kind, employee: employee };
    var form = el('record-form');
    el('record-error').classList.add('hidden');
    var title = {
      family: 'Add family / emergency contact',
      qualification: 'Add qualification',
      document: 'Add document',
      bank: 'Bank / payment change',
      statutory: 'Statutory enrolment',
      separate: 'Separate employee',
      rehire: 'Rehire employee',
    };
    el('record-title').textContent = title[kind] || 'Add record';
    if (kind === 'family') form.innerHTML = fieldInput('name', 'Name') + fieldInput('relationship', 'Relationship') + fieldInput('phone', 'Phone');
    else if (kind === 'qualification') form.innerHTML = fieldInput('title', 'Title') + fieldInput('type', 'Type') + fieldInput('institution', 'Institution');
    else if (kind === 'document') form.innerHTML = fieldInput('type', 'Type (cnic, contract…)') + fieldInput('title', 'Title') + fieldInput('reference', 'Reference') + fieldInput('expiresOn', 'Expiry', 'date');
    else if (kind === 'bank') form.innerHTML = fieldInput('bankName', 'Bank') + fieldInput('accountTitle', 'Account title') + fieldInput('accountNumber', 'Account number') + fieldInput('iban', 'IBAN') + fieldInput('reason', 'Reason');
    else if (kind === 'statutory') form.innerHTML = fieldInput('scheme', 'Scheme (eobi, provident_fund…)') + fieldInput('membershipNumber', 'Membership no.');
    else if (kind === 'separate') form.innerHTML = fieldInput('lastWorkingDay', 'Last working day', 'date') + fieldInput('terminationDate', 'Termination date', 'date') + fieldInput('separationType', 'Type (resignation…)') + fieldInput('reason', 'Reason');
    else if (kind === 'rehire') form.innerHTML = fieldInput('dateOfJoining', 'New hire date', 'date') + fieldInput('designation', 'Designation') + fieldInput('department', 'Department');
    el('record-backdrop').classList.remove('hidden');
    el('record-backdrop').classList.add('flex');
  }

  function closeRecord() {
    recordContext = null;
    el('record-backdrop').classList.add('hidden');
    el('record-backdrop').classList.remove('flex');
  }

  async function submitRecord() {
    if (!recordContext) return;
    var form = el('record-form');
    var data = {};
    Array.prototype.slice.call(form.querySelectorAll('input')).forEach(function (input) {
      if (input.value) data[input.name] = input.value;
    });
    var id = recordContext.employee.id;
    var kind = recordContext.kind;
    try {
      if (kind === 'family') await api.post('/employees/' + id + '/family', data);
      else if (kind === 'qualification') await api.post('/employees/' + id + '/qualifications', data);
      else if (kind === 'document') await api.post('/employees/' + id + '/documents', data);
      else if (kind === 'bank') await api.post('/employees/' + id + '/bank', data);
      else if (kind === 'statutory') await api.post('/employees/' + id + '/statutory', data);
      else if (kind === 'separate') await api.post('/employees/' + id + '/separate', data);
      else if (kind === 'rehire') await api.post('/employees/' + id + '/rehire', data);
      closeRecord();
      toast('Saved');
      await renderProfile(id);
      await loadEmployees();
      await loadQueue();
      await loadAlerts();
    } catch (err) {
      el('record-error').textContent = err.message;
      el('record-error').classList.remove('hidden');
    }
  }

  async function loadPositionOptions() {
    try {
      var result = await api.get('/org/positions');
      var options = (result.positions || []).filter(function (row) {
        return row.status === 'vacant' || row.status === 'approved' || row.status === 'filled';
      });
      fillSelect(
        el('f-position'),
        options.map(function (row) {
          return { value: row.id, label: row.positionCode + ' · ' + row.title };
        }),
        'Create from designation / team'
      );
    } catch (err) {
      /* hire can still proceed without a pre-created seat */
    }
  }

  // ------------------------------------------------------------------ wiring

  function wireFilters() {
    var debounce;
    el('filter-q').addEventListener('input', function (event) {
      window.clearTimeout(debounce);
      var value = event.target.value;
      debounce = window.setTimeout(function () {
        state.filters.q = value;
        state.page = 1;
        loadEmployees();
      }, 300);
    });

    [
      ['filter-department', 'department'],
      ['filter-status', 'employmentStatus'],
      ['filter-shift', 'shiftType'],
    ].forEach(function (pair) {
      el(pair[0]).addEventListener('change', function (event) {
        state.filters[pair[1]] = event.target.value;
        state.page = 1;
        loadEmployees();
      });
    });

    el('page-prev').addEventListener('click', function () {
      if (state.page > 1) {
        state.page -= 1;
        loadEmployees();
      }
    });
    el('page-next').addEventListener('click', function () {
      if (state.page < state.pages) {
        state.page += 1;
        loadEmployees();
      }
    });
  }

  function wireTableActions() {
    el('employee-rows').addEventListener('click', function (event) {
      var editButton = event.target.closest('[data-edit]');
      if (editButton) {
        var toEdit = state.employees.filter(function (item) {
          return item.id === editButton.getAttribute('data-edit');
        })[0];
        if (toEdit) openPanel(toEdit);
        return;
      }

      var deleteButton = event.target.closest('[data-delete]');
      if (deleteButton) {
        var toDelete = state.employees.filter(function (item) {
          return item.id === deleteButton.getAttribute('data-delete');
        })[0];
        if (toDelete) askDelete(toDelete);
      }
    });
  }

  function wirePanel() {
    el('btn-new-employee').addEventListener('click', function () {
      openPanel(null);
    });
    el('panel-close').addEventListener('click', closePanel);
    el('panel-cancel').addEventListener('click', closePanel);
    el('panel-backdrop').addEventListener('click', closePanel);
    el('employee-form').addEventListener('submit', submitForm);

    el('add-allowance').addEventListener('click', function () {
      el('allowance-rows').insertAdjacentHTML('beforeend', allowanceRow(null));
      syncAllowanceState();
    });

    el('allowance-rows').addEventListener('click', function (event) {
      var remove = event.target.closest('[data-remove-allowance]');
      if (!remove) return;
      remove.closest('[data-allowance-row]').remove();
      syncAllowanceState();
    });

    el('allowance-rows').addEventListener('input', updateGrossPreview);
    el('f-baseSalary').addEventListener('input', updateGrossPreview);
    el('f-currency').addEventListener('change', updateGrossPreview);
    el('f-shiftType').addEventListener('change', updateShiftHint);

    el('confirm-cancel').addEventListener('click', closeConfirm);
    el('confirm-accept').addEventListener('click', confirmDelete);

    el('decision-cancel').addEventListener('click', closeDecision);
    el('decision-ok').addEventListener('click', confirmDecision);
    el('decision-backdrop').addEventListener('click', function (event) {
      if (event.target === el('decision-backdrop')) closeDecision();
    });

    el('record-cancel').addEventListener('click', closeRecord);
    el('record-ok').addEventListener('click', submitRecord);
    el('record-backdrop').addEventListener('click', function (event) {
      if (event.target === el('record-backdrop')) closeRecord();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      if (!el('decision-backdrop').classList.contains('hidden')) closeDecision();
      else if (!el('record-backdrop').classList.contains('hidden')) closeRecord();
      else if (!el('confirm-backdrop').classList.contains('hidden')) closeConfirm();
      else if (!el('panel').classList.contains('translate-x-full')) closePanel();
    });
  }

  // --------------------------------------------------------------------- go

  async function init() {
    var user = await shell.mount('core_hr');
    if (!user) return;
    state.user = user;

    if (canManage()) {
      el('btn-new-employee').classList.remove('hidden');
      el('btn-new-employee').classList.add('inline-flex');
    }

    var result = await api.get('/employees/meta');
    state.meta = result.meta;
    applyMeta();

    wireFilters();
    wireTableActions();
    wirePanel();

    window.addEventListener('hashchange', handleRoute);

    await loadEmployees();
    await loadQueue();
    await loadAlerts();
    await handleRoute();
  }

  init().catch(function (err) {
    if (err && err.status === 401) return;
    console.error('Core HR failed to initialise', err);
  });
})(window, document);
