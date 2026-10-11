/* Payroll → Final settlements: prepare, review, approve, pay and print the bill. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var el = function (id) { return document.getElementById(id); };
  var P = function () { return window.PortoHR.payroll; };
  var state = { settlements: [], pending: [], current: null, draftBody: null };

  function esc(v) { return P().escapeHtml(v); }
  function money(v, c) { return P().money(v, c); }
  var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  function fmtDate(v) {
    var d = new Date(v);
    if (isNaN(d.getTime())) return '';
    return String(d.getUTCDate()).padStart(2, '0') + '-' + MONTHS[d.getUTCMonth()] + '-' + d.getUTCFullYear();
  }
  function num(v) { return String(Math.round(Number(v) * 100) / 100); }

  var TONE = { draft: 'warn', approved: 'info', paid: 'ok' };

  /* ---------- list ---------- */

  function renderList() {
    var open = state.pending.length;
    var badge = el('settle-count');
    badge.textContent = String(open);
    badge.classList.toggle('hidden', !open);

    el('settle-pending').innerHTML = open
      ? '<div class="rounded-xl border px-4 py-3" style="border-color:color-mix(in srgb,var(--warning) 40%,var(--border));background:color-mix(in srgb,var(--warning) 9%,var(--surface))">' +
        '<p class="text-sm font-semibold">' + open + ' leaver' + (open === 1 ? '' : 's') + ' awaiting a settlement</p><ul class="mt-2 space-y-2">' +
        state.pending.map(function (p) {
          return '<li class="flex flex-wrap items-center gap-3 text-sm"><span class="font-medium">' + esc(p.fullName) + '</span><span class="text-slate-500">' + esc(p.employeeCode) + ' · last day ' + esc(fmtDate(p.lastWorkingDay)) + '</span>' +
            '<button type="button" class="btn btn-primary btn-sm ml-auto" data-prepare="' + esc(p.id) + '">Prepare settlement</button></li>';
        }).join('') + '</ul></div>'
      : '';

    el('settle-board').innerHTML = state.settlements.length
      ? '<table class="min-w-full text-sm"><thead><tr><th class="px-6 py-3.5 text-left">Request</th><th class="px-6 py-3.5 text-left">Employee</th><th class="px-6 py-3.5 text-left">Relieved</th>' +
        '<th class="px-6 py-3.5 text-right">Net payable</th><th class="px-6 py-3.5 text-left">Status</th><th class="px-6 py-3.5"></th></tr></thead><tbody>' +
        state.settlements.map(function (s) {
          return '<tr><td class="px-6 py-4 font-medium">' + esc(s.requestNo) + '</td><td class="px-6 py-4">' + esc(s.snapshot.fullName) + '<span class="block text-xs text-slate-400">' + esc(s.snapshot.employeeCode) + '</span></td>' +
            '<td class="px-6 py-4 text-slate-600">' + esc(fmtDate(s.snapshot.dateOfRelieving)) + '</td><td class="px-6 py-4 text-right tabular-nums' + (s.owedByEmployee ? ' text-red-600' : '') + '">' + esc(money(s.netPayable, s.currency)) + '</td>' +
            '<td class="px-6 py-4"><span class="pill ' + (TONE[s.status] || '') + '">' + esc(s.statusLabel) + '</span></td>' +
            '<td class="px-6 py-4 text-right"><button type="button" class="btn-ghost" data-open="' + esc(s.id) + '">Open</button></td></tr>';
        }).join('') + '</tbody></table>'
      : '<p class="px-6 py-12 text-center text-sm text-slate-500">No settlements yet.</p>';
  }

  async function load() {
    try {
      var r = await api.get('/payroll/settlements');
      state.settlements = r.settlements || [];
      state.pending = r.pending || [];
    } catch (err) {
      state.settlements = []; state.pending = [];
    }
    renderList();
  }

  /* ---------- the bill ---------- */

  function row(label, value, strong) {
    return '<tr><td class="py-1 pr-4' + (strong ? ' font-semibold' : '') + '">' + esc(label) + '</td><td class="py-1 text-right tabular-nums' + (strong ? ' font-semibold' : '') + '">' + value + '</td></tr>';
  }

  function billHtml(s) {
    var c = s.currency, sn = s.snapshot, d = s.days, dd = s.deductions;
    var editable = s.status === 'draft';
    var actions =
      '<div class="no-print flex flex-wrap items-center gap-2">' +
      '<h2 class="mr-auto">Final settlement bill</h2><span class="pill ' + (TONE[s.status] || '') + '">' + esc(s.statusLabel) + '</span>' +
      (editable ? '<button type="button" class="btn btn-secondary btn-sm" data-edit>Adjust</button><button type="button" class="btn btn-primary btn-sm" data-status="approved">Approve</button>' : '') +
      (s.status === 'approved' ? '<button type="button" class="btn btn-secondary btn-sm" data-status="draft">Reopen</button><button type="button" class="btn btn-primary btn-sm" data-pay>Mark paid</button>' : '') +
      '<button type="button" class="btn btn-secondary btn-sm" data-print>Print</button><button type="button" class="btn-ghost" data-close>Close</button></div>';

    var leave = (s.leave || []).filter(function (l) { return l.accruedDays || l.takenDays; }).map(function (l) {
      return '<tr><td class="py-0.5 pr-3">' + esc(l.label) + '</td><td class="py-0.5 pr-3 text-right tabular-nums">' + num(l.accruedDays) + '</td><td class="py-0.5 pr-3 text-right tabular-nums">' + num(l.takenDays) + '</td><td class="py-0.5 text-right tabular-nums">' + num(l.balanceDays) + '</td></tr>';
    }).join('');

    return actions +
      '<div class="mt-4"><p class="text-center text-base font-bold tracking-wide">FINAL SETTLEMENT BILL</p><p class="text-center text-xs text-slate-500">Request ' + esc(s.requestNo) + '</p></div>' +
      '<div class="mt-4 grid gap-6 sm:grid-cols-2 text-sm">' +
      '<dl class="space-y-1">' +
      [['Department', sn.department], ['Name', sn.fullName], ['Father / husband', sn.fatherName], ['CNIC', sn.nationalId], ['Employee code', sn.employeeCode], ['Designation', sn.designation],
       ['Quit reason', sn.quitReason], ['Date of joining', fmtDate(sn.dateOfJoining)], ['Date of relieving', fmtDate(sn.dateOfRelieving)], ['Total service', sn.serviceYears + ' years ' + sn.serviceMonths + ' months'], ['Address', sn.address]]
        .map(function (r) { return '<div class="flex gap-2"><dt class="w-36 shrink-0 text-xs text-slate-400">' + esc(r[0]) + '</dt><dd class="font-medium">' + esc(r[1] || '—') + '</dd></div>'; }).join('') +
      '</dl>' +
      '<div><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Detail of working days · ' + esc(d.month) + '</p><table class="mt-1 w-full text-sm">' +
      row('Rest day', esc(d.restDay || '—')) + row('Skip days', num(d.skipDays)) + row('Absent days', num(d.absentDays)) + row('Without-pay leaves', num(d.withoutPayLeaveDays)) + row('Attendance days', num(d.attendanceDays), true) + '</table></div></div>' +

      '<div class="mt-5 grid gap-6 sm:grid-cols-2 text-sm">' +
      '<div><p class="bill-h">Salary / allowances</p><table class="w-full">' + row('Unadjusted gross salary', esc(money(s.unadjustedGross, c))) + row('Adjusted gross salary', esc(money(s.adjustedGross, c))) + row('Long service allowance', esc(money(s.longServiceAllowance, c))) + row('Net salary payable', esc(money(s.netSalaryPayable, c)), true) + '</table></div>' +
      '<div><p class="bill-h">Final settlement</p><table class="w-full">' + row('Leave encashment (' + num(s.leaveEncashmentDays) + ' days @ ' + money(s.perDayRate, c) + ')', esc(money(s.leaveEncashment, c))) +
      (s.additions || []).map(function (a) { return row(a.label, esc(money(a.amount, c))); }).join('') + row('Final settlement', esc(money(s.finalSettlement, c)), true) + '</table></div></div>' +

      '<div class="mt-5"><p class="bill-h">Deductions</p><table class="w-full text-sm">' +
      row('Long service deduction', esc(money(dd.longServiceDeduction, c))) + row('Deduction of short-term salary loan', esc(money(dd.shortTermLoan, c))) + row('Excess paid salary recovery', esc(money(dd.excessPaidSalary, c))) +
      row('Excess availed leaves (' + num(dd.excessLeaveDays) + ' days)', esc(money(dd.excessLeaveRecovery, c))) +
      (dd.others || []).map(function (o) { return row(o.label, esc(money(o.amount, c))); }).join('') + row('Total deductions', esc(money(dd.total, c)), true) + '</table></div>' +

      '<div class="mt-5 flex items-center justify-between rounded-lg px-4 py-3" style="background:var(--surface-alt);border:1px solid var(--border)"><span class="text-sm font-semibold">' + (s.owedByEmployee ? 'Recoverable from employee' : 'Net payable') + '</span><span class="text-xl font-semibold tabular-nums' + (s.owedByEmployee ? ' text-red-600' : '') + '">' + esc(money(Math.abs(s.netPayable), c)) + '</span></div>' +

      (leave ? '<p class="bill-h mt-5">Leave position at relieving</p><table class="w-full text-xs"><thead><tr class="text-left"><th>Type</th><th class="text-right">Accrued</th><th class="text-right">Taken</th><th class="text-right">Balance</th></tr></thead><tbody>' + leave + '</tbody></table>' : '') +
      (s.warnings && s.warnings.length ? '<ul class="no-print mt-4 list-disc space-y-1 pl-5 text-xs text-amber-700">' + s.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '') +
      (s.notes ? '<p class="mt-3 text-xs text-slate-500">Note: ' + esc(s.notes) + '</p>' : '') +
      '<div class="mt-8 grid grid-cols-3 gap-6 text-center text-xs text-slate-500"><div class="border-t pt-1" style="border-color:var(--border-strong)">Prepared by<br /><b class="text-slate-800">' + esc(s.preparedByName) + '</b></div>' +
      '<div class="border-t pt-1" style="border-color:var(--border-strong)">Audited by<br /><b class="text-slate-800">' + esc(s.approvedByName || ' ') + '</b></div>' +
      '<div class="border-t pt-1" style="border-color:var(--border-strong)">Debit note<br /><b class="text-slate-800">' + esc(s.paymentRef || ' ') + '</b></div></div>' +
      '<p class="mt-4 text-center text-[11px] text-slate-400">This is a system generated bill and does not need signatures.</p>';
  }

  function show(s) {
    state.current = s;
    el('settle-body').innerHTML = billHtml(s);
    el('record-modal').classList.remove('hidden');
  }

  function closeBill() { el('record-modal').classList.add('hidden'); }

  /* ---------- adjust form ---------- */

  function adjustHtml(s) {
    var lineRows = function (list, key) {
      return '<div data-list="' + key + '" class="space-y-2">' + (list || []).map(function (r) { return lineRow(r.label, r.amount); }).join('') + '</div>' +
        '<button type="button" class="btn btn-ghost" data-add="' + key + '">+ Add a line</button>';
    };
    return '<form id="adj" class="grid gap-3" novalidate><h2>Adjust settlement ' + esc(s.requestNo) + '</h2>' +
      '<p class="modal-sub">Leave a figure as it is to keep the calculated value. Loans, leave and salary are worked out for you.</p>' +
      '<div id="adj-error" class="modal-error hidden"></div>' +
      '<div class="grid gap-3 sm:grid-cols-2">' +
      '<label>Long service allowance<input name="longServiceAllowance" type="number" min="0" step="0.01" value="' + esc(s.longServiceAllowance || '') + '" /></label>' +
      '<label>Long service deduction<input name="longServiceDeduction" type="number" min="0" step="0.01" value="' + esc(s.deductions.longServiceDeduction || '') + '" /></label>' +
      '<label>Short-term loan deduction<input name="shortTermLoan" type="number" min="0" step="0.01" value="' + esc(s.deductions.shortTermLoan) + '" /></label>' +
      '<label>Excess paid salary recovery<input name="excessPaidSalary" type="number" min="0" step="0.01" value="' + esc(s.deductions.excessPaidSalary) + '" /></label></div>' +
      '<div><p class="text-xs font-semibold text-slate-500">Other payments (bonus, gratuity…)</p>' + lineRows(s.additions, 'additions') + '</div>' +
      '<div><p class="text-xs font-semibold text-slate-500">Other deductions (notice pay, damages…)</p>' + lineRows(s.deductions.others, 'others') + '</div>' +
      '<label>Notes<input name="notes" maxlength="400" value="' + esc(s.notes) + '" /></label>' +
      '<div class="modal-actions"><button type="button" class="btn btn-secondary" data-cancel-adjust>Cancel</button><button type="submit" class="btn btn-primary">Recalculate</button></div></form>';
  }

  function lineRow(label, amount) {
    return '<div class="flex gap-2"><input data-l="label" placeholder="Description" value="' + esc(label || '') + '" /><input data-l="amount" type="number" min="0" step="0.01" placeholder="Amount" value="' + esc(amount || '') + '" style="max-width:9rem" /><button type="button" class="btn-ghost" data-rm>✕</button></div>';
  }

  function collect(form) {
    var body = { employee: state.current.employee, notes: form.elements.notes.value };
    ['longServiceAllowance', 'longServiceDeduction', 'shortTermLoan', 'excessPaidSalary'].forEach(function (k) { body[k] = form.elements[k].value; });
    var read = function (key) {
      return Array.prototype.map.call(form.querySelectorAll('[data-list="' + key + '"] > div'), function (div) {
        return { label: div.querySelector('[data-l=label]').value, amount: div.querySelector('[data-l=amount]').value };
      }).filter(function (r) { return r.label || r.amount; });
    };
    body.additions = read('additions');
    body.otherDeductions = read('others');
    return body;
  }

  /* ---------- events ---------- */

  async function prepare(employeeId, body) {
    var payload = Object.assign({ employee: employeeId }, body || {});
    var r = await api.request('/payroll/settlements', { method: 'POST', body: payload });
    await load();
    show(r.settlement);
  }

  el('view-settlements').addEventListener('click', function (e) {
    var prep = e.target.closest('[data-prepare]');
    var open = e.target.closest('[data-open]');
    if (prep) prepare(prep.getAttribute('data-prepare')).catch(function (err) { P().toast(err.message, 'error'); });
    if (open) {
      api.get('/payroll/settlements/' + open.getAttribute('data-open')).then(function (r) { show(r.settlement); }).catch(function (err) { P().toast(err.message, 'error'); });
    }
  });

  el('record-modal').addEventListener('mousedown', function (e) { if (e.target === el('record-modal')) closeBill(); });

  el('settle-body').addEventListener('click', async function (e) {
    var s = state.current;
    if (e.target.closest('[data-close]')) return closeBill();
    if (e.target.closest('[data-print]')) { document.body.classList.add('printing-record'); window.print(); document.body.classList.remove('printing-record'); return; }
    if (e.target.closest('[data-edit]')) { el('settle-body').innerHTML = adjustHtml(s); return; }
    if (e.target.closest('[data-cancel-adjust]')) { show(s); return; }
    var add = e.target.closest('[data-add]');
    if (add) { el('settle-body').querySelector('[data-list="' + add.getAttribute('data-add') + '"]').insertAdjacentHTML('beforeend', lineRow('', '')); return; }
    var rm = e.target.closest('[data-rm]');
    if (rm) { rm.parentNode.remove(); return; }

    var status = e.target.closest('[data-status]');
    var pay = e.target.closest('[data-pay]');
    try {
      if (status) {
        var next = status.getAttribute('data-status');
        if (next === 'approved' && !window.confirm('Approve this settlement? It can no longer be adjusted until reopened.')) return;
        show((await api.request('/payroll/settlements/' + s.id + '/status', { method: 'PATCH', body: { status: next } })).settlement);
        load();
      }
      if (pay) {
        var ref = window.prompt('Payment reference / debit note number (optional)') ;
        if (ref === null) return;
        show((await api.request('/payroll/settlements/' + s.id + '/status', { method: 'PATCH', body: { status: 'paid', paymentRef: ref } })).settlement);
        load();
      }
    } catch (err) {
      P().toast(err.message || 'Could not update', 'error');
    }
  });

  el('settle-body').addEventListener('submit', async function (e) {
    if (!e.target.closest('#adj')) return;
    e.preventDefault();
    var form = e.target;
    try {
      var r = await api.request('/payroll/settlements', { method: 'POST', body: collect(form) });
      await load();
      show(r.settlement);
    } catch (err) {
      var box = el('adj-error');
      box.textContent = err.message || 'Could not recalculate';
      box.classList.remove('hidden');
    }
  });

  document.addEventListener('payroll:tab', function (event) {
    var on = event.detail.tab === 'settlements';
    el('view-settlements').classList.toggle('hidden', !on);
    if (on) load();
  });

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeBill(); });
  // The badge should be right before the tab is opened.
  setTimeout(function () { if (P() && P().canManage()) load(); }, 1200);
})(window, document);
