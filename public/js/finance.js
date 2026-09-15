/* Finance: loan applications and compensation claims, behind two tabs. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var shell = window.PortoHR.shell;

  var state = {
    user: null,
    meta: null,
    tab: 'loans',
    dialog: null,
    data: {
      loans: { mine: [], queue: [], canApprove: false, pendingCount: 0 },
      compensation: { mine: [], queue: [], canApprove: false, pendingCount: 0 },
    },
  };

  /**
   * The two tabs are the same screen over different data. Everything that
   * differs between a loan and a claim is described here; the renderers below
   * are shared.
   */
  var RESOURCES = {
    loans: {
      key: 'loans',
      path: '/loans',
      prefix: 'loan',
      title: 'Loans',
      subtitle: 'Apply for a salary loan and follow it through approval.',
      noun: 'loan application',
      detail: loanDetail,
    },
    compensation: {
      key: 'compensation',
      path: '/compensation',
      prefix: 'comp',
      title: 'Compensation',
      subtitle: 'Claim travel allowance and annual benefits.',
      noun: 'claim',
      detail: claimDetail,
    },
  };

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

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
      return (currency || 'USD') + ' ' + amount.toFixed(2);
    }
  }

  function formatDate(value) {
    if (!value) return '—';
    var date = new Date(value);
    return isNaN(date.getTime())
      ? '—'
      : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function truncate(text, limit) {
    var value = String(text || '');
    return value.length > limit ? value.slice(0, limit - 1) + '…' : value;
  }

  function plural(count, word) {
    return count + ' ' + word + (count === 1 ? '' : 's');
  }

  var STATUS_TONES = {
    pending: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    approved: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    rejected: 'bg-red-50 text-red-700 ring-red-600/20',
  };

  function statusLabel(status) {
    var match = ((state.meta && state.meta.statuses) || []).filter(function (item) {
      return item.value === status;
    })[0];
    return match ? match.label : status;
  }

  function statusBadge(status) {
    return (
      '<span class="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ' +
      (STATUS_TONES[status] || STATUS_TONES.pending) +
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

  function compensationTypes() {
    return (state.meta && state.meta.compensationTypes) || [];
  }

  function compensationType(value) {
    return (
      compensationTypes().filter(function (type) {
        return type.value === value;
      })[0] || null
    );
  }

  // ---------------------------------------------------------------- details

  /** Instalments floor to the cent and the last one carries the remainder. */
  function splitInstalments(amountMinor, months) {
    var monthly = Math.floor(amountMinor / months);
    return { monthly: monthly / 100, final: (amountMinor - monthly * (months - 1)) / 100 };
  }

  function scheduleText(request) {
    if (request.repaymentMonths === 1) return 'Repaid in a single instalment';
    var text = request.repaymentMonths + ' × ' + money(request.monthlyInstalment, request.currency);
    if (request.finalInstalment !== request.monthlyInstalment) {
      text += ' (final ' + money(request.finalInstalment, request.currency) + ')';
    }
    return text;
  }

  function loanDetail(request) {
    return (
      '<p class="font-medium text-slate-900">' +
      escapeHtml(truncate(request.reason, 64)) +
      '</p><p class="mt-0.5 text-xs text-slate-500">' +
      escapeHtml(scheduleText(request)) +
      '</p>'
    );
  }

  function receiptHtml(request) {
    if (!request.receiptProof) return '';
    var proof = request.receiptProof;
    if (/^https?:\/\//i.test(proof)) {
      return (
        '<a href="' +
        escapeHtml(proof) +
        '" target="_blank" rel="noopener noreferrer" class="text-xs font-medium text-slate-600 underline decoration-slate-300 underline-offset-2 hover:text-slate-900">Receipt</a>'
      );
    }
    return '<span class="text-xs text-slate-500">Receipt: ' + escapeHtml(truncate(proof, 40)) + '</span>';
  }

  function claimDetail(request) {
    var type = compensationType(request.type);
    var second = receiptHtml(request);
    if (!second && request.note) {
      second = '<span class="text-xs text-slate-500">' + escapeHtml(truncate(request.note, 48)) + '</span>';
    }
    return (
      '<p class="font-medium text-slate-900">' +
      escapeHtml(type ? type.label : request.type) +
      '</p>' +
      (second ? '<p class="mt-0.5">' + second + '</p>' : '')
    );
  }

  function personCell(request) {
    var snapshot = request.snapshot || {};
    return (
      '<p class="font-medium text-slate-900">' +
      escapeHtml(snapshot.fullName || 'Employee') +
      '</p><p class="mt-0.5 text-xs text-slate-500">' +
      escapeHtml([snapshot.employeeCode, snapshot.department].filter(Boolean).join(' · ')) +
      '</p>'
    );
  }

  // --------------------------------------------------------------- rendering

  function renderQueue(resource) {
    var data = state.data[resource.key];
    var card = el(resource.prefix + '-queue-card');
    var body = el(resource.prefix + '-queue-rows');
    var empty = el(resource.prefix + '-queue-empty');

    // Somebody with nothing to approve should not see an approval queue at all.
    card.classList.toggle('hidden', !data.canApprove);
    if (!data.canApprove) return;

    el(resource.prefix + '-queue-caption').textContent = data.queue.length
      ? plural(data.queue.length, 'request') + ' waiting on you'
      : 'Nothing waiting on you';

    body.innerHTML = data.queue
      .map(function (request) {
        return (
          '<tr class="hover:bg-slate-50/70">' +
          '<td class="px-6 py-4 align-top">' + personCell(request) + '</td>' +
          '<td class="px-6 py-4 align-top">' + resource.detail(request) + '</td>' +
          '<td class="whitespace-nowrap px-6 py-4 text-right align-top font-medium tabular-nums">' +
          escapeHtml(money(request.amount, request.currency)) +
          '</td>' +
          '<td class="whitespace-nowrap px-6 py-4 align-top text-slate-500">' +
          escapeHtml(formatDate(request.createdAt)) +
          '</td>' +
          '<td class="whitespace-nowrap px-6 py-4 text-right align-top">' +
          '<div class="inline-flex gap-2">' +
          '<button type="button" data-decide="approved" data-id="' + escapeHtml(requestId(request)) +
          '" class="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800">Approve</button>' +
          '<button type="button" data-decide="rejected" data-id="' + escapeHtml(requestId(request)) +
          '" class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">Reject</button>' +
          '</div></td></tr>'
        );
      })
      .join('');

    empty.classList.toggle('hidden', data.queue.length > 0);
  }

  function renderMine(resource) {
    var data = state.data[resource.key];
    var body = el(resource.prefix + '-mine-rows');
    var empty = el(resource.prefix + '-mine-empty');

    var pending = data.mine.filter(function (request) {
      return request.status === 'pending';
    }).length;

    el(resource.prefix + '-mine-caption').textContent = data.mine.length
      ? plural(data.mine.length, 'request') + ' · ' + pending + ' pending'
      : 'Nothing submitted yet';

    body.innerHTML = data.mine
      .map(function (request) {
        var note = request.decisionNote
          ? '<p class="mt-1 max-w-xs text-xs text-slate-500">' + escapeHtml(request.decisionNote) + '</p>'
          : '';
        var action =
          request.status === 'pending'
            ? '<button type="button" data-withdraw="' + escapeHtml(requestId(request)) +
              '" class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">Withdraw</button>'
            : '<span class="text-xs text-slate-400">' + escapeHtml(formatDate(request.decidedAt)) + '</span>';

        return (
          '<tr class="hover:bg-slate-50/70">' +
          '<td class="px-6 py-4 align-top">' + resource.detail(request) + '</td>' +
          '<td class="whitespace-nowrap px-6 py-4 text-right align-top font-medium tabular-nums">' +
          escapeHtml(money(request.amount, request.currency)) +
          '</td>' +
          '<td class="px-6 py-4 align-top">' + statusBadge(request.status) + note + '</td>' +
          '<td class="whitespace-nowrap px-6 py-4 align-top text-slate-500">' +
          escapeHtml(formatDate(request.createdAt)) +
          '</td>' +
          '<td class="whitespace-nowrap px-6 py-4 text-right align-top">' + action + '</td>' +
          '</tr>'
        );
      })
      .join('');

    empty.classList.toggle('hidden', data.mine.length > 0);
  }

  function renderBadge(resource) {
    var badge = el('tab-' + resource.key + '-badge');
    var count = state.data[resource.key].pendingCount;
    badge.textContent = count;
    badge.classList.toggle('hidden', !count);
  }

  function render(resource) {
    renderQueue(resource);
    renderMine(resource);
    renderBadge(resource);
  }

  // ------------------------------------------------------------------- tabs

  var TAB_ACTIVE = 'border-slate-900 text-slate-900';
  var TAB_IDLE = 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700';

  function setTab(key, pushHash) {
    var resource = RESOURCES[key] || RESOURCES.loans;
    state.tab = resource.key;

    Object.keys(RESOURCES).forEach(function (name) {
      var isActive = name === resource.key;
      var panel = el('panel-' + name);
      // Toggling both classes avoids relying on which display utility wins.
      panel.classList.toggle('hidden', !isActive);
      panel.classList.toggle('grid', isActive);

      var tab = el('tab-' + name);
      tab.className =
        'group inline-flex items-center gap-2 border-b-2 px-1 pb-3 text-sm font-medium transition ' +
        (isActive ? TAB_ACTIVE : TAB_IDLE);
      if (isActive) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });

    el('page-title').textContent = resource.title;
    el('page-subtitle').textContent = resource.subtitle;
    document.title = resource.title + ' · PortoHR';

    // Each tab is its own module, so the sidebar highlight follows it.
    shell.setActiveModule(resource.key);
    if (pushHash) window.location.hash = resource.key;
  }

  function tabFromHash() {
    var key = (window.location.hash || '').replace('#', '');
    return RESOURCES[key] ? key : 'loans';
  }

  // ------------------------------------------------------------------ forms

  function clearErrors(form) {
    Array.prototype.forEach.call(form.querySelectorAll('[data-error-for]'), function (node) {
      node.textContent = '';
      node.classList.add('hidden');
    });
    var banner = form.querySelector('[data-form-error]');
    banner.textContent = '';
    banner.classList.add('hidden');
  }

  function showFieldError(form, field, message) {
    var node = form.querySelector('[data-error-for="' + field + '"]');
    if (!node) return showFormError(form, message);
    node.textContent = message;
    node.classList.remove('hidden');
  }

  function showFormError(form, message) {
    var banner = form.querySelector('[data-form-error]');
    banner.textContent = message;
    banner.classList.remove('hidden');
  }

  function setSubmitting(form, busy, label) {
    var button = form.querySelector('button[type="submit"]');
    button.disabled = busy;
    form.querySelector('[data-submit-text]').textContent = busy ? 'Submitting…' : label;
  }

  function updateLoanSchedule() {
    var amount = Math.round((Number(el('loan-amount').value) || 0) * 100);
    var months = Number(el('loan-months').value);
    var target = el('loan-schedule');

    if (!amount || !Number.isInteger(months) || months < 1) {
      target.textContent = 'Enter an amount and period to preview the instalments.';
      return;
    }

    var split = splitInstalments(amount, months);
    var currency = (state.user && state.user.currency) || 'USD';
    target.textContent =
      months === 1
        ? 'One instalment of ' + money(split.final, currency)
        : months +
          ' instalments of ' +
          money(split.monthly, currency) +
          (split.final !== split.monthly ? ', last one ' + money(split.final, currency) : '');
  }

  async function submitLoan(event) {
    event.preventDefault();
    var form = el('loan-form');
    var rules = (state.meta && state.meta.loan) || {};
    clearErrors(form);

    var amount = Number(el('loan-amount').value);
    var months = Number(el('loan-months').value);
    var reason = el('loan-reason').value.trim();
    var ok = true;

    if (!isFinite(amount) || amount <= 0) {
      showFieldError(form, 'amount', 'Enter an amount greater than zero');
      ok = false;
    }
    if (!Number.isInteger(months) || months < 1) {
      showFieldError(form, 'repaymentMonths', 'Enter a whole number of months');
      ok = false;
    }
    if (reason.length < (rules.minReasonLength || 10)) {
      showFieldError(form, 'reason', 'Describe what the loan is for in at least ' + (rules.minReasonLength || 10) + ' characters');
      ok = false;
    }
    if (!ok) return;

    setSubmitting(form, true, 'Submit application');
    try {
      var result = await api.post('/loans', { amount: amount, repaymentMonths: months, reason: reason });
      toast(result.message);
      form.reset();
      el('loan-months').value = '12';
      updateLoanSchedule();
      await load(RESOURCES.loans);
    } catch (err) {
      if (err.status !== 401) showFormError(form, err.message);
    } finally {
      setSubmitting(form, false, 'Submit application');
    }
  }

  function onCompensationTypeChange() {
    var type = compensationType(el('comp-type').value);
    el('comp-type-hint').textContent = type ? type.hint : '';
    el('comp-amount-hint').textContent = type
      ? 'Up to ' + money(type.maxAmount, (state.user && state.user.currency) || 'USD') + ' per claim.'
      : '';
    el('comp-receipt-required').textContent = type && type.requiresReceipt ? '(required)' : '(optional)';
  }

  async function submitCompensation(event) {
    event.preventDefault();
    var form = el('comp-form');
    clearErrors(form);

    var type = compensationType(el('comp-type').value);
    var amount = Number(el('comp-amount').value);
    var receipt = el('comp-receipt').value.trim();
    var ok = true;

    if (!type) {
      showFieldError(form, 'type', 'Choose a claim type');
      ok = false;
    }
    if (!isFinite(amount) || amount <= 0) {
      showFieldError(form, 'amount', 'Enter an amount greater than zero');
      ok = false;
    }
    if (type && type.requiresReceipt && !receipt) {
      showFieldError(form, 'receiptProof', 'A ' + type.label + ' claim needs a receipt link or reference');
      ok = false;
    }
    if (!ok) return;

    setSubmitting(form, true, 'Submit claim');
    try {
      var result = await api.post('/compensation', {
        type: type.value,
        amount: amount,
        receiptProof: receipt,
        note: el('comp-note').value.trim(),
      });
      toast(result.message);
      form.reset();
      onCompensationTypeChange();
      await load(RESOURCES.compensation);
    } catch (err) {
      if (err.status !== 401) showFormError(form, err.message);
    } finally {
      setSubmitting(form, false, 'Submit claim');
    }
  }

  // ----------------------------------------------------------------- dialog

  function openDialog(options) {
    state.dialog = options;

    el('decision-title').textContent = options.title;
    el('decision-text').textContent = options.text;
    el('decision-note-wrap').classList.toggle('hidden', !options.noteLabel);
    el('decision-note-label').textContent = options.noteLabel || '';
    el('decision-note').value = '';
    el('decision-error').classList.add('hidden');

    var confirm = el('decision-ok');
    confirm.textContent = options.confirmLabel;
    confirm.className =
      'rounded-lg px-4 py-2 text-sm font-semibold text-white transition ' +
      (options.tone === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-900 hover:bg-slate-800');

    el('decision-backdrop').classList.remove('hidden');
    if (options.noteLabel) el('decision-note').focus();
  }

  function closeDialog() {
    state.dialog = null;
    el('decision-backdrop').classList.add('hidden');
  }

  async function confirmDialog() {
    if (!state.dialog) return;
    var options = state.dialog;
    var note = el('decision-note').value.trim();

    if (options.requireNote && !note) {
      var error = el('decision-error');
      error.textContent = 'Please give a reason.';
      error.classList.remove('hidden');
      return;
    }

    el('decision-ok').disabled = true;
    try {
      await options.onConfirm(note);
      closeDialog();
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'error');
    } finally {
      el('decision-ok').disabled = false;
    }
  }

  function requestId(request) {
    return String(request.id || request._id);
  }

  function findRequest(resource, id) {
    var data = state.data[resource.key];
    return (
      data.queue.concat(data.mine).filter(function (request) {
        return requestId(request) === String(id);
      })[0] || null
    );
  }

  function askDecision(resource, id, decision) {
    var request = findRequest(resource, id);
    if (!request) return;

    var who = (request.snapshot && request.snapshot.fullName) || 'this employee';
    var amount = money(request.amount, request.currency);
    var approving = decision === 'approved';

    openDialog({
      title: approving ? 'Approve request' : 'Reject request',
      text:
        (approving ? 'Approve ' : 'Reject ') +
        who +
        '’s ' +
        resource.noun +
        ' for ' +
        amount +
        '. This decision is final.',
      noteLabel: approving ? 'Note (optional)' : 'Reason (required)',
      requireNote: !approving,
      confirmLabel: approving ? 'Approve' : 'Reject',
      tone: approving ? 'primary' : 'danger',
      onConfirm: async function (note) {
        var result = await api.request(resource.path + '/' + id + '/status', {
          method: 'PATCH',
          body: { status: decision, decisionNote: note },
        });
        toast(result.message);
        await load(resource);
      },
    });
  }

  function askWithdraw(resource, id) {
    var request = findRequest(resource, id);
    if (!request) return;

    openDialog({
      title: 'Withdraw request',
      text: 'Withdraw your ' + resource.noun + ' for ' + money(request.amount, request.currency) + '?',
      noteLabel: null,
      requireNote: false,
      confirmLabel: 'Withdraw',
      tone: 'danger',
      onConfirm: async function () {
        var result = await api.request(resource.path + '/' + id, { method: 'DELETE' });
        toast(result.message);
        await load(resource);
      },
    });
  }

  // ------------------------------------------------------------------- data

  async function load(resource) {
    var results = await Promise.all([
      api.get(resource.path + '?scope=mine'),
      api.get(resource.path + '?scope=queue'),
    ]);

    state.data[resource.key] = {
      mine: results[0].requests,
      queue: results[1].requests,
      canApprove: results[1].canApprove,
      pendingCount: results[1].pendingCount,
    };
    render(resource);
  }

  async function loadMeta() {
    try {
      return (await api.get('/loans/meta')).meta;
    } catch (err) {
      if (err.status === 401) throw err;
      return (await api.get('/compensation/meta')).meta;
    }
  }

  function wire() {
    Object.keys(RESOURCES).forEach(function (key) {
      var resource = RESOURCES[key];

      el('tab-' + key).addEventListener('click', function () {
        setTab(key, true);
      });

      el(resource.prefix + '-queue-rows').addEventListener('click', function (event) {
        var button = event.target.closest('[data-decide]');
        if (button) askDecision(resource, button.getAttribute('data-id'), button.getAttribute('data-decide'));
      });

      el(resource.prefix + '-mine-rows').addEventListener('click', function (event) {
        var button = event.target.closest('[data-withdraw]');
        if (button) askWithdraw(resource, button.getAttribute('data-withdraw'));
      });
    });

    el('loan-form').addEventListener('submit', submitLoan);
    el('loan-amount').addEventListener('input', updateLoanSchedule);
    el('loan-months').addEventListener('input', updateLoanSchedule);

    el('comp-form').addEventListener('submit', submitCompensation);
    el('comp-type').addEventListener('change', onCompensationTypeChange);

    el('decision-cancel').addEventListener('click', closeDialog);
    el('decision-ok').addEventListener('click', confirmDialog);
    el('decision-backdrop').addEventListener('click', function (event) {
      if (event.target === el('decision-backdrop')) closeDialog();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && state.dialog) closeDialog();
    });

    window.addEventListener('hashchange', function () {
      setTab(tabFromHash(), false);
    });
  }

  function paintStaticCopy() {
    var rules = (state.meta && state.meta.loan) || {};
    var currency = (state.user && state.user.currency) || 'USD';

    el('loan-currency').textContent = currency;
    el('comp-currency').textContent = currency;
    el('loan-amount-hint').textContent =
      'Between ' +
      money(rules.minAmount, currency) +
      ' and ' +
      rules.maxSalaryMultiple +
      ' months of your gross salary.';
    el('loan-months').min = String(rules.minRepaymentMonths || 1);
    el('loan-months').max = String(rules.maxRepaymentMonths || 24);

    el('comp-type').innerHTML = compensationTypes()
      .map(function (type) {
        return '<option value="' + escapeHtml(type.value) + '">' + escapeHtml(type.label) + '</option>';
      })
      .join('');

    onCompensationTypeChange();
    updateLoanSchedule();
  }

  async function init() {
    var initialTab = tabFromHash();
    var user = await shell.mount(initialTab);
    if (!user) return;

    state.user = user;
    state.meta = await loadMeta();

    wire();
    paintStaticCopy();
    setTab(initialTab, false);

    // Both tabs load up front so the pending badges are accurate on arrival.
    await Promise.all([load(RESOURCES.loans), load(RESOURCES.compensation)]);
  }

  init().catch(function (err) {
    if (err && err.status !== 401) toast(err.message || 'Something went wrong', 'error');
  });
})(window, document);
