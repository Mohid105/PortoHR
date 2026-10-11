/* Reports: the report library, saved reports, and the builder. */
(function (window, document) {
  'use strict';

  var R = window.PortoHR.rep;
  var api = window.PortoHR.api;
  var S = R.state;
  var el = R.el;
  var $ = R.$;
  var $$ = R.$$;
  var esc = R.esc;

  var NUMERIC = ['number', 'money', 'hours', 'percent'];
  var B = {
    ds: null, mode: 'list', cols: [], groups: [], aggs: [{ fn: 'count' }], filters: [], sort: null, limit: 2000,
    result: null, view: 'table', measure: -1, visible: 200, savedId: null, savedName: '', values: {}, running: false, lastBody: null, showSave: false, libCat: '', libQuery: '',
  };

  var family = function (type) { return { text: 'text', enum: 'enum', bool: 'bool', date: 'date', datetime: 'date' }[type] || (NUMERIC.indexOf(type) !== -1 ? 'number' : 'text'); };
  var col = function (key) { return (B.ds && B.ds.columns.filter(function (c) { return c.key === key; })[0]) || null; };
  var opsFor = function (c) { return S.meta.ops.byFamily[family(c.type)] || []; };
  var opLabel = function (op) { return S.meta.ops.labels[op] || op; };
  var aggKey = function (a) { return a.fn === 'count' ? 'count' : a.fn + '_' + a.field; };

  /* ===================================================================== library */

  function savedCard(s) {
    var ds = S.meta.datasets.filter(function (d) { return d.key === s.dataset; })[0];
    var canDelete = s.mine || S.isHr;
    return '<div class="rrep" role="button" tabindex="0" data-saved="' + esc(s.id) + '"><b>' + esc(s.name) + '</b><p>' + esc(s.description || (ds ? ds.label : s.dataset)) + '</p>' +
      '<div class="foot"><span class="pill">' + esc(ds ? ds.label : s.dataset) + '</span>' + (s.shared ? '<span class="pill info">Shared</span>' : '') + (s.mine ? '' : '<span class="rmuted">' + esc(s.ownerName) + '</span>') +
      (canDelete ? '<button type="button" class="x" data-del-saved="' + esc(s.id) + '" aria-label="Delete this saved report" title="Delete">&times;</button>' : '') + '</div></div>';
  }

  function renderLibrary() {
    var saved = S.meta.saved || [];
    el('lib-saved').classList.toggle('hidden', !saved.length);
    el('lib-saved-list').innerHTML = saved.map(savedCard).join('');

    var q = B.libQuery.toLowerCase();
    var all = S.meta.library;
    var cats = all.map(function (r) { return r.category; }).filter(function (c, i, a) { return a.indexOf(c) === i; });
    el('lib-cats').innerHTML = ['All'].concat(cats).map(function (c) {
      var on = (c === 'All' && !B.libCat) || c === B.libCat;
      return '<button type="button" class="rchip' + (on ? ' is-on' : '') + '" data-cat="' + esc(c === 'All' ? '' : c) + '">' + esc(c) + '</button>';
    }).join('');

    var shown = all.filter(function (r) {
      return (!B.libCat || r.category === B.libCat) && (!q || (r.name + ' ' + r.description + ' ' + r.category).toLowerCase().indexOf(q) !== -1);
    });
    if (!shown.length) { el('lib-list').innerHTML = '<div class="rcard rpad"><div class="rempty"><b>No reports match</b><p>Try a different word, or build your own in the <a data-goto="builder">report builder</a>.</p></div></div>'; return; }
    el('lib-list').innerHTML = (B.libCat ? [B.libCat] : cats).map(function (cat) {
      var rows = shown.filter(function (r) { return r.category === cat; });
      if (!rows.length) return '';
      return '<h3 class="rcat">' + esc(cat) + '</h3><div class="rcards">' + rows.map(function (r) {
        var ds = S.meta.datasets.filter(function (d) { return d.key === r.dataset; })[0];
        return '<button type="button" class="rrep" data-lib="' + esc(r.code) + '"><b>' + esc(r.name) + '</b><p>' + esc(r.description) + '</p><div class="foot"><span class="pill">' + esc(ds ? ds.label : r.dataset) + '</span></div></button>';
      }).join('') + '</div>';
    }).join('');
  }

  function wireLibrary() {
    el('lib-q').addEventListener('input', function () { B.libQuery = el('lib-q').value; renderLibrary(); });
    el('tab-library').addEventListener('click', async function (event) {
      var cat = event.target.closest('[data-cat]');
      if (cat) { B.libCat = cat.getAttribute('data-cat'); renderLibrary(); return; }
      var del = event.target.closest('[data-del-saved]');
      if (del) {
        event.stopPropagation();
        if (!window.confirm('Delete this saved report? This cannot be undone.')) return;
        try { await api.request('/reports/saved/' + del.getAttribute('data-del-saved'), { method: 'DELETE' }); await R.reloadMeta(); R.toast('Report deleted'); } catch (err) { R.toast(err.message || 'Could not delete it', 'error'); }
        return;
      }
      var lib = event.target.closest('[data-lib]');
      if (lib) {
        var entry = S.meta.library.filter(function (r) { return r.code === lib.getAttribute('data-lib'); })[0];
        if (entry) openInBuilder(entry.dataset, entry.definition, entry.name, null);
        return;
      }
      var saved = event.target.closest('[data-saved]');
      if (saved) {
        var s = S.meta.saved.filter(function (r) { return r.id === saved.getAttribute('data-saved'); })[0];
        if (s) openInBuilder(s.dataset, s.definition, s.name, s.mine || S.isHr ? s.id : null);
      }
    });
    el('tab-library').addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && event.target.matches('[data-saved]')) event.target.click();
    });
  }

  /* ===================================================================== builder: state */

  function resetConfig() {
    var ds = B.ds;
    B.mode = 'list';
    B.cols = ds.defaultColumns.slice();
    B.groups = [];
    B.aggs = [{ fn: 'count' }];
    B.filters = [];
    B.sort = ds.defaultSort ? { key: ds.defaultSort.key, dir: ds.defaultSort.dir } : null;
    B.limit = 2000;
    B.result = null;
    B.savedId = null;
    B.savedName = '';
    B.showSave = false;
  }

  function applyDefinition(def) {
    var ds = B.ds;
    B.cols = def.columns && def.columns.length ? def.columns.slice() : ds.defaultColumns.slice();
    var grouped = (def.groupBy && def.groupBy.length) || (def.aggregates && def.aggregates.length);
    B.mode = grouped ? 'summary' : 'list';
    B.groups = (def.groupBy || []).map(function (g) {
      var key = typeof g === 'string' ? g : g.key;
      var c = col(key);
      return { key: key, bucket: c && family(c.type) === 'date' ? (typeof g === 'object' && g.bucket) || 'month' : undefined };
    });
    B.aggs = def.aggregates && def.aggregates.length ? def.aggregates.map(function (a) { return { fn: a.fn, field: a.field }; }) : [{ fn: 'count' }];
    B.filters = (def.filters || []).map(function (f) {
      var c = col(f.field);
      var multi = f.op === 'in' || f.op === 'not_in';
      return { field: f.field, op: f.op, value: multi ? (Array.isArray(f.value) ? f.value.map(String) : String(f.value || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean)) : f.value, value2: f.value2, _c: c };
    });
    B.sort = def.sort && def.sort.key ? { key: def.sort.key, dir: def.sort.dir || 'asc' } : null;
    B.limit = def.limit || 2000;
  }

  async function loadDataset(key, definition) {
    var res = await api.get('/reports/datasets/' + encodeURIComponent(key));
    B.ds = res.dataset;
    resetConfig();
    if (definition) applyDefinition(definition);
    el('b-ds').value = key;
    renderConfig();
    renderResult();
  }

  async function openInBuilder(dsKey, definition, name, savedId) {
    R.setTab('builder');
    el('b-errors').innerHTML = '';
    try {
      await loadDataset(dsKey, definition);
      B.savedId = savedId;
      B.savedName = name || '';
      await run();
    } catch (err) {
      R.toast(err.message || 'Could not open that report', 'error');
    }
  }

  /* ===================================================================== builder: controls */

  function optionList(items, selected, blank) {
    return (blank !== undefined ? '<option value="">' + esc(blank) + '</option>' : '') + items.map(function (i) {
      return '<option value="' + esc(i.value) + '"' + (i.value === selected ? ' selected' : '') + '>' + esc(i.label) + '</option>';
    }).join('');
  }

  function renderColumns() {
    var q = el('b-col-q').value.trim().toLowerCase();
    el('b-cols').innerHTML = B.ds.columns.filter(function (c) { return !q || c.label.toLowerCase().indexOf(q) !== -1; }).map(function (c) {
      return '<label><input type="checkbox" data-col="' + esc(c.key) + '"' + (B.cols.indexOf(c.key) !== -1 ? ' checked' : '') + ' /> ' + esc(c.label) + '<span class="kind">' + esc(({ money: 'amount', hours: 'hours', number: 'number', date: 'date', datetime: 'date & time', bool: 'yes/no', enum: 'choice', text: 'text' })[c.type] || c.type) + '</span></label>';
    }).join('');
  }

  function renderGroups() {
    var groupable = B.ds.columns.filter(function (c) { return c.groupable || family(c.type) === 'date'; }).map(function (c) { return { value: c.key, label: c.label }; });
    el('b-groups').innerHTML = [0, 1].map(function (i) {
      var g = B.groups[i];
      var c = g && col(g.key);
      var bucket = c && family(c.type) === 'date'
        ? '<select data-group-bucket="' + i + '" aria-label="Group dates by">' + optionList(S.meta.ops.buckets.map(function (b) { return { value: b, label: 'by ' + b }; }), g.bucket || 'month') + '</select>' : '';
      return '<div class="rpair"><select data-group="' + i + '" aria-label="' + (i ? 'Then group by' : 'Group by') + '">' + optionList(groupable, g ? g.key : '', i ? 'Then by… (optional)' : 'Group by… (optional)') + '</select>' + bucket + '</div>';
    }).join('');
  }

  function renderAggs() {
    var numeric = B.ds.columns.filter(function (c) { return NUMERIC.indexOf(c.type) !== -1; }).map(function (c) { return { value: c.key, label: c.label }; });
    var every = B.ds.columns.map(function (c) { return { value: c.key, label: c.label }; });
    el('b-aggs').innerHTML = B.aggs.map(function (a, i) {
      var fields = a.fn === 'distinct' ? every : numeric;
      return '<div class="rline"><button type="button" class="rm" data-rm-agg="' + i + '" aria-label="Remove this total">&times;</button><div class="rpair"><select data-agg-fn="' + i + '" aria-label="Calculation">' + optionList(S.meta.ops.aggregates.map(function (x) { return { value: x.value, label: x.value === 'count' ? 'Number of rows' : x.label + ' of…' }; }), a.fn) + '</select>' +
        (a.fn === 'count' ? '' : '<select data-agg-field="' + i + '" aria-label="Column">' + optionList(fields, a.field, 'Choose…') + '</select>') + '</div></div>';
    }).join('');
  }

  function valueInputs(f, c) {
    var fam = family(c.type);
    var op = f.op;
    var v = f.value === undefined || f.value === null ? '' : f.value;
    if (['empty', 'not_empty', 'is_true', 'is_false'].indexOf(op) !== -1) return '';
    if (fam === 'enum') {
      var chosen = Array.isArray(v) ? v : [];
      return '<div class="chk-opts">' + (c.options || []).map(function (o) {
        var value = typeof o === 'object' ? o.value : o;
        var label = typeof o === 'object' ? o.label : R.cap(o);
        return '<label class="rchip"><input type="checkbox" data-f="enum" value="' + esc(value) + '"' + (chosen.indexOf(value) !== -1 ? ' checked' : '') + ' /> ' + esc(label) + '</label>';
      }).join('') + '</div>';
    }
    if (fam === 'text' && op === 'in') {
      if (c.suggest) return '<select multiple data-f="multi" data-values-for="' + esc(c.key) + '" aria-label="Values">' + (Array.isArray(v) ? v : []).map(function (x) { return '<option selected>' + esc(x) + '</option>'; }).join('') + '</select><span class="rhint">Hold Ctrl or Cmd to pick several.</span>';
      return '<input type="text" data-f="value" value="' + esc(Array.isArray(v) ? v.join(', ') : v) + '" placeholder="one, two, three" />';
    }
    if (fam === 'number') {
      return op === 'between'
        ? '<div class="rpair"><input type="number" step="any" data-f="value" value="' + esc(v) + '" placeholder="from" /><input type="number" step="any" data-f="value2" value="' + esc(f.value2 === undefined ? '' : f.value2) + '" placeholder="to" /></div>'
        : '<input type="number" step="any" data-f="value" value="' + esc(v) + '" />';
    }
    if (fam === 'date') {
      if (op === 'last_days' || op === 'next_days') return '<input type="number" min="0" max="3660" step="1" data-f="value" value="' + esc(v) + '" placeholder="number of days" />';
      return op === 'between'
        ? '<div class="rpair"><input type="date" data-f="value" value="' + esc(v) + '" /><input type="date" data-f="value2" value="' + esc(f.value2 === undefined ? '' : f.value2) + '" /></div>'
        : '<input type="date" data-f="value" value="' + esc(v) + '" />';
    }
    return '<input type="text" data-f="value" value="' + esc(v) + '" />';
  }

  function filterLine(f, i) {
    var filterable = B.ds.columns.filter(function (c) { return c.filterable; });
    var c = col(f.field) || filterable[0];
    return '<div class="rline" data-fi="' + i + '"><button type="button" class="rm" data-rm-filter="' + i + '" aria-label="Remove this condition">&times;</button>' +
      '<select data-f="field" aria-label="Column">' + optionList(filterable.map(function (x) { return { value: x.key, label: x.label }; }), c.key) + '</select>' +
      '<select data-f="op" aria-label="Condition">' + optionList(opsFor(c).map(function (op) { return { value: op, label: opLabel(op) }; }), f.op) + '</select>' +
      '<div data-f="inputs">' + valueInputs(f, c) + '</div></div>';
  }

  function renderFilters() {
    el('b-filters').innerHTML = B.filters.length ? B.filters.map(filterLine).join('') : '<span class="rhint">No conditions: every row is included.</span>';
    loadSuggestions();
  }

  /** Fills the pick-lists for text columns with their real values. */
  function loadSuggestions() {
    $$('[data-values-for]', el('b-filters')).forEach(function (select) {
      var key = select.getAttribute('data-values-for');
      var fill = function (values) {
        var chosen = $$('option', select).filter(function (o) { return o.selected; }).map(function (o) { return o.value; });
        select.innerHTML = values.concat(chosen.filter(function (x) { return values.indexOf(x) === -1; })).map(function (x) { return '<option' + (chosen.indexOf(x) !== -1 ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('');
      };
      var cacheKey = B.ds.key + ':' + key;
      if (B.values[cacheKey]) { fill(B.values[cacheKey]); return; }
      api.get('/reports/datasets/' + encodeURIComponent(B.ds.key) + '/values?column=' + encodeURIComponent(key)).then(function (res) { B.values[cacheKey] = res.values; fill(res.values); }).catch(function () { /* the list stays as typed */ });
    });
  }

  function outputKeys() {
    if (B.mode === 'summary') {
      return B.groups.map(function (g) { var c = col(g.key); return { value: g.key, label: c ? c.label : g.key }; })
        .concat(B.aggs.filter(function (a) { return a.fn === 'count' || a.field; }).map(function (a) {
          var c = a.field && col(a.field);
          return { value: aggKey(a), label: a.fn === 'count' ? 'Count' : a.fn + ' ' + (c ? c.label : '') };
        }));
    }
    return B.ds.columns.filter(function (c) { return B.cols.indexOf(c.key) !== -1; }).map(function (c) { return { value: c.key, label: c.label }; });
  }

  function renderSort() {
    var keys = outputKeys();
    if (B.sort && !keys.some(function (k) { return k.value === B.sort.key; })) B.sort = null;
    el('b-sort').innerHTML = optionList(keys, B.sort ? B.sort.key : '', B.mode === 'summary' ? 'Largest first' : 'Default order');
    el('b-dir').value = B.sort ? B.sort.dir : 'asc';
    el('b-limit').value = String(B.limit);
  }

  function renderConfig() {
    el('b-ds-note').textContent = [B.ds.description, B.ds.note].filter(Boolean).join(' ');
    $$('#b-mode button').forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-mode') === B.mode); });
    el('b-list-box').classList.toggle('hidden', B.mode !== 'list');
    el('b-sum-box').classList.toggle('hidden', B.mode !== 'summary');
    renderColumns();
    renderGroups();
    renderAggs();
    renderFilters();
    renderSort();
  }

  function readFilterLine(line) {
    var i = Number(line.getAttribute('data-fi'));
    var f = B.filters[i];
    f.field = $('[data-f="field"]', line).value;
    f.op = $('[data-f="op"]', line).value;
    var c = col(f.field);
    var fam = family(c.type);
    if (fam === 'enum') f.value = $$('[data-f="enum"]', line).filter(function (b) { return b.checked; }).map(function (b) { return b.value; });
    else if ($('[data-f="multi"]', line)) f.value = $$('[data-f="multi"] option', line).filter(function (o) { return o.selected; }).map(function (o) { return o.value; });
    else {
      var a = $('[data-f="value"]', line);
      var b = $('[data-f="value2"]', line);
      f.value = a ? a.value : undefined;
      f.value2 = b ? b.value : undefined;
      if (fam === 'text' && f.op === 'in') f.value = String(f.value || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    }
  }

  /* ===================================================================== builder: running */

  function requestBody() {
    var body = { dataset: B.ds.key, limit: B.limit, filters: B.filters.map(function (f) { return { field: f.field, op: f.op, value: f.value, value2: f.value2 }; }) };
    if (B.mode === 'list') body.columns = B.ds.columns.filter(function (c) { return B.cols.indexOf(c.key) !== -1; }).map(function (c) { return c.key; });
    else {
      body.groupBy = B.groups.map(function (g) { return g.bucket ? { key: g.key, bucket: g.bucket } : g.key; });
      body.aggregates = B.aggs.map(function (a) { return a.fn === 'count' ? { fn: 'count' } : { fn: a.fn, field: a.field }; });
    }
    if (B.sort) body.sort = B.sort;
    return body;
  }

  function showErrors(err) {
    $$('.rline.has-err').forEach(function (n) { n.classList.remove('has-err'); });
    var items = (err.details || []).map(function (d) {
      var m = /^filters\.(\d+)/.exec(d.field || '');
      if (m) { var line = $('[data-fi="' + m[1] + '"]'); if (line) line.classList.add('has-err'); }
      return '<li>' + esc(d.message) + '</li>';
    });
    el('b-errors').innerHTML = '<div class="rbanner bad" role="alert"><b>' + esc(err.message || 'The report could not be run') + '</b>' + (items.length > 1 || (items.length === 1 && (err.details[0].message !== err.message)) ? '<ul>' + items.join('') + '</ul>' : '') + '</div>';
  }

  async function run() {
    if (B.running || !B.ds) return;
    B.running = true;
    el('b-run').disabled = true;
    el('b-run').textContent = 'Running…';
    el('b-errors').innerHTML = '';
    $$('.rline.has-err').forEach(function (n) { n.classList.remove('has-err'); });
    try {
      B.lastBody = requestBody();
      var res = await api.post('/reports/run', B.lastBody);
      B.result = res.result;
      B.visible = 200;
      B.measure = -1;
      renderResult();
    } catch (err) {
      showErrors(err);
    } finally {
      B.running = false;
      el('b-run').disabled = false;
      el('b-run').textContent = 'Run report';
    }
  }

  /* ===================================================================== builder: results */

  function title() {
    if (B.savedName) return B.savedName;
    if (!B.result) return B.ds.label;
    if (B.mode === 'summary' && B.groups.length) return B.ds.label + ' by ' + B.groups.map(function (g) { var c = col(g.key); return c ? c.label.toLowerCase() : g.key; }).join(' and ');
    return B.ds.label;
  }

  // Amounts carry no currency prefix in the table; the note above it says which currency they are in.
  function cellOf(res, c, value) {
    return R.fmt(c.type, value, { options: c.options });
  }

  function tableHtml(res) {
    var cols = res.columns;
    var sortKey = B.sort ? B.sort.key : '';
    var head = cols.map(function (c) {
      var arrow = sortKey === c.key ? (B.sort.dir === 'desc' ? ' ↓' : ' ↑') : '';
      return '<th class="is-sortable ' + (R.isNumeric(c.type) ? 'n' : '') + '" data-sort="' + esc(c.key) + '" title="Sort by this column">' + esc(c.label) + arrow + '</th>';
    }).join('');
    var rows = res.rows.slice(0, B.visible).map(function (row) {
      return '<tr>' + cols.map(function (c, i) {
        var v = row[i];
        return '<td class="' + (R.isNumeric(c.type) ? 'n ' : '') + (v === null ? 'nil' : '') + '">' + esc(cellOf(res, c, v)) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    var hasTotals = cols.some(function (c) { return res.totals && res.totals[c.key] !== undefined; });
    var foot = hasTotals ? '<tfoot><tr>' + cols.map(function (c, i) {
      var t = res.totals[c.key];
      return '<td class="' + (R.isNumeric(c.type) ? 'n' : '') + '">' + (t !== undefined ? esc(cellOf(res, c, t)) : i === 0 ? (B.mode === 'summary' ? 'All rows' : 'Total') : '') + '</td>';
    }).join('') + '</tr></tfoot>' : '';
    var more = res.rows.length > B.visible ? '<div class="rmore no-print"><button type="button" class="btn btn-secondary" data-more>Show ' + Math.min(200, res.rows.length - B.visible) + ' more (' + (res.rows.length - B.visible) + ' hidden)</button></div>' : '';
    return '<div class="rtbl-wrap"><table class="rtbl"><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody>' + foot + '</table></div>' + more;
  }

  /** Which total the chart draws: the one chosen, else the first that is not a plain row count. */
  function chartMeasure(res) {
    var g = B.groups.length;
    var measures = res.columns.slice(g);
    if (B.measure >= 0 && B.measure < measures.length) return g + B.measure;
    var first = measures.findIndex(function (c) { return c.key !== 'count'; });
    return g + (first === -1 ? 0 : first);
  }

  function chartHtml(res) {
    var g = B.groups.length;
    var at = chartMeasure(res);
    var c = res.columns[at];
    if (!c) return '';
    var rows = res.rows.slice(0, 30);
    var max = Math.max.apply(null, rows.map(function (r) { return Number(r[at]) || 0; }).concat([0.0001]));
    return '<div class="rbars">' + rows.map(function (r) {
      var label = res.columns.slice(0, g).map(function (cc, i) { return cellOf(res, cc, r[i]); }).join(' · ') || 'All';
      var value = Number(r[at]) || 0;
      return '<div class="rbar-row"><span class="lbl" title="' + esc(label) + '">' + esc(label) + '</span><span class="track"><i style="width:' + Math.max(1, (value / max) * 100).toFixed(1) + '%"></i></span><span class="val">' + esc(cellOf(res, c, r[at])) + '</span></div>';
    }).join('') + '</div>' + (res.rows.length > 30 ? '<p class="rmuted" style="margin-top:.6rem">Showing the first 30 of ' + res.rows.length + ' groups. The table has them all.</p>' : '') + '<p class="rmuted" style="margin-top:.5rem">Bars show: ' + esc(c.label) + '</p>';
  }

  function saveBox() {
    if (!B.showSave) return '';
    return '<div class="rsave no-print"><div class="rgrid"><div class="rfld"><label for="s-name">Report name</label><input id="s-name" type="text" maxlength="80" value="' + esc(B.savedName || title()) + '" /></div>' +
      '<div class="rfld"><label for="s-desc">Description (optional)</label><input id="s-desc" type="text" maxlength="300" /></div></div>' +
      '<label class="rchip" style="width:fit-content"><input type="checkbox" id="s-share" /> Share with everyone who can use this data</label>' +
      '<div class="ract" style="margin:0"><button type="button" class="btn btn-primary" data-save="' + (B.savedId ? 'update' : 'new') + '">' + (B.savedId ? 'Update saved report' : 'Save report') + '</button>' + (B.savedId ? '<button type="button" class="btn btn-secondary" data-save="new">Save as a new report</button>' : '') + '<button type="button" class="btn btn-ghost" data-save="cancel">Cancel</button></div></div>';
  }

  function renderResult() {
    var host = el('b-result');
    var res = B.result;
    if (!res) {
      host.innerHTML = '<div class="rempty"><b>Build any report</b><p>Pick what to report on, choose the columns or how to group and total them, add conditions, and run it. Start from the <a data-goto="library">report library</a> if you want a head start.</p></div>';
      return;
    }
    var grouped = B.mode === 'summary';
    var count = res.total === res.rows.length ? res.total + ' row' + (res.total === 1 ? '' : 's') : 'First ' + res.rows.length + ' of ' + res.total + ' rows';
    var banners = '';
    if (res.truncated) banners += '<div class="rbanner warn" style="margin-bottom:.8rem">More than ' + R.fmtNumber(res.fetchCap, 0) + ' records matched, so this report only covers the first ' + R.fmtNumber(res.fetchCap, 0) + '. Add a condition (a date range, say) to narrow it.</div>';
    if (res.currencies && res.currencies.length > 1) banners += '<div class="rbanner warn" style="margin-bottom:.8rem">These amounts are in more than one currency (' + esc(res.currencies.join(', ')) + '), so any totals add them together as plain numbers. Add a currency condition for a meaningful total.</div>';
    else if (res.currencies && res.currencies.length === 1) banners += '<p class="rmuted" style="margin:0 0 .6rem">Amounts are in ' + esc(res.currencies[0]) + '.</p>';
    var showChart = grouped && B.view === 'chart' && res.rows.length > 0 && res.columns.length > B.groups.length;

    host.innerHTML = '<div class="rstrip"><h2>' + esc(title()) + '</h2><span class="rmuted">' + esc(count) + ' · ' + esc(R.fmtDateTime(res.generatedAt)) + '</span><span class="grow"></span>' +
      '<span class="no-print" style="display:flex;gap:.4rem;flex-wrap:wrap">' +
      (showChart && res.columns.length - B.groups.length > 1 ? '<select data-measure style="width:auto" aria-label="What the bars show">' + res.columns.slice(B.groups.length).map(function (c, i) { return '<option value="' + i + '"' + (chartMeasure(res) === B.groups.length + i ? ' selected' : '') + '>' + esc(c.label) + '</option>'; }).join('') + '</select>' : '') +
      (grouped ? '<span class="rseg" style="width:9rem"><button type="button" data-view="table" class="' + (showChart ? '' : 'is-active') + '">Table</button><button type="button" data-view="chart" class="' + (showChart ? 'is-active' : '') + '">Chart</button></span>' : '') +
      '<button type="button" class="btn btn-secondary btn-sm" data-act="save">Save report</button><button type="button" class="btn btn-secondary btn-sm" data-act="csv">Download CSV</button><button type="button" class="btn btn-secondary btn-sm" data-act="print">Print</button></span></div>' +
      saveBox() + banners + (res.rows.length ? (showChart ? chartHtml(res) : tableHtml(res)) : '<div class="rempty"><b>Nothing matches</b><p>No rows fit those conditions. Loosen a condition and run it again.</p></div>');
  }

  async function exportCsv() {
    try {
      var body = Object.assign({}, B.lastBody || requestBody(), { limit: 50000, export: true, name: title() });
      var res = (await api.post('/reports/run', body)).result;
      var lines = [res.columns.map(function (c) { return c.label; })];
      res.rows.forEach(function (row) { lines.push(res.columns.map(function (c, i) { return R.csvValue(c.type, row[i], { options: c.options }); })); });
      R.csvFile(R.fileSafe(title()) + '.csv', lines);
      if (res.truncated) R.toast('The file holds the first ' + R.fmtNumber(res.fetchCap, 0) + ' records. Narrow the report for the rest.', 'error');
    } catch (err) {
      R.toast(err.message || 'Could not make the file', 'error');
    }
  }

  async function save(mode) {
    if (mode === 'cancel') { B.showSave = false; renderResult(); return; }
    var name = el('s-name').value.trim();
    if (name.length < 2) { R.toast('Give the report a name', 'error'); return; }
    var body = Object.assign({}, B.lastBody || requestBody(), { name: name, description: el('s-desc').value.trim(), shared: el('s-share').checked });
    delete body.limit;
    body.limit = B.limit;
    try {
      var res = mode === 'update' && B.savedId
        ? await api.request('/reports/saved/' + B.savedId, { method: 'PUT', body: body })
        : await api.post('/reports/saved', body);
      B.savedId = res.report.id;
      B.savedName = res.report.name;
      B.showSave = false;
      await R.reloadMeta();
      renderResult();
      R.toast('Report saved. Find it in the report library.');
    } catch (err) {
      R.toast(err.message || 'Could not save it', 'error');
    }
  }

  /* ===================================================================== builder: wiring */

  function wireBuilder() {
    el('b-ds').addEventListener('change', function () {
      el('b-errors').innerHTML = '';
      loadDataset(el('b-ds').value).catch(function (err) { R.toast(err.message || 'Could not load that data', 'error'); });
    });

    el('b-mode').addEventListener('click', function (event) {
      var btn = event.target.closest('[data-mode]');
      if (!btn) return;
      B.mode = btn.getAttribute('data-mode');
      B.view = 'table';
      B.sort = null;
      renderConfig();
    });

    el('b-col-q').addEventListener('input', renderColumns);
    $('[data-cols="defaults"]').addEventListener('click', function () { B.cols = B.ds.defaultColumns.slice(); renderColumns(); renderSort(); });
    $('[data-cols="all"]').addEventListener('click', function () { B.cols = B.ds.columns.map(function (c) { return c.key; }); renderColumns(); renderSort(); });
    $('[data-cols="none"]').addEventListener('click', function () { B.cols = []; renderColumns(); renderSort(); });
    el('b-cols').addEventListener('change', function (event) {
      var box = event.target.closest('[data-col]');
      if (!box) return;
      var key = box.getAttribute('data-col');
      B.cols = B.cols.filter(function (k) { return k !== key; });
      if (box.checked) B.cols.push(key);
      renderSort();
    });

    el('b-groups').addEventListener('change', function (event) {
      var sel = event.target.closest('[data-group]');
      var bucket = event.target.closest('[data-group-bucket]');
      if (sel) {
        var i = Number(sel.getAttribute('data-group'));
        var next = B.groups.slice();
        if (!sel.value) next.splice(i, 1);
        else {
          var c = col(sel.value);
          next[i] = { key: sel.value, bucket: family(c.type) === 'date' ? 'month' : undefined };
        }
        B.groups = next.filter(Boolean).filter(function (g, idx, a) { return a.findIndex(function (x) { return x.key === g.key; }) === idx; });
      } else if (bucket) {
        B.groups[Number(bucket.getAttribute('data-group-bucket'))].bucket = bucket.value;
      }
      B.sort = null;
      renderGroups();
      renderSort();
    });

    el('b-aggs').addEventListener('change', function (event) {
      var fn = event.target.closest('[data-agg-fn]');
      var field = event.target.closest('[data-agg-field]');
      if (fn) { var i = Number(fn.getAttribute('data-agg-fn')); B.aggs[i] = { fn: fn.value, field: fn.value === 'count' ? undefined : B.aggs[i].field }; renderAggs(); }
      if (field) B.aggs[Number(field.getAttribute('data-agg-field'))].field = field.value;
      B.sort = null;
      renderSort();
    });
    el('b-aggs').addEventListener('click', function (event) {
      var rm = event.target.closest('[data-rm-agg]');
      if (!rm) return;
      B.aggs.splice(Number(rm.getAttribute('data-rm-agg')), 1);
      if (!B.aggs.length) B.aggs.push({ fn: 'count' });
      renderAggs();
      renderSort();
    });
    el('b-add-agg').addEventListener('click', function () {
      if (B.aggs.length >= 6) return;
      var numeric = B.ds.columns.filter(function (c) { return NUMERIC.indexOf(c.type) !== -1; })[0];
      B.aggs.push(numeric ? { fn: 'sum', field: numeric.key } : { fn: 'count' });
      renderAggs();
    });

    el('b-add-filter').addEventListener('click', function () {
      var first = B.ds.columns.filter(function (c) { return c.filterable; })[0];
      if (!first || B.filters.length >= 15) return;
      B.filters.push({ field: first.key, op: opsFor(first)[0], value: '' });
      renderFilters();
    });
    el('b-filters').addEventListener('click', function (event) {
      var rm = event.target.closest('[data-rm-filter]');
      if (rm) { B.filters.splice(Number(rm.getAttribute('data-rm-filter')), 1); renderFilters(); }
    });
    el('b-filters').addEventListener('change', function (event) {
      var line = event.target.closest('[data-fi]');
      if (!line) return;
      var which = event.target.getAttribute('data-f');
      var f = B.filters[Number(line.getAttribute('data-fi'))];
      if (which === 'field') {
        var c = col(event.target.value);
        B.filters[Number(line.getAttribute('data-fi'))] = { field: c.key, op: opsFor(c)[0], value: '' };
        line.outerHTML = filterLine(B.filters[Number(line.getAttribute('data-fi'))], Number(line.getAttribute('data-fi')));
        loadSuggestions();
        return;
      }
      if (which === 'op') {
        var wasMulti = f.op === 'in' || f.op === 'not_in';
        readFilterLine(line);
        var isMulti = f.op === 'in' || f.op === 'not_in';
        if (wasMulti !== isMulti) f.value = isMulti ? [] : '';
        f.value2 = undefined;
        line.outerHTML = filterLine(f, Number(line.getAttribute('data-fi')));
        loadSuggestions();
        return;
      }
      readFilterLine(line);
    });
    el('b-filters').addEventListener('input', function (event) {
      var line = event.target.closest('[data-fi]');
      if (line && event.target.getAttribute('data-f') !== 'op' && event.target.getAttribute('data-f') !== 'field') readFilterLine(line);
    });

    el('b-sort').addEventListener('change', function () { B.sort = el('b-sort').value ? { key: el('b-sort').value, dir: el('b-dir').value } : null; });
    el('b-dir').addEventListener('change', function () { if (B.sort) B.sort.dir = el('b-dir').value; });
    el('b-limit').addEventListener('change', function () { B.limit = Number(el('b-limit').value); });

    el('b-run').addEventListener('click', run);
    el('b-reset').addEventListener('click', function () { resetConfig(); renderConfig(); renderResult(); el('b-errors').innerHTML = ''; });

    el('b-result').addEventListener('change', function (event) {
      var m = event.target.closest('[data-measure]');
      if (m) { B.measure = Number(m.value); renderResult(); }
    });

    el('b-result').addEventListener('click', function (event) {
      var th = event.target.closest('[data-sort]');
      if (th) {
        var key = th.getAttribute('data-sort');
        B.sort = { key: key, dir: B.sort && B.sort.key === key && B.sort.dir === 'asc' ? 'desc' : 'asc' };
        renderSort();
        run();
        return;
      }
      if (event.target.closest('[data-more]')) { B.visible += 200; renderResult(); return; }
      var view = event.target.closest('[data-view]');
      if (view) { B.view = view.getAttribute('data-view'); renderResult(); return; }
      var save_ = event.target.closest('[data-save]');
      if (save_) { save(save_.getAttribute('data-save')); return; }
      var act = event.target.closest('[data-act]');
      if (!act) return;
      if (act.getAttribute('data-act') === 'csv') exportCsv();
      if (act.getAttribute('data-act') === 'print') { R.logUse({ kind: 'builder', dataset: B.ds.key, name: title(), format: 'print', rowCount: B.result ? B.result.total : 0 }); R.printNow(); }
      if (act.getAttribute('data-act') === 'save') { B.showSave = !B.showSave; renderResult(); if (B.showSave) el('s-name').focus(); }
    });
  }

  async function initBuilder() {
    var groups = {};
    S.meta.datasets.forEach(function (d) { (groups[d.group] = groups[d.group] || []).push(d); });
    el('b-ds').innerHTML = Object.keys(groups).map(function (g) {
      return '<optgroup label="' + esc(g) + '">' + groups[g].map(function (d) { return '<option value="' + esc(d.key) + '">' + esc(d.label) + '</option>'; }).join('') + '</optgroup>';
    }).join('');
    wireBuilder();
    try { await loadDataset(S.meta.datasets[0].key); } catch (err) { R.toast(err.message || 'Could not load the builder', 'error'); }
  }

  R.hooks.init_builder = initBuilder;
  R.hooks.init_library = function () { wireLibrary(); renderLibrary(); };
  R.hooks.metaChanged = renderLibrary;
})(window, document);
