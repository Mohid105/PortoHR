/* PMS: objectives, KPIs, employee self-assessment, supervisor review. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var shell = window.PortoHR.shell;

  var state = {
    user: null,
    meta: null,
    period: '',
    tab: 'mine',
    mine: null,
    minePermissions: null,
    team: null,
    selectedId: null,
    selected: null,
    selectedPermissions: null,
    busy: false,
    confirm: null,
  };

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function canManageTeam() {
    return state.user && (state.user.role === 'manager' || state.user.role === 'hr_admin');
  }

  function scoreLabel(score) {
    var match = ((state.meta && state.meta.scores) || []).filter(function (item) {
      return item.value === Number(score);
    })[0];
    if (!match) return score == null ? '—' : String(score);
    return score + ' · ' + match.label;
  }

  function statusLabel(status) {
    var match = ((state.meta && state.meta.statuses) || []).filter(function (item) {
      return item.value === status;
    })[0];
    return match ? match.label : status || 'Not assigned';
  }

  var STATUS_TONES = {
    assigned: 'bg-sky-50 text-sky-700 ring-sky-600/20',
    self_submitted: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    reviewed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  };

  function statusBadge(status) {
    if (!status) {
      return '<span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-inset ring-slate-200">Not assigned</span>';
    }
    return (
      '<span class="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ' +
      (STATUS_TONES[status] || STATUS_TONES.assigned) +
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

  function showError(message) {
    var box = el('pms-error');
    if (!message) {
      box.classList.add('hidden');
      box.textContent = '';
      return;
    }
    box.textContent = message;
    box.classList.remove('hidden');
  }

  function fieldClass() {
    return 'mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10';
  }

  function btnPrimary() {
    return 'inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';
  }

  function btnGhost() {
    return 'inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50';
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

  function percentLabel(value) {
    if (value == null || value === '') return '—';
    return Math.round(Number(value)) + '%';
  }

  /**
   * SVG ring whose circumference is 100, so `percent` maps directly onto
   * stroke-dasharray. Empty scores render as a grey track with an em dash.
   */
  function ringChart(percent, label, sublabel, tone) {
    var empty = percent == null || percent === '';
    var pct = empty ? 0 : Math.max(0, Math.min(100, Number(percent)));
    var color = tone === 'emerald' ? '#059669' : tone === 'sky' ? '#0284c7' : tone === 'amber' ? '#d97706' : '#0f172a';
    return (
      '<div class="flex flex-col items-center text-center">' +
      '<div class="relative h-28 w-28">' +
      '<svg viewBox="0 0 36 36" class="h-28 w-28 -rotate-90" aria-hidden="true">' +
      '<circle cx="18" cy="18" r="15.9155" fill="none" stroke="#e2e8f0" stroke-width="3"></circle>' +
      '<circle cx="18" cy="18" r="15.9155" fill="none" stroke="' +
      color +
      '" stroke-width="3" stroke-linecap="round" stroke-dasharray="' +
      pct +
      ', 100"></circle>' +
      '</svg>' +
      '<div class="absolute inset-0 flex items-center justify-center">' +
      '<span class="text-lg font-semibold tabular-nums text-slate-900">' +
      (empty ? '—' : Math.round(pct) + '%') +
      '</span></div></div>' +
      '<p class="mt-2 text-sm font-medium text-slate-900">' +
      escapeHtml(label) +
      '</p>' +
      (sublabel ? '<p class="text-xs text-slate-500">' + escapeHtml(sublabel) + '</p>' : '') +
      '</div>'
    );
  }

  function progressBar(percent) {
    var pct = Math.max(0, Math.min(100, Number(percent) || 0));
    return (
      '<div class="h-2 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow="' +
      pct +
      '" aria-valuemin="0" aria-valuemax="100">' +
      '<div class="h-full rounded-full bg-slate-900 transition-all" style="width:' +
      pct +
      '%"></div></div>'
    );
  }

  function scorePicker(name, selected, disabled) {
    var buttons = [1, 2, 3, 4, 5]
      .map(function (n) {
        var active = String(selected) === String(n);
        var classes = active
          ? 'bg-slate-900 text-white'
          : 'bg-white text-slate-700 hover:bg-slate-50';
        return (
          '<button type="button" data-score-for="' +
          escapeHtml(name) +
          '" data-score="' +
          n +
          '"' +
          (disabled ? ' disabled' : '') +
          ' class="h-9 w-9 rounded-lg border border-slate-300 text-sm font-semibold transition ' +
          classes +
          (disabled ? ' cursor-not-allowed opacity-60' : '') +
          '" title="' +
          escapeHtml(scoreLabel(n)) +
          '">' +
          n +
          '</button>'
        );
      })
      .join('');
    return (
      '<input type="hidden" name="' +
      escapeHtml(name) +
      '" value="' +
      escapeHtml(selected == null ? '' : selected) +
      '" />' +
      '<div class="flex gap-1">' +
      buttons +
      '</div>'
    );
  }

  function tabClasses(active) {
    return active
      ? 'border-slate-900 text-slate-900'
      : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700';
  }

  function parseHash() {
    var hash = (window.location.hash || '#mine').replace(/^#/, '');
    var parts = hash.split('/').filter(Boolean);
    if (parts[0] === 'team') {
      return { tab: 'team', employeeId: parts[1] || null };
    }
    return { tab: 'mine', employeeId: null };
  }

  function setHash(tab, employeeId) {
    var next = tab === 'team' ? 'team' + (employeeId ? '/' + employeeId : '') : 'mine';
    if ((window.location.hash || '').replace(/^#/, '') !== next) {
      window.location.hash = next;
    }
  }

  function periodLabel(value) {
    var match = ((state.meta && state.meta.periods) || []).filter(function (item) {
      return item.value === value;
    })[0];
    return match ? match.label : value;
  }

  function objectiveTitle(plan, kpi) {
    if (!kpi.objective) return '';
    var match = (plan.objectives || []).filter(function (item) {
      return item.id === kpi.objective;
    })[0];
    return match ? match.title : '';
  }

  function chartsRow(plan) {
    var scores = (plan && plan.scores) || {};
    var appraisal = plan && plan.appraisal;
    return (
      '<div class="grid gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-card sm:grid-cols-3">' +
      ringChart(scores.completion, 'KPI completion', 'Weighted across assigned KPIs', 'sky') +
      ringChart(
        scores.selfPercent,
        'Self-assessment',
        appraisal && appraisal.selfAssessmentScore != null
          ? scoreLabel(appraisal.selfAssessmentScore)
          : 'Not submitted',
        'amber'
      ) +
      ringChart(
        scores.finalPercent != null ? scores.finalPercent : scores.supervisorPercent,
        'Final rating',
        appraisal && appraisal.finalRating != null
          ? scoreLabel(appraisal.finalRating)
          : appraisal && appraisal.supervisorScore != null
            ? scoreLabel(appraisal.supervisorScore)
            : 'Awaiting review',
        'emerald'
      ) +
      '</div>'
    );
  }

  function objectivesList(plan, permissions) {
    var items = (plan && plan.objectives) || [];
    if (!items.length) {
      return '<p class="text-sm text-slate-500">No objectives assigned for this period.</p>';
    }
    return items
      .map(function (item) {
        return (
          '<article class="rounded-lg border border-slate-200 bg-white p-4">' +
          '<div class="flex items-start justify-between gap-3">' +
          '<div>' +
          '<p class="text-sm font-semibold text-slate-900">' +
          escapeHtml(item.title) +
          '</p>' +
          (item.description
            ? '<p class="mt-1 text-sm text-slate-600">' + escapeHtml(item.description) + '</p>'
            : '') +
          '</div>' +
          '<div class="flex shrink-0 items-center gap-2">' +
          '<span class="text-xs font-medium text-slate-500">Weight ' +
          item.weight +
          '%</span>' +
          (permissions && permissions.canAssign
            ? '<button type="button" data-delete-objective="' +
              escapeHtml(item.id) +
              '" class="' +
              btnGhost() +
              '">Remove</button>'
            : '') +
          '</div></div></article>'
        );
      })
      .join('');
  }

  function kpiCards(plan, permissions) {
    var items = (plan && plan.kpis) || [];
    if (!items.length) {
      return '<p class="text-sm text-slate-500">No KPIs assigned for this period.</p>';
    }
    return items
      .map(function (kpi) {
        var parent = objectiveTitle(plan, kpi);
        return (
          '<article class="rounded-lg border border-slate-200 bg-white p-4">' +
          '<div class="flex items-start justify-between gap-3">' +
          '<div class="min-w-0">' +
          '<p class="text-sm font-semibold text-slate-900">' +
          escapeHtml(kpi.title) +
          '</p>' +
          (parent ? '<p class="mt-0.5 text-xs text-slate-500">' + escapeHtml(parent) + '</p>' : '') +
          (kpi.target ? '<p class="mt-1 text-sm text-slate-600">Target: ' + escapeHtml(kpi.target) + '</p>' : '') +
          '</div>' +
          '<div class="flex shrink-0 items-center gap-2">' +
          '<span class="text-xs font-medium text-slate-500">Weight ' +
          kpi.weight +
          '%</span>' +
          (permissions && permissions.canAssign
            ? '<button type="button" data-delete-kpi="' +
              escapeHtml(kpi.id) +
              '" class="' +
              btnGhost() +
              '">Remove</button>'
            : '') +
          '</div></div>' +
          '<div class="mt-3 flex items-center gap-3">' +
          '<div class="flex-1">' +
          progressBar(kpi.completion) +
          '</div>' +
          '<span class="w-10 text-right text-xs font-medium tabular-nums text-slate-600">' +
          percentLabel(kpi.completion) +
          '</span></div>' +
          (kpi.selfScore != null
            ? '<p class="mt-2 text-xs text-slate-500">Self: ' + escapeHtml(scoreLabel(kpi.selfScore)) + '</p>'
            : '') +
          '</article>'
        );
      })
      .join('');
  }

  function selfForm(plan) {
    if (!plan || !plan.kpis.length) return '';
    var rows = plan.kpis
      .map(function (kpi) {
        return (
          '<div class="rounded-lg border border-slate-200 p-4" data-kpi-row="' +
          escapeHtml(kpi.id) +
          '">' +
          '<div class="flex flex-wrap items-start justify-between gap-3">' +
          '<div>' +
          '<p class="text-sm font-semibold text-slate-900">' +
          escapeHtml(kpi.title) +
          '</p>' +
          (kpi.target ? '<p class="mt-0.5 text-xs text-slate-500">Target: ' + escapeHtml(kpi.target) + '</p>' : '') +
          '</div>' +
          scorePicker('score-' + kpi.id, '', false) +
          '</div>' +
          '<label class="mt-4 block text-xs font-medium text-slate-600">Completion (' +
          '<span data-completion-label="' +
          escapeHtml(kpi.id) +
          '">0%</span>)</label>' +
          '<input type="range" min="0" max="100" step="1" value="0" name="completion-' +
          escapeHtml(kpi.id) +
          '" data-completion-for="' +
          escapeHtml(kpi.id) +
          '" class="mt-1.5 w-full accent-slate-900" />' +
          '<label class="mt-3 block text-xs font-medium text-slate-600">Comments</label>' +
          '<textarea name="notes-' +
          escapeHtml(kpi.id) +
          '" rows="2" placeholder="How you performed against this KPI" class="' +
          fieldClass() +
          '"></textarea></div>'
        );
      })
      .join('');

    return (
      '<form id="self-form" novalidate class="rounded-xl border border-slate-200 bg-white p-6 shadow-card">' +
      '<h2 class="text-sm font-semibold text-slate-900">Self-assessment</h2>' +
      '<p class="mt-1 text-xs text-slate-500">Rate each KPI from 1 to 5 and describe the evidence. This locks once you submit.</p>' +
      '<div class="mt-4 space-y-4">' +
      rows +
      '</div>' +
      '<label class="mt-5 block text-sm font-medium text-slate-700">Overall comments</label>' +
      '<textarea id="self-notes" name="notes" rows="3" placeholder="A short summary of the period" class="' +
      fieldClass() +
      '"></textarea>' +
      '<div class="mt-5 flex justify-end">' +
      '<button type="submit" class="' +
      btnPrimary() +
      '">Submit self-assessment</button>' +
      '</div></form>'
    );
  }

  function readOnlySelf(plan) {
    var appraisal = plan.appraisal || {};
    var rows = (plan.kpis || [])
      .map(function (kpi) {
        return (
          '<div class="rounded-lg border border-slate-100 bg-slate-50 p-4">' +
          '<p class="text-sm font-semibold text-slate-900">' +
          escapeHtml(kpi.title) +
          '</p>' +
          '<p class="mt-1 text-sm text-slate-700">' +
          escapeHtml(kpi.selfScore != null ? scoreLabel(kpi.selfScore) : 'Not rated') +
          '</p>' +
          (kpi.selfNotes ? '<p class="mt-2 text-sm text-slate-600">' + escapeHtml(kpi.selfNotes) + '</p>' : '') +
          '<div class="mt-3 flex items-center gap-3">' +
          '<div class="flex-1">' +
          progressBar(kpi.completion) +
          '</div>' +
          '<span class="text-xs tabular-nums text-slate-500">' +
          percentLabel(kpi.completion) +
          '</span></div></div>'
        );
      })
      .join('');
    return (
      '<div class="rounded-xl border border-slate-200 bg-white p-6 shadow-card">' +
      '<h2 class="text-sm font-semibold text-slate-900">Your self-assessment</h2>' +
      '<div class="mt-4 space-y-3">' +
      rows +
      '</div>' +
      (appraisal.selfAssessmentNotes
        ? '<p class="mt-4 text-sm text-slate-600">' + escapeHtml(appraisal.selfAssessmentNotes) + '</p>'
        : '') +
      '</div>'
    );
  }

  function supervisorView(plan) {
    var appraisal = plan.appraisal || {};
    var rows = (plan.kpis || [])
      .map(function (kpi) {
        return (
          '<div class="grid gap-4 rounded-lg border border-slate-200 p-4 lg:grid-cols-2" data-review-kpi="' +
          escapeHtml(kpi.id) +
          '">' +
          '<div class="rounded-lg bg-slate-50 p-4">' +
          '<p class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Self-assessment</p>' +
          '<p class="mt-2 text-sm font-semibold text-slate-900">' +
          escapeHtml(kpi.title) +
          '</p>' +
          (kpi.target ? '<p class="mt-0.5 text-xs text-slate-500">Target: ' + escapeHtml(kpi.target) + '</p>' : '') +
          '<p class="mt-2 text-sm text-slate-800">' +
          escapeHtml(kpi.selfScore != null ? scoreLabel(kpi.selfScore) : 'Not rated') +
          '</p>' +
          (kpi.selfNotes ? '<p class="mt-2 text-sm text-slate-600">' + escapeHtml(kpi.selfNotes) + '</p>' : '') +
          '<div class="mt-3 flex items-center gap-3">' +
          '<div class="flex-1">' +
          progressBar(kpi.completion) +
          '</div>' +
          '<span class="text-xs tabular-nums text-slate-500">' +
          percentLabel(kpi.completion) +
          '</span></div></div>' +
          '<div>' +
          '<p class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Supervisor</p>' +
          '<p class="mt-2 text-xs font-medium text-slate-600">Your rating</p>' +
          '<div class="mt-1.5">' +
          scorePicker('review-score-' + kpi.id, '', false) +
          '</div>' +
          '<label class="mt-3 block text-xs font-medium text-slate-600">Comments</label>' +
          '<textarea name="review-notes-' +
          escapeHtml(kpi.id) +
          '" rows="3" placeholder="Your assessment of this KPI" class="' +
          fieldClass() +
          '"></textarea></div></div>'
        );
      })
      .join('');

    return (
      '<form id="review-form" novalidate class="rounded-xl border border-slate-200 bg-white p-6 shadow-card">' +
      '<div class="flex flex-wrap items-start justify-between gap-3">' +
      '<div>' +
      '<h2 class="text-sm font-semibold text-slate-900">Supervisor assessment</h2>' +
      '<p class="mt-1 text-xs text-slate-500">Employee comments stay on the left. Your ratings and final review go on the right.</p>' +
      '</div>' +
      statusBadge(appraisal.status) +
      '</div>' +
      (appraisal.selfAssessmentNotes
        ? '<div class="mt-4 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900"><span class="font-medium">Overall self-assessment. </span>' +
          escapeHtml(appraisal.selfAssessmentNotes) +
          '</div>'
        : '') +
      '<div class="mt-5 space-y-4">' +
      rows +
      '</div>' +
      '<div class="mt-6 grid gap-4 lg:grid-cols-2">' +
      '<div>' +
      '<label class="block text-sm font-medium text-slate-700">Final rating</label>' +
      '<div class="mt-1.5">' +
      scorePicker('final-rating', '', false) +
      '</div></div>' +
      '<div>' +
      '<label class="block text-sm font-medium text-slate-700">Final review</label>' +
      '<textarea id="review-notes" name="notes" rows="3" placeholder="Summary for the employee record" class="' +
      fieldClass() +
      '"></textarea></div></div>' +
      '<div class="mt-5 flex justify-end">' +
      '<button type="submit" class="' +
      btnPrimary() +
      '">Submit review</button>' +
      '</div></form>'
    );
  }

  function reviewedReadOnly(plan) {
    var appraisal = plan.appraisal || {};
    var rows = (plan.kpis || [])
      .map(function (kpi) {
        return (
          '<div class="grid gap-4 rounded-lg border border-slate-200 p-4 lg:grid-cols-2">' +
          '<div class="rounded-lg bg-slate-50 p-4">' +
          '<p class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Self-assessment</p>' +
          '<p class="mt-2 text-sm font-semibold text-slate-900">' +
          escapeHtml(kpi.title) +
          '</p>' +
          '<p class="mt-2 text-sm text-slate-800">' +
          escapeHtml(kpi.selfScore != null ? scoreLabel(kpi.selfScore) : '—') +
          '</p>' +
          (kpi.selfNotes ? '<p class="mt-2 text-sm text-slate-600">' + escapeHtml(kpi.selfNotes) + '</p>' : '') +
          '<div class="mt-3">' +
          progressBar(kpi.completion) +
          '</div></div>' +
          '<div class="p-4">' +
          '<p class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Supervisor</p>' +
          '<p class="mt-2 text-sm text-slate-800">' +
          escapeHtml(kpi.supervisorScore != null ? scoreLabel(kpi.supervisorScore) : '—') +
          '</p>' +
          (kpi.supervisorNotes ? '<p class="mt-2 text-sm text-slate-600">' + escapeHtml(kpi.supervisorNotes) + '</p>' : '') +
          '</div></div>'
        );
      })
      .join('');
    return (
      '<div class="rounded-xl border border-slate-200 bg-white p-6 shadow-card">' +
      '<div class="flex items-center justify-between gap-3">' +
      '<h2 class="text-sm font-semibold text-slate-900">Review</h2>' +
      statusBadge(appraisal.status) +
      '</div>' +
      '<div class="mt-4 space-y-3">' +
      rows +
      '</div>' +
      (appraisal.supervisorNotes
        ? '<p class="mt-4 text-sm text-slate-600">' + escapeHtml(appraisal.supervisorNotes) + '</p>'
        : '') +
      (appraisal.finalRating != null
        ? '<p class="mt-2 text-sm font-medium text-slate-900">Final rating: ' +
          escapeHtml(scoreLabel(appraisal.finalRating)) +
          '</p>'
        : '') +
      '</div>'
    );
  }

  function assignForms(plan) {
    var objectiveOptions = ['<option value="">No parent objective</option>']
      .concat(
        (plan.objectives || []).map(function (item) {
          return '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.title) + '</option>';
        })
      )
      .join('');

    return (
      '<div class="grid gap-6 lg:grid-cols-2">' +
      '<form id="objective-form" novalidate class="rounded-xl border border-slate-200 bg-white p-6 shadow-card">' +
      '<h2 class="text-sm font-semibold text-slate-900">Assign an objective</h2>' +
      '<p class="mt-1 text-xs text-slate-500">Qualitative goals for this person in ' +
      escapeHtml(periodLabel(state.period)) +
      '.</p>' +
      '<label class="mt-4 block text-sm font-medium text-slate-700">Title</label>' +
      '<input name="title" type="text" required maxlength="120" class="' +
      fieldClass() +
      '" />' +
      '<label class="mt-3 block text-sm font-medium text-slate-700">Description</label>' +
      '<textarea name="description" rows="2" class="' +
      fieldClass() +
      '"></textarea>' +
      '<label class="mt-3 block text-sm font-medium text-slate-700">Weight (%)</label>' +
      '<input name="weight" type="number" min="1" max="100" step="1" value="50" class="' +
      fieldClass() +
      '" />' +
      '<div class="mt-4 flex justify-end">' +
      '<button type="submit" class="' +
      btnPrimary() +
      '">Add objective</button></div></form>' +
      '<form id="kpi-form" novalidate class="rounded-xl border border-slate-200 bg-white p-6 shadow-card">' +
      '<h2 class="text-sm font-semibold text-slate-900">Assign a KPI</h2>' +
      '<p class="mt-1 text-xs text-slate-500">Measurable indicators the employee will self-assess against.</p>' +
      '<label class="mt-4 block text-sm font-medium text-slate-700">Title</label>' +
      '<input name="title" type="text" required maxlength="120" class="' +
      fieldClass() +
      '" />' +
      '<label class="mt-3 block text-sm font-medium text-slate-700">Target</label>' +
      '<input name="target" type="text" maxlength="120" placeholder="e.g. 95% uptime" class="' +
      fieldClass() +
      '" />' +
      '<label class="mt-3 block text-sm font-medium text-slate-700">Linked objective</label>' +
      '<select name="objective" class="' +
      fieldClass() +
      '">' +
      objectiveOptions +
      '</select>' +
      '<label class="mt-3 block text-sm font-medium text-slate-700">Weight (%)</label>' +
      '<input name="weight" type="number" min="1" max="100" step="1" value="30" class="' +
      fieldClass() +
      '" />' +
      '<div class="mt-4 flex justify-end">' +
      '<button type="submit" class="' +
      btnPrimary() +
      '">Add KPI</button></div></form></div>'
    );
  }

  function renderMine() {
    var panel = el('panel-mine');
    var plan = state.mine;
    var permissions = state.minePermissions || {};
    if (!plan) {
      panel.innerHTML = '<p class="text-sm text-slate-500">Loading your plan…</p>';
      return;
    }

    var person = plan.employee || {};
    var html =
      '<div class="flex flex-wrap items-center justify-between gap-3">' +
      '<div>' +
      '<h2 class="text-lg font-semibold text-slate-900">' +
      escapeHtml(person.fullName || 'Your plan') +
      '</h2>' +
      '<p class="text-sm text-slate-500">' +
      escapeHtml([person.designation, person.team, periodLabel(state.period)].filter(Boolean).join(' · ')) +
      '</p></div>' +
      statusBadge(plan.appraisal && plan.appraisal.status) +
      '</div>' +
      chartsRow(plan) +
      '<div>' +
      '<h3 class="text-sm font-semibold text-slate-900">Objectives</h3>' +
      '<div class="mt-3 space-y-3">' +
      objectivesList(plan, { canAssign: false }) +
      '</div></div>' +
      '<div>' +
      '<h3 class="text-sm font-semibold text-slate-900">KPIs</h3>' +
      '<div class="mt-3 grid gap-3 lg:grid-cols-2">' +
      kpiCards(plan, { canAssign: false }) +
      '</div></div>';

    if (permissions.canSelfAssess) html += selfForm(plan);
    else if (plan.appraisal && plan.appraisal.status !== 'assigned') html += readOnlySelf(plan);

    if (plan.appraisal && plan.appraisal.status === 'reviewed') html += reviewedReadOnly(plan);

    panel.innerHTML = html;
  }

  function memberCard(member) {
    var selected = state.selectedId === member.id;
    return (
      '<button type="button" data-select-member="' +
      escapeHtml(member.id) +
      '" class="w-full rounded-xl border p-4 text-left shadow-card transition ' +
      (selected ? 'border-slate-900 bg-white' : 'border-slate-200 bg-white hover:border-slate-300') +
      '">' +
      '<div class="flex items-start gap-3">' +
      '<span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">' +
      escapeHtml(initials(member.fullName)) +
      '</span>' +
      '<div class="min-w-0 flex-1">' +
      '<p class="truncate text-sm font-semibold text-slate-900">' +
      escapeHtml(member.fullName) +
      '</p>' +
      '<p class="truncate text-xs text-slate-500">' +
      escapeHtml([member.employeeCode, member.team || 'No team'].join(' · ')) +
      '</p>' +
      '<div class="mt-2 flex items-center justify-between gap-2">' +
      statusBadge(member.appraisal && member.appraisal.status) +
      '<span class="text-xs tabular-nums text-slate-500">' +
      percentLabel(member.completion) +
      '</span></div>' +
      '<div class="mt-2">' +
      progressBar(member.completion) +
      '</div></div></div></button>'
    );
  }

  function renderTeam() {
    var panel = el('panel-team');
    if (!canManageTeam()) {
      panel.innerHTML = '';
      return;
    }
    var team = state.team || { members: [], teams: [], viewerTeam: '' };
    var teamOptions =
      '<option value="">All teams</option>' +
      (team.teams || [])
        .map(function (name) {
          return '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>';
        })
        .join('');

    var membersHtml = (team.members || []).map(memberCard).join('');
    if (!membersHtml) {
      membersHtml =
        '<p class="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500">No team members match this filter. PMS uses the Core HR <span class="font-medium">team</span> field, plus anyone who reports to you.</p>';
    }

    var detail = '<div class="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-sm text-slate-500">Select a team member to assign objectives and KPIs, or to complete their review.</div>';
    if (state.selected) {
      var plan = state.selected;
      var permissions = state.selectedPermissions || {};
      var person = plan.employee || {};
      detail =
        '<div class="space-y-6">' +
        '<div class="flex flex-wrap items-center justify-between gap-3">' +
        '<div>' +
        '<h2 class="text-lg font-semibold text-slate-900">' +
        escapeHtml(person.fullName) +
        '</h2>' +
        '<p class="text-sm text-slate-500">' +
        escapeHtml([person.designation, person.team, person.employeeCode].filter(Boolean).join(' · ')) +
        '</p></div>' +
        statusBadge(plan.appraisal && plan.appraisal.status) +
        '</div>' +
        chartsRow(plan) +
        (permissions.canAssign ? assignForms(plan) : '') +
        '<div>' +
        '<h3 class="text-sm font-semibold text-slate-900">Objectives</h3>' +
        '<div class="mt-3 space-y-3">' +
        objectivesList(plan, permissions) +
        '</div></div>' +
        '<div>' +
        '<h3 class="text-sm font-semibold text-slate-900">KPIs</h3>' +
        '<div class="mt-3 grid gap-3">' +
        kpiCards(plan, permissions) +
        '</div></div>' +
        (permissions.canReview
          ? supervisorView(plan)
          : plan.appraisal && plan.appraisal.status === 'reviewed'
            ? reviewedReadOnly(plan)
            : plan.appraisal && plan.appraisal.status === 'assigned'
              ? '<p class="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">Waiting for the employee to submit a self-assessment before review.</p>'
              : '') +
        '</div>';
    }

    panel.innerHTML =
      '<div class="flex flex-wrap items-center justify-between gap-3">' +
      '<p class="text-sm text-slate-500">Assigning to people on your Core HR team' +
      (team.viewerTeam ? ' (<span class="font-medium text-slate-700">' + escapeHtml(team.viewerTeam) + '</span>)' : '') +
      '.</p>' +
      '<div>' +
      '<label for="team-filter" class="sr-only">Filter by team</label>' +
      '<select id="team-filter" class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10">' +
      teamOptions +
      '</select></div></div>' +
      '<div class="grid gap-6 lg:grid-cols-3">' +
      '<div class="space-y-3">' +
      membersHtml +
      '</div>' +
      '<div class="lg:col-span-2">' +
      detail +
      '</div></div>';

    var filter = el('team-filter');
    if (filter) filter.value = team.appliedTeam || '';
  }

  function renderTabs() {
    var teamTab = el('tab-team');
    teamTab.classList.toggle('hidden', !canManageTeam());
    el('tab-mine').className =
      'group inline-flex items-center gap-2 border-b-2 px-1 pb-3 text-sm font-medium transition ' +
      tabClasses(state.tab === 'mine');
    teamTab.className =
      (canManageTeam() ? 'group inline-flex ' : 'hidden group inline-flex ') +
      'items-center gap-2 border-b-2 px-1 pb-3 text-sm font-medium transition ' +
      tabClasses(state.tab === 'team');

    var pending = ((state.team && state.team.members) || []).filter(function (member) {
      return member.appraisal && member.appraisal.status === 'self_submitted';
    }).length;
    var badge = el('tab-team-badge');
    badge.textContent = pending ? String(pending) : '';
    badge.classList.toggle('hidden', !pending);

    el('panel-mine').classList.toggle('hidden', state.tab !== 'mine');
    el('panel-team').classList.toggle('hidden', state.tab !== 'team');
  }

  function render() {
    renderTabs();
    renderMine();
    if (canManageTeam()) renderTeam();
  }

  function fillPeriodSelect() {
    var select = el('period-select');
    select.innerHTML = ((state.meta && state.meta.periods) || [])
      .map(function (item) {
        return (
          '<option value="' +
          escapeHtml(item.value) +
          '">' +
          escapeHtml(item.label) +
          (item.current ? ' (current)' : '') +
          '</option>'
        );
      })
      .join('');
    select.value = state.period;
  }

  async function loadMine() {
    var result = await api.get('/pms/me?period=' + encodeURIComponent(state.period));
    state.mine = result.plan;
    state.minePermissions = result.permissions;
  }

  async function loadTeam(teamFilter) {
    var query = '/pms/team?period=' + encodeURIComponent(state.period);
    if (teamFilter) query += '&team=' + encodeURIComponent(teamFilter);
    var result = await api.get(query);
    state.team = result;
    state.team.appliedTeam = teamFilter || '';
    if (state.selectedId && !(result.members || []).some(function (member) {
      return member.id === state.selectedId;
    })) {
      state.selectedId = null;
      state.selected = null;
      state.selectedPermissions = null;
    }
    render();
  }

  async function loadSelected(employeeId) {
    if (!employeeId) {
      state.selectedId = null;
      state.selected = null;
      state.selectedPermissions = null;
      render();
      return;
    }
    var result = await api.get(
      '/pms/employees/' + encodeURIComponent(employeeId) + '/plan?period=' + encodeURIComponent(state.period)
    );
    state.selectedId = employeeId;
    state.selected = result.plan;
    state.selectedPermissions = result.permissions;
    render();
  }

  async function refresh() {
    showError('');
    await loadMine();
    if (canManageTeam()) {
      await loadTeam(state.team && state.team.appliedTeam);
      if (state.selectedId) await loadSelected(state.selectedId);
    }
    render();
  }

  function collectKpiPayload(prefix, kpis) {
    return kpis.map(function (kpi) {
      var scoreInput = document.querySelector('[name="' + prefix + 'score-' + kpi.id + '"]');
      var notesInput = document.querySelector('[name="' + prefix + 'notes-' + kpi.id + '"]');
      var completionInput = document.querySelector('[name="completion-' + kpi.id + '"]');
      return {
        id: kpi.id,
        score: scoreInput ? scoreInput.value : '',
        notes: notesInput ? notesInput.value : '',
        completion: completionInput ? Number(completionInput.value) : 0,
      };
    });
  }

  function wireScoreButtons(root) {
    root.addEventListener('click', function (event) {
      var button = event.target.closest('[data-score-for]');
      if (!button || button.disabled) return;
      var name = button.getAttribute('data-score-for');
      var value = button.getAttribute('data-score');
      var hidden = root.querySelector('[name="' + name + '"]');
      if (hidden) hidden.value = value;
      root.querySelectorAll('[data-score-for="' + name + '"]').forEach(function (item) {
        var active = item.getAttribute('data-score') === value;
        item.classList.toggle('bg-slate-900', active);
        item.classList.toggle('text-white', active);
        item.classList.toggle('bg-white', !active);
        item.classList.toggle('text-slate-700', !active);
      });
    });
  }

  function openConfirm(title, text, onOk) {
    state.confirm = onOk;
    el('confirm-title').textContent = title;
    el('confirm-text').textContent = text;
    el('confirm-backdrop').classList.remove('hidden');
  }

  function closeConfirm() {
    state.confirm = null;
    el('confirm-backdrop').classList.add('hidden');
  }

  function onDocumentClick(event) {
    var tab = event.target.closest('[data-tab]');
    if (tab) {
      var next = tab.getAttribute('data-tab');
      if (next === 'team' && !canManageTeam()) return;
      state.tab = next;
      setHash(next, next === 'team' ? state.selectedId : null);
      render();
      return;
    }

    var member = event.target.closest('[data-select-member]');
    if (member) {
      var id = member.getAttribute('data-select-member');
      state.tab = 'team';
      setHash('team', id);
      loadSelected(id).catch(function (err) {
        if (err && err.status === 401) return;
        toast(err.message, 'error');
      });
      return;
    }

    var deleteObjective = event.target.closest('[data-delete-objective]');
    if (deleteObjective) {
      openConfirm('Remove objective', 'This objective will be removed from the plan. Linked KPIs stay assigned.', function () {
        return api.request('/pms/objectives/' + deleteObjective.getAttribute('data-delete-objective'), {
          method: 'DELETE',
        }).then(function () {
          toast('Objective removed');
          return refresh();
        });
      });
      return;
    }

    var deleteKpi = event.target.closest('[data-delete-kpi]');
    if (deleteKpi) {
      openConfirm('Remove KPI', 'This KPI will be removed from the plan.', function () {
        return api.request('/pms/kpis/' + deleteKpi.getAttribute('data-delete-kpi'), { method: 'DELETE' }).then(
          function () {
            toast('KPI removed');
            return refresh();
          }
        );
      });
    }
  }

  function onInput(event) {
    var completion = event.target.getAttribute && event.target.getAttribute('data-completion-for');
    if (!completion) return;
    var label = document.querySelector('[data-completion-label="' + completion + '"]');
    if (label) label.textContent = event.target.value + '%';
  }

  async function onSubmit(event) {
    var form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    if (form.id === 'self-form') {
      event.preventDefault();
      if (state.busy) return;
      var plan = state.mine;
      var payload = {
        notes: el('self-notes') ? el('self-notes').value : '',
        kpis: collectKpiPayload('', plan.kpis),
      };
      var missing = payload.kpis.filter(function (item) {
        return !item.score;
      });
      if (missing.length) {
        toast('Rate every KPI before submitting.', 'error');
        return;
      }
      state.busy = true;
      try {
        var result = await api.post('/pms/appraisals/' + plan.appraisal.id + '/self', payload);
        state.mine = result.plan;
        state.minePermissions = result.permissions;
        toast('Self-assessment submitted');
        await refresh();
      } catch (err) {
        if (err && err.status === 401) return;
        toast(err.message, 'error');
      } finally {
        state.busy = false;
      }
      return;
    }

    if (form.id === 'review-form') {
      event.preventDefault();
      if (state.busy) return;
      var selected = state.selected;
      var reviewPayload = {
        notes: el('review-notes') ? el('review-notes').value : '',
        finalRating: document.querySelector('[name="final-rating"]').value,
        kpis: collectKpiPayload('review-', selected.kpis),
      };
      if (!reviewPayload.finalRating || reviewPayload.kpis.some(function (item) { return !item.score; })) {
        toast('Give every KPI a rating and a final rating.', 'error');
        return;
      }
      state.busy = true;
      try {
        await api.post('/pms/appraisals/' + selected.appraisal.id + '/review', reviewPayload);
        toast('Review submitted');
        await refresh();
      } catch (err) {
        if (err && err.status === 401) return;
        toast(err.message, 'error');
      } finally {
        state.busy = false;
      }
      return;
    }

    if (form.id === 'objective-form' || form.id === 'kpi-form') {
      event.preventDefault();
      if (state.busy || !state.selected) return;
      var data = new FormData(form);
      var body = {
        employee: state.selected.employee.id,
        period: state.period,
        title: String(data.get('title') || '').trim(),
        weight: Number(data.get('weight')),
      };
      if (form.id === 'objective-form') {
        body.description = String(data.get('description') || '').trim();
      } else {
        body.target = String(data.get('target') || '').trim();
        body.objective = String(data.get('objective') || '') || undefined;
      }
      if (!body.title) {
        toast('A title is required.', 'error');
        return;
      }
      state.busy = true;
      try {
        await api.post(form.id === 'objective-form' ? '/pms/objectives' : '/pms/kpis', body);
        form.reset();
        toast(form.id === 'objective-form' ? 'Objective assigned' : 'KPI assigned');
        await refresh();
      } catch (err) {
        if (err && err.status === 401) return;
        toast(err.message, 'error');
      } finally {
        state.busy = false;
      }
    }
  }

  async function applyRoute() {
    var route = parseHash();
    if (route.tab === 'team' && !canManageTeam()) {
      state.tab = 'mine';
      setHash('mine');
      render();
      return;
    }
    state.tab = route.tab;
    if (route.tab === 'team' && route.employeeId) {
      await loadSelected(route.employeeId);
    } else if (route.tab !== 'team') {
      render();
    } else {
      render();
    }
  }

  async function init() {
    var user = await shell.mount('pms');
    if (!user) return;
    state.user = user;

    var metaResult = await api.get('/pms/meta');
    state.meta = metaResult.meta;
    state.period = state.meta.currentPeriod;
    fillPeriodSelect();

    var route = parseHash();
    state.tab = canManageTeam() ? route.tab : 'mine';
    state.selectedId = state.tab === 'team' ? route.employeeId : null;

    await loadMine();
    if (canManageTeam()) {
      await loadTeam();
      if (state.selectedId) await loadSelected(state.selectedId);
    }
    render();

    el('period-select').addEventListener('change', async function (event) {
      state.period = event.target.value;
      state.selected = null;
      try {
        await refresh();
      } catch (err) {
        if (err && err.status === 401) return;
        showError(err.message);
      }
    });

    document.addEventListener('click', onDocumentClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', function (event) {
      if (event.target && event.target.id === 'team-filter') {
        loadTeam(event.target.value).catch(function (err) {
          if (err && err.status === 401) return;
          toast(err.message, 'error');
        });
      }
    });
    document.addEventListener('submit', onSubmit);
    wireScoreButtons(document);

    el('confirm-cancel').addEventListener('click', closeConfirm);
    el('confirm-ok').addEventListener('click', async function () {
      var action = state.confirm;
      closeConfirm();
      if (!action) return;
      try {
        await action();
      } catch (err) {
        if (err && err.status === 401) return;
        toast(err.message, 'error');
      }
    });

    window.addEventListener('hashchange', function () {
      applyRoute().catch(function (err) {
        if (err && err.status === 401) return;
        toast(err.message, 'error');
      });
    });
  }

  init().catch(function (err) {
    if (err && err.status === 401) return;
    console.error('PMS failed to initialise', err);
    showError(err.message || 'Could not load performance data.');
    document.body.classList.remove('invisible');
  });
})(window, document);
