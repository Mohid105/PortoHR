/* Analytics: role-scoped dashboards, as-of headcount, quality, audited exports. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var shell = window.PortoHR.shell;

  var state = {
    user: null,
    tab: 'overview',
    overview: null,
    headcount: null,
    quality: null,
    outlook: null,
    reports: [],
    run: null,
    adhocGroup: 'department',
    snapshots: [],
    exports: [],
  };

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function isHr() {
    return state.user && state.user.role === 'hr_admin';
  }

  function toast(message, tone) {
    var node = document.createElement('div');
    node.className =
      'pointer-events-auto rounded-lg border px-4 py-2.5 text-sm shadow-lg ' +
      (tone === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800');
    node.textContent = message;
    el('toasts').appendChild(node);
    window.setTimeout(function () {
      node.remove();
    }, 3200);
  }

  function setTab(tab) {
    state.tab = tab;
    ['overview', 'headcount', 'quality', 'outlook', 'reports', 'snapshots'].forEach(function (name) {
      var panel = el('tab-' + name);
      if (panel) panel.classList.toggle('hidden', name !== tab);
    });
    document.querySelectorAll('.tab-btn').forEach(function (button) {
      var active = button.getAttribute('data-tab') === tab;
      button.classList.toggle('border-[#2054C9]', active);
      button.classList.toggle('border-transparent', !active);
      button.classList.toggle('font-semibold', active);
      button.classList.toggle('text-slate-900', active);
      button.classList.toggle('text-slate-500', !active);
    });
  }

  function todayInput() {
    var now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  }

  function bars(items, labelKey, valueKey) {
    var rows = items || [];
    var max = 1;
    rows.forEach(function (row) {
      if ((row[valueKey] || 0) > max) max = row[valueKey];
    });
    if (!rows.length) return '<p class="text-sm text-slate-500">No rows.</p>';
    return (
      '<ul class="space-y-2">' +
      rows
        .map(function (row) {
          var pct = Math.round(((row[valueKey] || 0) / max) * 100);
          return (
            '<li><div class="flex items-center justify-between text-sm"><span>' +
            escapeHtml(row[labelKey] || row.key) +
            '</span><span class="tabular-nums text-slate-500">' +
            (row[valueKey] || 0) +
            '</span></div><div class="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div class="h-full rounded-full bg-[#2054C9]" style="width:' +
            pct +
            '%"></div></div></li>'
          );
        })
        .join('') +
      '</ul>'
    );
  }

  function sparkline(points) {
    var rows = points || [];
    if (rows.length < 2) return '';
    var max = 1;
    rows.forEach(function (row) {
      if (row.headcount > max) max = row.headcount;
    });
    var w = 280;
    var h = 64;
    var d = rows
      .map(function (row, index) {
        var x = (index / (rows.length - 1)) * w;
        var y = h - (row.headcount / max) * (h - 8) - 4;
        return (index ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
      })
      .join(' ');
    return (
      '<svg viewBox="0 0 ' +
      w +
      ' ' +
      h +
      '" class="h-16 w-full text-[#2054C9]" fill="none"><path d="' +
      d +
      '" stroke="currentColor" stroke-width="2" /></svg>' +
      '<p class="mt-1 text-xs text-slate-400">' +
      escapeHtml(rows[0].month) +
      ' → ' +
      escapeHtml(rows[rows.length - 1].month) +
      '</p>'
    );
  }

  function renderOverview() {
    var data = state.overview || { tiles: [], byDepartment: [], trend: [] };
    var tiles = (data.tiles || [])
      .map(function (tile) {
        return (
          '<button type="button" data-jump="' +
          escapeHtml(tile.href) +
          '" class="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-card hover:border-slate-300">' +
          '<p class="text-xs font-semibold uppercase tracking-wider text-slate-400">' +
          escapeHtml(tile.label) +
          '</p><p class="mt-1 text-2xl font-semibold tabular-nums">' +
          escapeHtml(String(tile.value)) +
          '</p><p class="mt-1 text-xs text-slate-400">' +
          escapeHtml(tile.hint || '') +
          '</p></button>'
        );
      })
      .join('');
    var payroll = data.payroll
      ? '<p class="mt-2 text-sm text-slate-500">' +
        escapeHtml(data.payroll.month) +
        ' · ' +
        data.payroll.slips +
        ' slips vs ' +
        data.payroll.headcount +
        ' active' +
        (data.payroll.net != null ? ' · net ' + data.payroll.net + ' ' + escapeHtml(data.payroll.currency || '') : '') +
        '</p>'
      : '';
    el('overview-board').innerHTML =
      '<p class="mb-4 text-xs text-slate-500">Scope: ' +
      escapeHtml(data.scope || '') +
      ' · as of ' +
      escapeHtml(data.asOf || '') +
      '. Tiles drill into the matching tab.</p>' +
      '<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">' +
      tiles +
      '</div>' +
      '<div class="mt-8 grid gap-6 lg:grid-cols-2">' +
      '<div class="rounded-xl border border-slate-200 bg-white p-5 shadow-card"><h2 class="text-sm font-semibold">By department</h2><div class="mt-4">' +
      bars(data.byDepartment, 'key', 'count') +
      '</div></div>' +
      '<div class="rounded-xl border border-slate-200 bg-white p-5 shadow-card"><h2 class="text-sm font-semibold">Headcount trend</h2>' +
      sparkline(data.trend) +
      payroll +
      '</div></div>';
  }

  function namedList(title, rows, line) {
    if (!rows || !rows.length) return '';
    return (
      '<div class="mt-6"><h3 class="text-sm font-semibold">' +
      title +
      '</h3><ul class="mt-2 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">' +
      rows
        .map(function (row) {
          return '<li class="px-4 py-2.5 text-sm">' + line(row) + '</li>';
        })
        .join('') +
      '</ul></div>'
    );
  }

  function renderHeadcount() {
    var data = state.headcount || { byDepartment: [], hires: [], exits: [], transfers: [] };
    var cost =
      data.payrollCost != null
        ? '<p class="text-sm text-slate-500">Gross monthly reference (base + allowances): ' +
          data.payrollCost +
          '</p>'
        : '';
    el('headcount-board').innerHTML =
      '<div class="grid gap-4 sm:grid-cols-3"><div class="rounded-xl border border-slate-200 bg-white p-4 shadow-card"><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Headcount</p><p class="mt-1 text-2xl font-semibold">' +
      (data.total || 0) +
      '</p></div><div class="rounded-xl border border-slate-200 bg-white p-4 shadow-card"><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Hires in window</p><p class="mt-1 text-2xl font-semibold">' +
      (data.hires || []).length +
      '</p></div><div class="rounded-xl border border-slate-200 bg-white p-4 shadow-card"><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Exits in window</p><p class="mt-1 text-2xl font-semibold">' +
      (data.exits || []).length +
      '</p></div></div>' +
      cost +
      '<div class="mt-6 grid gap-6 lg:grid-cols-2"><div class="rounded-xl border border-slate-200 bg-white p-5 shadow-card"><h2 class="text-sm font-semibold">Department</h2><div class="mt-4">' +
      bars(data.byDepartment, 'key', 'count') +
      '</div></div><div class="rounded-xl border border-slate-200 bg-white p-5 shadow-card"><h2 class="text-sm font-semibold">Status</h2><div class="mt-4">' +
      bars(data.byStatus, 'key', 'count') +
      '</div></div></div>' +
      namedList('Hires', data.hires, function (row) {
        return escapeHtml(row.fullName) + ' · ' + escapeHtml(row.employeeCode) + ' · ' + escapeHtml(row.joinedOn);
      }) +
      namedList('Exits', data.exits, function (row) {
        return escapeHtml(row.fullName) + ' · last day ' + escapeHtml(row.lastWorkingDay);
      }) +
      namedList('Movements', data.transfers, function (row) {
        return escapeHtml(row.event) + ' · ' + escapeHtml(row.designation) + ' · ' + escapeHtml(row.effectiveFrom);
      });
  }

  function renderOutlook() {
    var data = state.outlook || { watch: [], coverage: {}, movement: [] };
    var cover = data.coverage || {};
    var bandTone = {
      attention: 'bg-red-50 text-red-700 ring-red-600/20',
      watch: 'bg-amber-50 text-amber-700 ring-amber-600/20',
      stable: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    };
    var tiles =
      '<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">' +
      '<div class="rounded-xl border border-slate-200 bg-white p-4 shadow-card"><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Headcount</p><p class="mt-1 text-2xl font-semibold tabular-nums">' +
      (cover.headcount || 0) +
      '</p></div>' +
      '<div class="rounded-xl border border-slate-200 bg-white p-4 shadow-card"><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">On notice</p><p class="mt-1 text-2xl font-semibold tabular-nums">' +
      (cover.onNotice || 0) +
      '</p></div>' +
      '<div class="rounded-xl border border-slate-200 bg-white p-4 shadow-card"><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">If notice exits</p><p class="mt-1 text-2xl font-semibold tabular-nums">' +
      (cover.projectedIfNoticeExits || 0) +
      '</p><p class="mt-1 text-xs text-slate-400">Arithmetic, not a model</p></div>' +
      (cover.vacantFte != null
        ? '<div class="rounded-xl border border-slate-200 bg-white p-4 shadow-card"><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Vacant FTE / open seats</p><p class="mt-1 text-2xl font-semibold tabular-nums">' +
          cover.vacantFte +
          ' / ' +
          (cover.openRequisitionSeats || 0) +
          '</p></div>'
        : '') +
      '</div>';
    var watch = (data.watch || [])
      .map(function (row) {
        return (
          '<li class="px-5 py-3"><div class="flex items-start justify-between gap-3"><div><p class="text-sm font-medium">' +
          escapeHtml(row.fullName) +
          ' · ' +
          escapeHtml(row.employeeCode) +
          '</p><p class="text-xs text-slate-500">' +
          escapeHtml((row.reasons || []).join(' · ') || 'No watch rules fired') +
          '</p></div><span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ' +
          (bandTone[row.band] || bandTone.watch) +
          '">' +
          escapeHtml(row.band) +
          ' · ' +
          row.score +
          '</span></div></li>'
        );
      })
      .join('');
    el('outlook-board').innerHTML =
      '<p class="text-sm text-slate-500">' +
      escapeHtml(data.disclaimer || '') +
      '</p>' +
      tiles +
      '<div class="mt-8 grid gap-6 lg:grid-cols-2">' +
      '<div class="rounded-xl border border-slate-200 bg-white p-5 shadow-card"><h2 class="text-sm font-semibold">Movement (6 months)</h2><div class="mt-4">' +
      sparkline(data.movement) +
      '</div><ul class="mt-4 space-y-1 text-xs text-slate-500">' +
      (data.movement || [])
        .map(function (row) {
          return (
            '<li class="flex justify-between"><span>' +
            escapeHtml(row.month) +
            '</span><span>hires ' +
            row.hires +
            ' · exits ' +
            row.exits +
            ' · hc ' +
            row.headcount +
            '</span></li>'
          );
        })
        .join('') +
      '</ul></div>' +
      '<div class="rounded-xl border border-slate-200 bg-white p-5 shadow-card"><h2 class="text-sm font-semibold">Watch list</h2><p class="mt-1 text-xs text-slate-400">Overtime uses ' +
      escapeHtml(data.overtimeMonth || 'last month') +
      '. ER cases stay on the anonymized caseload report.</p><ul class="mt-3 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-100">' +
      (watch || '<li class="px-5 py-3 text-sm text-slate-500">Nobody in scope is on a watch rule.</li>') +
      '</ul></div></div>';
  }

  function renderQuality() {
    var data = state.quality || { exceptions: [], byKind: [], total: 0 };
    el('quality-board').innerHTML =
      '<p class="text-sm text-slate-500">' +
      data.total +
      ' exceptions in scope. Missing bank, expiring papers, unapproved work and recovery tasks.</p>' +
      '<div class="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-card">' +
      bars(data.byKind, 'key', 'count') +
      '</div>' +
      '<ul class="mt-6 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">' +
      (data.exceptions || [])
        .map(function (row) {
          return (
            '<li class="px-5 py-3 text-sm"><p class="font-medium">' +
            escapeHtml(row.message) +
            '</p><p class="text-xs text-slate-400">' +
            escapeHtml(row.kind) +
            (row.holder ? ' · ' + escapeHtml(row.holder) : '') +
            '</p></li>'
          );
        })
        .join('') +
      '</ul>';
  }

  function renderReports() {
    var run = state.run;
    var table = '';
    if (run && run.rows) {
      table =
        '<div class="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card"><table class="min-w-full text-left text-sm"><thead class="bg-slate-50 text-xs uppercase text-slate-500"><tr>' +
        (run.columns || [])
          .map(function (col) {
            return '<th class="px-4 py-2 font-medium">' + escapeHtml(col) + '</th>';
          })
          .join('') +
        '</tr></thead><tbody>' +
        run.rows
          .map(function (row) {
            return (
              '<tr class="border-t border-slate-100">' +
              (run.columns || [])
                .map(function (col) {
                  return '<td class="px-4 py-2">' + escapeHtml(row[col] == null ? '' : row[col]) + '</td>';
                })
                .join('') +
              '</tr>'
            );
          })
          .join('') +
        '</tbody></table></div>' +
        '<button type="button" id="download-run" class="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50">Export JSON (audited)</button>';
    }
    el('reports-board').innerHTML =
      '<p class="text-sm text-slate-500">Standard library plus a whitelist roster pivot. There is no free-form SQL. Export and ad-hoc runs write an audit row.</p>' +
      '<form id="adhoc-form" class="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-card">' +
      '<label class="text-sm"><span class="block text-xs font-medium text-slate-500">Ad-hoc roster group-by</span>' +
      '<select id="adhoc-group" class="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm">' +
      ['department', 'status', 'location', 'designation', 'team']
        .map(function (field) {
          return (
            '<option value="' +
            field +
            '"' +
            (state.adhocGroup === field ? ' selected' : '') +
            '>' +
            field +
            '</option>'
          );
        })
        .join('') +
      '</select></label>' +
      '<button type="submit" class="rounded-lg bg-[#2054C9] px-3 py-2 text-sm font-semibold text-white hover:bg-[#173F9C]">Run pivot</button>' +
      '</form>' +
      '<ul class="mt-4 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">' +
      (state.reports || [])
        .map(function (row) {
          return (
            '<li class="flex items-center justify-between gap-3 px-5 py-3"><div><p class="text-sm font-medium">' +
            escapeHtml(row.name) +
            '</p><p class="text-xs text-slate-400">' +
            escapeHtml(row.summary) +
            (row.cadence === 'monthly' ? ' · monthly snapshot cadence (in-app)' : '') +
            '</p></div><button type="button" data-run="' +
            escapeHtml(row.code) +
            '" class="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold hover:bg-slate-50">Run</button></li>'
          );
        })
        .join('') +
      '</ul>' +
      table;
  }

  function renderSnapshots() {
    el('snapshot-list').innerHTML =
      '<h2 class="text-sm font-semibold">KPI snapshots</h2><ul class="mt-3 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">' +
      ((state.snapshots || []).length
        ? state.snapshots
            .map(function (row) {
              return (
                '<li class="px-5 py-3 text-sm"><p class="font-medium">' +
                escapeHtml(row.label || row.asOf) +
                '</p><p class="text-xs text-slate-400">as of ' +
                escapeHtml(row.asOf) +
                ' · ' +
                escapeHtml(JSON.stringify(row.metrics || {})) +
                '</p></li>'
              );
            })
            .join('')
        : '<li class="px-5 py-3 text-sm text-slate-500">None stored yet.</li>') +
      '</ul>';
    el('export-list').innerHTML =
      '<h2 class="text-sm font-semibold">Export log</h2><ul class="mt-3 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">' +
      ((state.exports || []).length
        ? state.exports
            .map(function (row) {
              return (
                '<li class="px-5 py-3 text-sm">' +
                escapeHtml(row.reportName || row.reportCode) +
                ' · ' +
                row.rowCount +
                ' rows · ' +
                escapeHtml(row.actorName || '') +
                ' · ' +
                escapeHtml(row.at) +
                '</li>'
              );
            })
            .join('')
        : '<li class="px-5 py-3 text-sm text-slate-500">No exports yet.</li>') +
      '</ul>';
  }

  function downloadJson(filename, payload) {
    var blob = new window.Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = window.URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.URL.revokeObjectURL(url);
  }

  async function loadHeadcount(asOf) {
    var query = asOf ? '?asOf=' + encodeURIComponent(asOf) : '';
    state.headcount = (await api.get('/analytics/headcount' + query)).headcount;
    renderHeadcount();
  }

  async function loadAll() {
    var tasks = [
      api.get('/analytics/overview'),
      api.get('/analytics/headcount'),
      api.get('/analytics/quality'),
      api.get('/analytics/outlook'),
      api.get('/analytics/reports'),
    ];
    if (isHr()) {
      tasks.push(api.get('/analytics/snapshots'));
      tasks.push(api.get('/analytics/exports'));
    }
    var results = await Promise.all(tasks);
    state.overview = results[0].overview;
    state.headcount = results[1].headcount;
    state.quality = results[2].quality;
    state.outlook = results[3].outlook;
    state.reports = results[4].reports || [];
    if (isHr()) {
      state.snapshots = results[5].snapshots || [];
      state.exports = results[6].exports || [];
    }
    renderOverview();
    renderHeadcount();
    renderQuality();
    renderOutlook();
    renderReports();
    if (isHr()) renderSnapshots();
  }

  function wire() {
    if (isHr()) {
      el('refresh-kpi').classList.remove('hidden');
      document.querySelector('[data-tab="snapshots"]').classList.remove('hidden');
    }
    var asOf = el('asof-date');
    if (asOf) asOf.value = todayInput();

    el('an-tabs').addEventListener('click', function (event) {
      var button = event.target.closest('[data-tab]');
      if (button) setTab(button.getAttribute('data-tab'));
    });

    el('asof-form').addEventListener('submit', function (event) {
      event.preventDefault();
      loadHeadcount(el('asof-date').value).catch(function (err) {
        toast(err.message, 'error');
      });
    });

    document.body.addEventListener('submit', function (event) {
      if (event.target.id !== 'adhoc-form') return;
      event.preventDefault();
      var groupBy = el('adhoc-group') ? el('adhoc-group').value : 'department';
      state.adhocGroup = groupBy;
      api
        .post('/analytics/adhoc', { groupBy: groupBy })
        .then(function (payload) {
          state.run = payload;
          renderReports();
          toast('Roster pivot logged');
          if (isHr()) return loadAll();
        })
        .catch(function (err) {
          toast(err.message, 'error');
        });
    });

    el('refresh-kpi').addEventListener('click', function () {
      api
        .post('/analytics/snapshots', {})
        .then(function (payload) {
          toast(payload.message || 'Snapshot stored');
          return loadAll();
        })
        .catch(function (err) {
          toast(err.message, 'error');
        });
    });

    document.body.addEventListener('click', function (event) {
      var jump = event.target.closest('[data-jump]');
      if (jump) {
        setTab(jump.getAttribute('data-jump'));
        return;
      }
      var run = event.target.closest('[data-run]');
      if (run) {
        api
          .get('/analytics/reports/' + run.getAttribute('data-run'))
          .then(function (payload) {
            state.run = payload;
            renderReports();
          })
          .catch(function (err) {
            toast(err.message, 'error');
          });
        return;
      }
      if (event.target.id === 'download-run' && state.run) {
        api
          .post('/analytics/reports/' + state.run.report.code + '/export', {})
          .then(function (payload) {
            downloadJson('portohr-' + payload.report.code + '.json', payload);
            toast('Export logged');
            if (isHr()) return loadAll();
          })
          .catch(function (err) {
            toast(err.message, 'error');
          });
      }
    });
  }

  async function init() {
    var user = await shell.mount('analytics');
    if (!user) return;
    state.user = user;
    wire();
    await loadAll().catch(function (err) {
      toast(err.message || 'Analytics failed to load', 'error');
    });
  }

  init().catch(function (err) {
    if (err && err.status === 401) return;
    console.error('Analytics failed to initialise', err);
  });
})(window, document);
