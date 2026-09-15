/* Payroll: HR pay runs, the payslip register, and the printable payslip. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var shell = window.PortoHR.shell;

  var state = {
    user: null,
    meta: null,
    payslips: [],
    totals: null,
    filters: { month: '', status: '' },
    tab: 'payslips',
    arrears: [],
    people: [],
    busy: false,
    confirm: null,
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

  function canManage() {
    return state.user && state.user.role === 'hr_admin';
  }

  /** Payroll always shows both decimal places — a rounded payslip is wrong. */
  function money(amount, currency) {
    if (typeof amount !== 'number') return '—';
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency || 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch (err) {
      return (currency || '') + ' ' + amount.toFixed(2);
    }
  }

  function formatHours(hours) {
    if (!hours) return '0h';
    var whole = Math.floor(hours);
    var minutes = Math.round((hours - whole) * 60);
    if (minutes === 60) {
      whole += 1;
      minutes = 0;
    }
    return whole + 'h' + (minutes ? ' ' + minutes + 'm' : '');
  }

  function monthLabel(month) {
    if (!month) return '—';
    var parts = month.split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, 1).toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
    });
  }

  function formatDate(value) {
    if (!value) return '—';
    var date = new Date(value);
    return isNaN(date.getTime())
      ? '—'
      : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /** 0.07 * 100 is 7.000000000000001 in binary, so round before trimming. */
  function percent(rate) {
    return Number((Math.round(rate * 1e6) / 1e4).toFixed(4)) + '%';
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

  var STATUS_TONES = {
    draft: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    finalised: 'bg-sky-50 text-sky-700 ring-sky-600/20',
    simulated: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    posted: 'bg-sky-50 text-sky-700 ring-sky-600/20',
    paid: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    cancelled: 'bg-slate-100 text-slate-500 ring-slate-500/20',
  };

  function statusLabel(status) {
    var statuses = ((state.meta && state.meta.statuses) || []).concat((state.meta && state.meta.arrearsStatuses) || []);
    var match = statuses.filter(function (item) {
      return item.value === status;
    })[0];
    return match ? match.label : status;
  }

  function statusBadge(status) {
    return (
      '<span class="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ' +
      (STATUS_TONES[status] || STATUS_TONES.draft) +
      '">' +
      escapeHtml(statusLabel(status)) +
      '</span>'
    );
  }

  function toast(message, tone) {
    var toneClass =
      tone === 'error'
        ? 'border-red-200 bg-red-50 text-red-800'
        : 'border-emerald-200 bg-emerald-50 text-emerald-800';
    var node = document.createElement('div');
    node.className =
      'max-w-sm rounded-lg border px-4 py-2.5 text-sm shadow-lg transition-opacity duration-300 ' + toneClass;
    node.textContent = message;
    el('toasts').appendChild(node);
    window.setTimeout(function () {
      node.classList.add('opacity-0');
      window.setTimeout(function () {
        node.remove();
      }, 300);
    }, 4200);
  }

  function askConfirm(title, text, onConfirm) {
    el('confirm-title').textContent = title;
    el('confirm-text').textContent = text;
    state.confirm = onConfirm;
    el('confirm-backdrop').classList.remove('hidden');
  }

  function closeConfirm() {
    state.confirm = null;
    el('confirm-backdrop').classList.add('hidden');
  }

  function previousMonth() {
    var now = new Date();
    var date = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
  }

  // ------------------------------------------------------------ batch tiles

  function tile(label, value, sub) {
    return (
      '<div class="rounded-xl border border-slate-200 bg-white p-5 shadow-card">' +
      '<p class="text-xs font-medium uppercase tracking-wider text-slate-400">' + escapeHtml(label) + '</p>' +
      '<p class="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-slate-900">' + escapeHtml(value) + '</p>' +
      '<p class="mt-0.5 text-xs text-slate-500">' + escapeHtml(sub) + '</p></div>'
    );
  }

  function renderTiles() {
    var totals = state.totals || {};
    var currency = (state.payslips[0] && state.payslips[0].currency) || 'USD';
    var scope = state.filters.month ? monthLabel(state.filters.month) : 'all periods';

    el('batch-tiles').innerHTML =
      tile('Payslips', String(totals.headcount || 0), scope) +
      tile('Gross', money(totals.gross || 0, currency), 'earnings including overtime') +
      tile('Deductions', money(totals.deductions || 0, currency), money(totals.tax || 0, currency) + ' of it income tax') +
      tile('Net payable', money(totals.net || 0, currency), 'after all deductions');
  }

  // --------------------------------------------------------------- register

  function rowActions(payslip) {
    var buttons = [
      '<button type="button" data-view="' + escapeHtml(payslip.id) + '" class="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50">View</button>',
    ];

    if (canManage()) {
      if (payslip.status === 'draft') {
        buttons.push('<button type="button" data-status="finalised" data-id="' + escapeHtml(payslip.id) + '" class="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-slate-800">Finalise</button>');
        buttons.push('<button type="button" data-delete="' + escapeHtml(payslip.id) + '" class="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50">Delete</button>');
      } else if (payslip.status === 'finalised') {
        buttons.push('<button type="button" data-status="paid" data-id="' + escapeHtml(payslip.id) + '" class="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-emerald-700">Mark paid</button>');
        buttons.push('<button type="button" data-status="draft" data-id="' + escapeHtml(payslip.id) + '" class="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50">Reopen</button>');
      }
    }

    return '<div class="flex justify-end gap-1.5">' + buttons.join('') + '</div>';
  }

  function payslipRow(payslip) {
    var currency = payslip.currency;
    var warned = payslip.warnings && payslip.warnings.length;

    return (
      '<tr class="transition hover:bg-slate-50">' +
      '<td class="px-6 py-3">' +
      '<div class="flex items-center gap-3">' +
      '<span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">' + escapeHtml(initials(payslip.snapshot.fullName)) + '</span>' +
      '<div><p class="font-medium text-slate-900">' + escapeHtml(payslip.snapshot.fullName) + '</p>' +
      '<p class="text-xs text-slate-500">' + escapeHtml(payslip.snapshot.employeeCode) + ' · ' + escapeHtml(payslip.snapshot.designation) + '</p></div>' +
      '</div></td>' +
      '<td class="whitespace-nowrap px-6 py-3 text-slate-700">' + escapeHtml(monthLabel(payslip.month)) +
      (warned ? '<span title="This payslip has notes" class="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700">!</span>' : '') +
      '</td>' +
      '<td class="whitespace-nowrap px-6 py-3 text-right tabular-nums text-slate-900">' + escapeHtml(money(payslip.earnings.gross, currency)) + '</td>' +
      '<td class="whitespace-nowrap px-6 py-3 text-right tabular-nums ' + (payslip.earnings.overtimePay > 0 ? 'font-medium text-emerald-600' : 'text-slate-400') + '">' + escapeHtml(payslip.earnings.overtimePay > 0 ? money(payslip.earnings.overtimePay, currency) : '—') + '</td>' +
      '<td class="whitespace-nowrap px-6 py-3 text-right tabular-nums text-red-600">' + escapeHtml(money(payslip.deductions.total, currency)) + '</td>' +
      '<td class="whitespace-nowrap px-6 py-3 text-right font-semibold tabular-nums text-slate-900">' + escapeHtml(money(payslip.netPay, currency)) + '</td>' +
      '<td class="px-6 py-3">' + statusBadge(payslip.status) + '</td>' +
      '<td class="px-6 py-3">' + rowActions(payslip) + '</td>' +
      '</tr>'
    );
  }

  function renderRegister() {
    var empty = state.payslips.length === 0;
    el('register-empty').classList.toggle('hidden', !empty);
    el('payslip-rows').innerHTML = state.payslips.map(payslipRow).join('');

    el('empty-title').textContent = canManage() ? 'No payslips for this filter' : 'No payslips yet';
    el('empty-text').textContent = canManage()
      ? 'Pick a pay period above and run the batch to generate payslips.'
      : 'Payslips appear here once HR has finalised the pay run for a month.';

    el('register-caption').textContent =
      state.payslips.length +
      (state.payslips.length === 1 ? ' payslip' : ' payslips') +
      (state.filters.month ? ' for ' + monthLabel(state.filters.month) : '') +
      (state.filters.status ? ' · ' + statusLabel(state.filters.status) : '');

    renderTiles();
  }

  function buildQuery() {
    var parts = [];
    if (state.filters.month) parts.push('month=' + encodeURIComponent(state.filters.month));
    if (state.filters.status) parts.push('status=' + encodeURIComponent(state.filters.status));
    return parts.length ? '?' + parts.join('&') : '';
  }

  async function loadPayslips() {
    try {
      var result = await api.get('/payroll' + buildQuery());
      state.payslips = result.payslips;
      state.totals = result.totals;
      renderRegister();
    } catch (err) {
      if (err.status === 401) return;
      toast(err.message, 'error');
    }
  }

  // -------------------------------------------------------------- pay runs

  async function generateBatch() {
    if (state.busy) return;
    var month = el('run-month').value;
    if (!month) {
      toast('Choose a pay period first', 'error');
      return;
    }

    state.busy = true;
    el('btn-generate').disabled = true;
    el('generate-spinner').classList.remove('hidden');
    el('generate-text').textContent = 'Running…';

    try {
      var result = await api.post('/payroll/generate', { month: month });
      var written = result.created + result.regenerated;
      var summary =
        written +
        ' payslip' +
        (written === 1 ? '' : 's') +
        ' for ' +
        monthLabel(result.month) +
        ' · net ' +
        money(result.totals.net, (result.payslips[0] || {}).currency);

      toast(
        result.skipped.length
          ? summary + ' · ' + result.skipped.length + ' skipped (already approved)'
          : summary
      );

      // Show what was just produced.
      state.filters.month = result.month;
      el('filter-month').value = result.month;
      await loadPayslips();
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'error');
    } finally {
      state.busy = false;
      el('btn-generate').disabled = false;
      el('generate-spinner').classList.add('hidden');
      el('generate-text').textContent = 'Generate payroll batch';
    }
  }

  async function changeStatus(id, status) {
    try {
      var result = await api.request('/payroll/' + id + '/status', {
        method: 'PATCH',
        body: { status: status },
      });
      toast(result.message);
      await loadPayslips();
      if (currentPayslipId() === id) await renderPayslip(id);
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'error');
    }
  }

  async function deletePayslip(id) {
    try {
      var result = await api.request('/payroll/' + id, { method: 'DELETE' });
      toast(result.message);
      if (currentPayslipId() === id) window.location.hash = '';
      await loadPayslips();
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'error');
    }
  }

  // ------------------------------------------------------- printable payslip

  function line(label, value, options) {
    var opts = options || {};
    return (
      '<div class="flex items-baseline justify-between gap-4 py-1.5 ' + (opts.strong ? 'border-t border-slate-200 pt-2.5 mt-1.5' : '') + '">' +
      '<span class="' + (opts.strong ? 'text-sm font-semibold text-slate-900' : 'text-sm text-slate-600') + '">' + escapeHtml(label) + '</span>' +
      '<span class="tabular-nums ' + (opts.strong ? 'text-sm font-semibold' : 'text-sm') + ' ' + (opts.tone || 'text-slate-900') + '">' + escapeHtml(value) + '</span>' +
      '</div>'
    );
  }

  function metaCell(label, value) {
    return (
      '<div><dt class="text-xs uppercase tracking-wide text-slate-400">' + escapeHtml(label) + '</dt>' +
      '<dd class="mt-0.5 text-sm font-medium text-slate-900">' + escapeHtml(value) + '</dd></div>'
    );
  }

  function payslipActions(payslip) {
    var buttons = [
      '<button type="button" id="btn-back" class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">Back</button>',
      '<button type="button" id="btn-print" class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800">Print payslip</button>',
    ];

    if (canManage()) {
      if (payslip.status === 'draft') {
        buttons.push('<button type="button" data-status="finalised" data-id="' + escapeHtml(payslip.id) + '" class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">Finalise</button>');
      } else if (payslip.status === 'finalised') {
        buttons.push('<button type="button" data-status="paid" data-id="' + escapeHtml(payslip.id) + '" class="rounded-lg border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50">Mark paid</button>');
      }
    }

    return '<div class="no-print mb-4 flex flex-wrap items-center gap-2">' + buttons.join('') + '</div>';
  }

  function payslipHtml(payslip) {
    var c = payslip.currency;
    var snapshot = payslip.snapshot;
    var earnings = payslip.earnings;
    var deductions = payslip.deductions;
    var rates = payslip.rates;
    var attendance = payslip.attendance;

    var allowanceLines = earnings.allowances
      .map(function (allowance) {
        return line(allowance.label, money(allowance.amount, c));
      })
      .join('');

    var warnings = payslip.warnings.length
      ? '<div class="print-break-avoid mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">' +
        '<p class="text-xs font-semibold uppercase tracking-wide text-amber-800">Notes on this pay run</p>' +
        '<ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">' +
        payslip.warnings.map(function (warning) { return '<li>' + escapeHtml(warning) + '</li>'; }).join('') +
        '</ul></div>'
      : '';

    var taxBands = payslip.incomeTaxDetail.bands.length
      ? payslip.incomeTaxDetail.bands
          .map(function (band) {
            return (
              '<tr><td class="py-1 pr-4 text-slate-600">' +
              escapeHtml(money(band.from, c) + ' – ' + (band.to === null ? 'above' : money(band.to, c))) +
              '</td><td class="py-1 pr-4 text-right tabular-nums text-slate-600">' + escapeHtml(percent(band.rate)) + '</td>' +
              '<td class="py-1 pr-4 text-right tabular-nums text-slate-600">' + escapeHtml(money(band.taxable, c)) + '</td>' +
              '<td class="py-1 text-right tabular-nums text-slate-900">' + escapeHtml(money(band.tax, c)) + '</td></tr>'
            );
          })
          .join('')
      : '<tr><td colspan="4" class="py-1 text-slate-500">No tax is due at this level of earnings.</td></tr>';

    return (
      payslipActions(payslip) +
      '<article id="payslip-sheet" class="mx-auto max-w-4xl rounded-xl border border-slate-200 bg-white p-8 shadow-card sm:p-10">' +

      // --- letterhead ---
      '<header class="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-6">' +
      '<div class="flex items-center gap-3">' +
      '<span class="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white">P</span>' +
      '<div><p class="text-base font-semibold tracking-tight text-slate-900">PortoHR</p>' +
      '<p class="text-xs text-slate-500">Payslip · ' + escapeHtml(monthLabel(payslip.month)) + '</p></div></div>' +
      '<div class="text-right">' + statusBadge(payslip.status) +
      '<p class="mt-1.5 text-xs text-slate-400">Generated ' + escapeHtml(formatDate(payslip.generatedAt)) + '</p></div>' +
      '</header>' +

      // --- who and what period ---
      '<dl class="grid grid-cols-2 gap-x-6 gap-y-4 border-b border-slate-200 py-6 sm:grid-cols-4">' +
      metaCell('Employee', snapshot.fullName) +
      metaCell('Employee code', snapshot.employeeCode) +
      metaCell('Designation', snapshot.designation) +
      metaCell('Department', snapshot.department) +
      metaCell('Joined', formatDate(snapshot.dateOfJoining)) +
      metaCell('Pay period', monthLabel(payslip.month)) +
      metaCell('Working days', String(payslip.period.workingDays)) +
      metaCell('Paid days', String(payslip.period.employedWorkingDays)) +
      '</dl>' +

      // --- earnings and deductions, side by side ---
      '<div class="grid gap-8 py-6 md:grid-cols-2">' +
      '<section class="print-break-avoid">' +
      '<h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Earnings</h3>' +
      line('Basic salary', money(earnings.basic, c)) +
      allowanceLines +
      line('Overtime (' + formatHours(attendance.overtimeHours) + ' @ ' + money(rates.overtimeRate, c) + '/h)', money(earnings.overtimePay, c), { tone: earnings.overtimePay > 0 ? 'text-emerald-600' : 'text-slate-900' }) +
      line('Gross earnings', money(earnings.gross, c), { strong: true }) +
      '</section>' +

      '<section class="print-break-avoid">' +
      '<h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Deductions</h3>' +
      line('Unpaid absence (' + attendance.absentDays + ' day' + (attendance.absentDays === 1 ? '' : 's') + ')', money(deductions.absence, c), { tone: deductions.absence > 0 ? 'text-red-600' : 'text-slate-900' }) +
      line('Leave without pay (' + (attendance.lwpDays || 0) + ' day' + (attendance.lwpDays === 1 ? '' : 's') + ')', money(deductions.lwp || 0, c), { tone: (deductions.lwp || 0) > 0 ? 'text-red-600' : 'text-slate-900' }) +
      line('Short days (' + formatHours(attendance.shortfallHours) + ')', money(deductions.shortDay, c), { tone: deductions.shortDay > 0 ? 'text-red-600' : 'text-slate-900' }) +
      line('Social security (' + percent(deductions.socialSecurityRate) + ')', money(deductions.socialSecurity, c)) +
      line('Income tax', money(deductions.incomeTax, c)) +
      line('Total deductions', money(deductions.total, c), { strong: true }) +
      '</section>' +
      '</div>' +

      // --- the number that matters ---
      '<div class="print-break-avoid flex flex-wrap items-center justify-between gap-4 rounded-xl bg-slate-900 px-6 py-5 text-white">' +
      '<div><p class="text-xs uppercase tracking-wider text-slate-400">Net pay</p>' +
      '<p class="mt-0.5 text-xs text-slate-400">Gross ' + escapeHtml(money(earnings.gross, c)) + ' less deductions ' + escapeHtml(money(deductions.total, c)) + '</p></div>' +
      '<p class="text-3xl font-semibold tracking-tight tabular-nums">' + escapeHtml(money(payslip.netPay, c)) + '</p>' +
      '</div>' +

      // --- the workings, so the figures can be checked ---
      '<div class="mt-8 grid gap-8 md:grid-cols-2">' +
      '<section class="print-break-avoid">' +
      '<h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Attendance this period</h3>' +
      line('Days present', String(attendance.presentDays)) +
      line('Short days', String(attendance.shortDays)) +
      line('Unpaid absences', String(attendance.absentDays)) +
      line('Leave without pay', String(attendance.lwpDays || 0)) +
      line('Paid leave', String(attendance.leaveDays)) +
      line('Hours worked', formatHours(attendance.hoursWorked)) +
      line('Overtime hours', formatHours(attendance.overtimeHours)) +
      '</section>' +

      '<section class="print-break-avoid">' +
      '<h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Rates applied</h3>' +
      line('Contracted gross', money(snapshot.contractedGross, c)) +
      line('Per-day wage', money(rates.perDayWage, c)) +
      line('Hourly rate (' + rates.hoursPerDay + 'h day)', money(rates.hourlyRate, c)) +
      line('Overtime rate (×' + rates.overtimeMultiplier + ')', money(rates.overtimeRate, c)) +
      '</section>' +
      '</div>' +

      // --- tax workings ---
      '<section class="print-break-avoid mt-8 rounded-lg border border-slate-200 bg-slate-50 p-5">' +
      '<h3 class="text-xs font-semibold uppercase tracking-wider text-slate-400">How the income tax was calculated</h3>' +
      '<p class="mt-1.5 text-xs text-slate-500">Taxable pay of ' + escapeHtml(money(payslip.taxableGross - deductions.socialSecurity, c)) +
      ' annualises to ' + escapeHtml(money(payslip.incomeTaxDetail.annualTaxable, c)) +
      '. Tax of ' + escapeHtml(money(payslip.incomeTaxDetail.annualTax, c)) + ' a year is charged one twelfth at a time.</p>' +
      '<table class="mt-3 w-full text-xs"><thead><tr class="text-left text-slate-400">' +
      '<th class="pb-1 pr-4 font-medium">Annual band</th><th class="pb-1 pr-4 text-right font-medium">Rate</th>' +
      '<th class="pb-1 pr-4 text-right font-medium">Taxable</th><th class="pb-1 text-right font-medium">Tax</th>' +
      '</tr></thead><tbody>' + taxBands + '</tbody></table>' +
      '</section>' +

      (warnings ? '<div class="mt-8">' + warnings + '</div>' : '') +

      '<footer class="mt-8 border-t border-slate-200 pt-4 text-center text-xs text-slate-400">' +
      'Computer-generated payslip · engine v' + escapeHtml(payslip.engineVersion || '—') +
      ' · all amounts in ' + escapeHtml(c) +
      '</footer>' +
      '</article>'
    );
  }

  async function renderPayslip(id) {
    var view = el('view-payslip');
    view.innerHTML =
      '<p class="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Loading payslip…</p>';

    try {
      var result = await api.get('/payroll/' + id);
      view.innerHTML = payslipHtml(result.payslip);

      el('btn-back').addEventListener('click', function () {
        window.location.hash = '';
      });
      el('btn-print').addEventListener('click', function () {
        window.print();
      });
    } catch (err) {
      if (err.status === 401) return;
      view.innerHTML =
        '<div class="rounded-xl border border-slate-200 bg-white p-10 text-center">' +
        '<h3 class="text-sm font-semibold text-red-700">Payslip unavailable</h3>' +
        '<p class="mx-auto mt-1 max-w-sm text-sm text-slate-500">' + escapeHtml(err.message) + '</p>' +
        '<a href="#" class="mt-4 inline-block text-sm font-medium text-slate-900 underline">Back to payroll</a></div>';
    }
  }

  // ---------------------------------------------------------------- routing

  function currentPayslipId() {
    var match = /^#\/payslip\/([a-f0-9]{24})$/i.exec(window.location.hash || '');
    return match ? match[1] : null;
  }

  async function handleRoute() {
    var id = currentPayslipId();
    el('view-list').classList.toggle('hidden', Boolean(id));
    el('view-payslip').classList.toggle('hidden', !id);

    if (id) await renderPayslip(id);
    else el('view-payslip').innerHTML = '';
  }

  function setPayTab(tab) {
    state.tab = tab;
    var arrears = tab === 'arrears';
    el('batch-tiles').classList.toggle('hidden', arrears);
    el('panel-payslips').classList.toggle('hidden', arrears);
    el('view-arrears').classList.toggle('hidden', !arrears);
    if (canManage()) el('admin-controls').classList.toggle('hidden', arrears);
    document.querySelectorAll('.pay-tab').forEach(function (button) {
      var active = button.getAttribute('data-pay-tab') === tab;
      button.classList.toggle('border-[#2054C9]', active);
      button.classList.toggle('border-transparent', !active);
      button.classList.toggle('font-semibold', active);
      button.classList.toggle('text-slate-900', active);
      button.classList.toggle('text-slate-500', !active);
    });
  }

  function signedMoney(amount, currency) {
    var value = Number(amount) || 0;
    var formatted = money(Math.abs(value), currency);
    if (value > 0) return '+' + formatted;
    if (value < 0) return '−' + formatted;
    return formatted;
  }

  function renderArrears() {
    var rows = state.arrears || [];
    if (!rows.length) {
      el('arrears-board').innerHTML =
        '<p class="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">No arrears yet. Closed payslips stay as they were paid.</p>';
      return;
    }
    el('arrears-board').innerHTML =
      '<div class="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card"><table class="min-w-full text-sm"><thead class="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500"><tr>' +
      '<th class="px-4 py-3">Employee</th><th class="px-4 py-3">Closed month</th><th class="px-4 py-3 text-right">Paid net</th><th class="px-4 py-3 text-right">Recomputed</th><th class="px-4 py-3 text-right">Delta net</th><th class="px-4 py-3">Status</th><th class="px-4 py-3"></th>' +
      '</tr></thead><tbody>' +
      rows
        .map(function (row) {
          var actions = '';
          if (canManage() && row.status === 'simulated') {
            actions =
              '<button type="button" data-arr-status="posted" data-arr-id="' +
              escapeHtml(row.id) +
              '" class="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white">Post</button> ' +
              '<button type="button" data-arr-status="cancelled" data-arr-id="' +
              escapeHtml(row.id) +
              '" class="rounded-md border border-slate-300 px-2.5 py-1 text-xs">Cancel</button>';
          } else if (canManage() && row.status === 'posted') {
            actions =
              '<button type="button" data-arr-status="paid" data-arr-id="' +
              escapeHtml(row.id) +
              '" class="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white">Mark paid</button> ' +
              '<button type="button" data-arr-status="cancelled" data-arr-id="' +
              escapeHtml(row.id) +
              '" class="rounded-md border border-slate-300 px-2.5 py-1 text-xs">Cancel</button>';
          }
          return (
            '<tr class="border-t border-slate-100">' +
            '<td class="px-4 py-3"><p class="font-medium">' +
            escapeHtml((row.snapshot && row.snapshot.fullName) || '') +
            '</p><p class="text-xs text-slate-500">' +
            escapeHtml(row.reason || 'Current contract vs closed slip') +
            '</p></td>' +
            '<td class="px-4 py-3 whitespace-nowrap">' +
            escapeHtml(monthLabel(row.sourceMonth)) +
            '</td>' +
            '<td class="px-4 py-3 text-right tabular-nums">' +
            escapeHtml(money(row.originalNet, row.currency)) +
            '</td>' +
            '<td class="px-4 py-3 text-right tabular-nums">' +
            escapeHtml(money(row.recomputedNet, row.currency)) +
            '</td>' +
            '<td class="px-4 py-3 text-right font-semibold tabular-nums ' +
            (row.deltaNet > 0 ? 'text-emerald-700' : row.deltaNet < 0 ? 'text-red-600' : 'text-slate-500') +
            '">' +
            escapeHtml(signedMoney(row.deltaNet, row.currency)) +
            '</td>' +
            '<td class="px-4 py-3">' +
            statusBadge(row.status) +
            '</td>' +
            '<td class="px-4 py-3 text-right whitespace-nowrap">' +
            actions +
            '</td></tr>'
          );
        })
        .join('') +
      '</tbody></table></div>';
  }

  async function loadArrears() {
    try {
      var payload = await api.get('/payroll/arrears');
      state.arrears = payload.adjustments || [];
    } catch (err) {
      state.arrears = [];
      toast(err.message || 'Could not load arrears', 'error');
    }
    renderArrears();
  }

  function patchArrearsStatus(id, next) {
    api
      .request('/payroll/arrears/' + id + '/status', { method: 'PATCH', body: { status: next } })
      .then(function (payload) {
        toast(payload.message || 'Updated');
        return loadArrears();
      })
      .catch(function (err) {
        toast(err.message || 'Could not update arrears', 'error');
      });
  }

  async function loadPeople() {
    try {
      var payload = await api.get('/employees?limit=200');
      state.people = payload.employees || payload.items || [];
    } catch (err) {
      state.people = [];
    }
    el('arr-employee').innerHTML = state.people
      .map(function (person) {
        var name = person.fullName || ((person.firstName || '') + ' ' + (person.lastName || '')).trim();
        var selected = person.employeeCode === 'PH-1003' ? ' selected' : '';
        return (
          '<option value="' +
          escapeHtml(person.id) +
          '"' +
          selected +
          '>' +
          escapeHtml(name + (person.employeeCode ? ' · ' + person.employeeCode : '')) +
          '</option>'
        );
      })
      .join('');
  }

  // ----------------------------------------------------------------- wiring

  function wire() {
    el('btn-generate').addEventListener('click', generateBatch);

    document.querySelectorAll('.pay-tab').forEach(function (button) {
      button.addEventListener('click', function () {
        setPayTab(button.getAttribute('data-pay-tab'));
      });
    });

    el('arrears-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var body = {
        employee: el('arr-employee').value,
        month: el('arr-month').value,
        reason: el('arr-reason').value,
      };
      if (el('arr-basic').value) body.whatIf = { baseSalary: Number(el('arr-basic').value) };
      api
        .request('/payroll/arrears/simulate', { method: 'POST', body: body })
        .then(function (payload) {
          toast(payload.message || 'Simulation stored');
          return loadArrears();
        })
        .catch(function (err) {
          toast(err.message || 'Could not simulate', 'error');
        });
    });

    el('filter-month').addEventListener('change', function (event) {
      state.filters.month = event.target.value;
      loadPayslips();
    });
    el('filter-status').addEventListener('change', function (event) {
      state.filters.status = event.target.value;
      loadPayslips();
    });
    el('btn-clear-filters').addEventListener('click', function () {
      state.filters = { month: '', status: '' };
      el('filter-month').value = '';
      el('filter-status').value = '';
      loadPayslips();
    });

    // One delegated handler covers the register and the payslip view.
    document.addEventListener('click', function (event) {
      var viewButton = event.target.closest('[data-view]');
      if (viewButton) {
        window.location.hash = '#/payslip/' + viewButton.getAttribute('data-view');
        return;
      }

      var statusButton = event.target.closest('[data-status]');
      if (statusButton) {
        var id = statusButton.getAttribute('data-id');
        var next = statusButton.getAttribute('data-status');
        if (next === 'draft') {
          askConfirm(
            'Reopen this payslip?',
            'Reopening returns it to draft and clears the approval trail so it can be regenerated.',
            function () { changeStatus(id, next); }
          );
        } else {
          changeStatus(id, next);
        }
        return;
      }

      var deleteButton = event.target.closest('[data-delete]');
      if (deleteButton) {
        var deleteId = deleteButton.getAttribute('data-delete');
        askConfirm(
          'Delete this draft payslip?',
          'The draft will be removed. You can generate it again for the same period at any time.',
          function () { deletePayslip(deleteId); }
        );
        return;
      }

      var arrStatus = event.target.closest('[data-arr-status]');
      if (arrStatus) {
        var arrId = arrStatus.getAttribute('data-arr-id');
        var arrNext = arrStatus.getAttribute('data-arr-status');
        if (arrNext === 'posted') {
          askConfirm(
            'Post this arrears adjustment?',
            'The closed payslip stays as it was paid. This delta becomes visible to the employee.',
            function () { patchArrearsStatus(arrId, arrNext); }
          );
        } else if (arrNext === 'cancelled') {
          askConfirm(
            'Cancel this arrears adjustment?',
            'It will drop off the live register. The original payslip is unchanged.',
            function () { patchArrearsStatus(arrId, arrNext); }
          );
        } else {
          patchArrearsStatus(arrId, arrNext);
        }
      }
    });

    el('confirm-cancel').addEventListener('click', closeConfirm);
    el('confirm-backdrop').addEventListener('click', function (event) {
      if (event.target === el('confirm-backdrop')) closeConfirm();
    });
    el('confirm-ok').addEventListener('click', function () {
      var action = state.confirm;
      closeConfirm();
      if (action) action();
    });

    window.addEventListener('hashchange', handleRoute);
  }

  // --------------------------------------------------------------------- go

  async function init() {
    var user = await shell.mount('payroll');
    if (!user) return;
    state.user = user;

    var metaResult = await api.get('/payroll/meta');
    state.meta = metaResult.meta;

    // Drafts are HR-only, so they are not offered as a filter to anyone else.
    var statuses = state.meta.statuses.filter(function (status) {
      return canManage() || status.value !== 'draft';
    });
    el('filter-status').innerHTML =
      '<option value="">All statuses</option>' +
      statuses
        .map(function (status) {
          return '<option value="' + escapeHtml(status.value) + '">' + escapeHtml(status.label) + '</option>';
        })
        .join('');

    if (canManage()) {
      el('admin-controls').classList.remove('hidden');
      el('admin-controls').classList.add('flex');
      el('run-month').value = previousMonth();
      el('arrears-form').classList.remove('hidden');
      el('arr-month').value = previousMonth();
      el('page-subtitle').textContent =
        'Run the monthly batch, or simulate arrears against a closed payslip without rewriting it.';
      await loadPeople();
    } else {
      el('page-subtitle').textContent = 'Your payslips and any posted arrears, newest first.';
    }

    wire();
    await loadPayslips();
    await loadArrears();
    await handleRoute();
  }

  init().catch(function (err) {
    if (err && err.status === 401) return;
    console.error('Payroll failed to initialise', err);
  });
})(window, document);
