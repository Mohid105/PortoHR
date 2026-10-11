'use strict';

/**
 * The report engine. A request names a dataset, the columns to show, filters,
 * optional grouping and totals, and a sort. The engine validates it against
 * the dataset's own column list (so nothing outside the whitelist is ever
 * read), narrows the query in MongoDB where that is safe, and then does the
 * real filtering, grouping and sorting itself on plain values. Filters are
 * always re-checked in memory, so a push-down can only ever make a query
 * cheaper, never change what it returns.
 */

const ApiError = require('../../utils/ApiError');
const env = require('../../config/env');
const zoned = require('../../utils/zoned');
const { ROLES } = require('../../config/roles');

const FETCH_CAP = 50000;
const ROW_LIMIT_DEFAULT = 2000;
const ROW_LIMIT_MAX = 50000;
const MAX_COLUMNS = 40;
const MAX_FILTERS = 15;
const MAX_AGGREGATES = 6;
const BUCKETS = ['day', 'month', 'quarter', 'year'];
const AGGREGATES = ['count', 'sum', 'avg', 'min', 'max', 'distinct'];
const AGG_LABELS = { count: 'Count', sum: 'Total', avg: 'Average', min: 'Lowest', max: 'Highest', distinct: 'Distinct' };

const FAMILY = { text: 'text', enum: 'enum', bool: 'bool', date: 'date', datetime: 'date', number: 'number', money: 'number', hours: 'number', percent: 'number' };
const family = (type) => FAMILY[type] || 'text';

const OPS = {
  text: ['contains', 'equals', 'not_equals', 'starts_with', 'in', 'empty', 'not_empty'],
  enum: ['in', 'not_in', 'empty', 'not_empty'],
  number: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'empty', 'not_empty'],
  date: ['on', 'before', 'after', 'between', 'last_days', 'next_days', 'empty', 'not_empty'],
  bool: ['is_true', 'is_false'],
};
const OP_LABELS = {
  contains: 'contains', equals: 'is', not_equals: 'is not', starts_with: 'starts with', in: 'is any of', not_in: 'is none of',
  eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤', between: 'between',
  on: 'is on', before: 'is before', after: 'is after', last_days: 'in the last … days', next_days: 'in the next … days',
  empty: 'is empty', not_empty: 'is not empty', is_true: 'is yes', is_false: 'is no',
};

const isHr = (user) => Boolean(user && user.role === ROLES.HR_ADMIN);
const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const round2 = (n) => Math.round(n * 100) / 100;
const todayKey = () => zoned.dateKey(new Date(), env.timezone);
const isDayKey = (text) => /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(new Date(`${text}T00:00:00Z`).getTime()) && new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text;

function getPath(obj, path) {
  return String(path).split('.').reduce((node, part) => (node === undefined || node === null ? undefined : node[part]), obj);
}

/** The company-local calendar day of a value, as 'YYYY-MM-DD'. */
function dayKeyOf(col, value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return col.type === 'datetime' ? zoned.dateKey(date, env.timezone) : date.toISOString().slice(0, 10);
}

const isEmpty = (value) => value === null || value === undefined || value === '' || (typeof value === 'number' && Number.isNaN(value));

function listOf(value) {
  const items = Array.isArray(value) ? value : String(value === undefined || value === null ? '' : value).split(',');
  return items.map((item) => String(item).trim()).filter((item) => item !== '');
}

/* --------------------------------------------------------------------- filters */

/** Does one value satisfy one (already validated) filter? */
function testFilter(col, value, filter) {
  const fam = family(col.type);
  const { op } = filter;
  const empty = isEmpty(value);
  if (op === 'empty') return empty;
  if (op === 'not_empty') return !empty;
  if (fam === 'bool') return op === 'is_true' ? value === true : value !== true;
  if (empty) return op === 'not_equals' || op === 'not_in';

  if (fam === 'text') {
    const s = String(value).toLowerCase();
    const v = String(filter.value === undefined || filter.value === null ? '' : filter.value).toLowerCase();
    if (op === 'contains') return s.includes(v);
    if (op === 'equals') return s === v;
    if (op === 'not_equals') return s !== v;
    if (op === 'starts_with') return s.startsWith(v);
    if (op === 'in') return listOf(filter.value).some((item) => item.toLowerCase() === s);
    return true;
  }
  if (fam === 'enum') {
    const hit = listOf(filter.value).indexOf(String(value)) !== -1;
    return op === 'not_in' ? !hit : hit;
  }
  if (fam === 'number') {
    const n = Number(value);
    const a = Number(filter.value);
    const b = Number(filter.value2);
    if (op === 'eq') return n === a;
    if (op === 'ne') return n !== a;
    if (op === 'gt') return n > a;
    if (op === 'gte') return n >= a;
    if (op === 'lt') return n < a;
    if (op === 'lte') return n <= a;
    if (op === 'between') return n >= Math.min(a, b) && n <= Math.max(a, b);
    return true;
  }
  // dates compare as company-local day keys, which sort like the dates they name
  const key = dayKeyOf(col, value);
  if (key === null) return false;
  if (op === 'on') return key === filter.value;
  if (op === 'before') return key < filter.value;
  if (op === 'after') return key > filter.value;
  if (op === 'between') return key >= filter.value && key <= filter.value2;
  const today = todayKey();
  const days = Number(filter.value);
  if (op === 'last_days') return key >= zoned.addDays(today, -days) && key <= today;
  if (op === 'next_days') return key >= today && key <= zoned.addDays(today, days);
  return true;
}

/** A MongoDB clause that returns a superset of what `testFilter` accepts, or null when none is safe. */
function toMongo(col, filter) {
  if (!col.path || col.computed) return null;
  const fam = family(col.type);
  const { op } = filter;
  if (fam === 'text') {
    const rx = (source) => ({ $regex: source, $options: 'i' });
    if (op === 'equals') return rx(`^${escapeRegex(filter.value)}$`);
    if (op === 'contains') return rx(escapeRegex(filter.value));
    if (op === 'starts_with') return rx(`^${escapeRegex(filter.value)}`);
    if (op === 'in') return rx(`^(?:${listOf(filter.value).map(escapeRegex).join('|')})$`);
    return null;
  }
  if (fam === 'enum') return op === 'in' ? { $in: listOf(filter.value) } : null;
  if (fam === 'number') {
    if (op === 'eq') return { $eq: Number(filter.value) };
    if (op === 'gt') return { $gt: Number(filter.value) };
    if (op === 'gte') return { $gte: Number(filter.value) };
    if (op === 'lt') return { $lt: Number(filter.value) };
    if (op === 'lte') return { $lte: Number(filter.value) };
    if (op === 'between') return { $gte: Math.min(Number(filter.value), Number(filter.value2)), $lte: Math.max(Number(filter.value), Number(filter.value2)) };
    return null;
  }
  if (fam === 'date') {
    // Day-only columns are stored at UTC midnight, so the bounds are exact. Timestamps are
    // widened by a day each side; the exact company-timezone check happens in memory.
    const pad = col.type === 'datetime' ? 1 : 0;
    const start = (key) => new Date(`${zoned.addDays(key, -pad)}T00:00:00Z`);
    const after = (key) => new Date(`${zoned.addDays(key, 1 + pad)}T00:00:00Z`);
    const today = todayKey();
    if (op === 'on') return { $gte: start(filter.value), $lt: after(filter.value) };
    if (op === 'before') return { $lt: after(zoned.addDays(filter.value, -1)) };
    if (op === 'after') return { $gte: start(zoned.addDays(filter.value, 1)) };
    if (op === 'between') return { $gte: start(filter.value), $lt: after(filter.value2) };
    if (op === 'last_days') return { $gte: start(zoned.addDays(today, -Number(filter.value))), $lt: after(today) };
    if (op === 'next_days') return { $gte: start(today), $lt: after(zoned.addDays(today, Number(filter.value))) };
  }
  return null;
}

/* ------------------------------------------------------------------ validation */

function describeColumn(col) {
  return {
    key: col.key,
    label: col.label,
    type: col.type,
    groupable: Boolean(col.groupable),
    summable: Boolean(col.summable),
    filterable: col.filterable !== false,
    suggest: Boolean(col.suggest),
    options: col.options || null,
    hint: col.hint || '',
  };
}

function visibleColumns(def, user) {
  return def.columns.filter((col) => !col.hr || isHr(user));
}

function describe(def, user) {
  const columns = visibleColumns(def, user);
  return {
    key: def.key,
    label: def.label,
    group: def.group,
    description: def.description,
    columns: columns.map(describeColumn),
    defaultColumns: def.defaultColumns.filter((key) => columns.some((c) => c.key === key)),
    defaultSort: def.defaultSort || null,
    note: def.note || '',
  };
}

function bad(errors, message) {
  return ApiError.badRequest(message || 'The report definition is not valid', errors);
}

/**
 * Turns a request body into a plan the engine can run, or throws with a
 * message for each thing wrong. Anything not whitelisted by the dataset is refused.
 */
function plan(def, body, user) {
  const request = body || {};
  const errors = [];
  const cols = visibleColumns(def, user);
  const byKey = new Map(cols.map((c) => [c.key, c]));
  const known = (key, where) => {
    const col = byKey.get(key);
    if (!col) errors.push({ field: where, message: `"${key}" is not a column of ${def.label}` });
    return col;
  };

  let columns = Array.isArray(request.columns) ? request.columns.map(String).filter((k) => k) : [];
  if (!columns.length) columns = def.defaultColumns.filter((k) => byKey.has(k));
  columns = columns.filter((k, i) => columns.indexOf(k) === i);
  if (columns.length > MAX_COLUMNS) errors.push({ field: 'columns', message: `Choose at most ${MAX_COLUMNS} columns` });
  columns.forEach((k) => known(k, 'columns'));

  const filters = [];
  const rawFilters = Array.isArray(request.filters) ? request.filters : [];
  if (rawFilters.length > MAX_FILTERS) errors.push({ field: 'filters', message: `Use at most ${MAX_FILTERS} filters` });
  rawFilters.slice(0, MAX_FILTERS).forEach((raw, i) => {
    const where = `filters.${i}`;
    const col = known(String(raw && raw.field), `${where}.field`);
    if (!col) return;
    if (col.filterable === false) { errors.push({ field: `${where}.field`, message: `${col.label} cannot be filtered` }); return; }
    const fam = family(col.type);
    const op = String(raw.op || '');
    if (OPS[fam].indexOf(op) === -1) { errors.push({ field: `${where}.op`, message: `"${OP_LABELS[op] || op}" does not apply to ${col.label}` }); return; }
    const filter = { field: col.key, op };
    const needsValue = ['empty', 'not_empty', 'is_true', 'is_false'].indexOf(op) === -1;
    if (needsValue) {
      if (fam === 'number') {
        filter.value = Number(String(raw.value).replace(/,/g, ''));
        if (!Number.isFinite(filter.value)) { errors.push({ field: `${where}.value`, message: `${col.label}: enter a number` }); return; }
        if (op === 'between') {
          filter.value2 = Number(String(raw.value2).replace(/,/g, ''));
          if (!Number.isFinite(filter.value2)) { errors.push({ field: `${where}.value2`, message: `${col.label}: enter the upper number` }); return; }
        }
      } else if (fam === 'date') {
        if (op === 'last_days' || op === 'next_days') {
          filter.value = Number(raw.value);
          if (!Number.isInteger(filter.value) || filter.value < 0 || filter.value > 3660) { errors.push({ field: `${where}.value`, message: `${col.label}: enter a number of days (0–3660)` }); return; }
        } else {
          filter.value = String(raw.value || '').slice(0, 10);
          if (!isDayKey(filter.value)) { errors.push({ field: `${where}.value`, message: `${col.label}: choose a date` }); return; }
          if (op === 'between') {
            filter.value2 = String(raw.value2 || '').slice(0, 10);
            if (!isDayKey(filter.value2)) { errors.push({ field: `${where}.value2`, message: `${col.label}: choose the end date` }); return; }
          }
        }
      } else if (op === 'in' || op === 'not_in') {
        filter.value = listOf(raw.value);
        if (!filter.value.length) { errors.push({ field: `${where}.value`, message: `${col.label}: choose at least one value` }); return; }
      } else {
        filter.value = String(raw.value === undefined || raw.value === null ? '' : raw.value).trim();
        if (filter.value === '') { errors.push({ field: `${where}.value`, message: `${col.label}: enter a value` }); return; }
      }
    }
    filters.push(filter);
  });

  const groupBy = [];
  const rawGroups = Array.isArray(request.groupBy) ? request.groupBy : request.groupBy ? [request.groupBy] : [];
  if (rawGroups.length > 2) errors.push({ field: 'groupBy', message: 'Group by at most two columns' });
  rawGroups.slice(0, 2).forEach((raw, i) => {
    const key = typeof raw === 'object' && raw ? String(raw.key) : String(raw);
    const col = known(key, `groupBy.${i}`);
    if (!col) return;
    if (!col.groupable && family(col.type) !== 'date') { errors.push({ field: `groupBy.${i}`, message: `${col.label} cannot be used to group` }); return; }
    const item = { key: col.key };
    if (family(col.type) === 'date') {
      const bucket = (typeof raw === 'object' && raw && raw.bucket) || 'month';
      if (BUCKETS.indexOf(bucket) === -1) { errors.push({ field: `groupBy.${i}`, message: `Group dates by ${BUCKETS.join(', ')}` }); return; }
      item.bucket = bucket;
    }
    if (groupBy.some((g) => g.key === item.key)) return;
    groupBy.push(item);
  });

  const aggregates = [];
  const rawAggs = Array.isArray(request.aggregates) ? request.aggregates : [];
  if (rawAggs.length > MAX_AGGREGATES) errors.push({ field: 'aggregates', message: `Use at most ${MAX_AGGREGATES} totals` });
  rawAggs.slice(0, MAX_AGGREGATES).forEach((raw, i) => {
    const fn = String(raw && raw.fn);
    if (AGGREGATES.indexOf(fn) === -1) { errors.push({ field: `aggregates.${i}.fn`, message: `Total must be one of ${AGGREGATES.join(', ')}` }); return; }
    if (fn === 'count') { if (!aggregates.some((a) => a.fn === 'count')) aggregates.push({ fn }); return; }
    const col = known(String(raw.field), `aggregates.${i}.field`);
    if (!col) return;
    if (fn !== 'distinct' && family(col.type) !== 'number') { errors.push({ field: `aggregates.${i}.field`, message: `${AGG_LABELS[fn]} needs a numeric column, and ${col.label} is not one` }); return; }
    if (!aggregates.some((a) => a.fn === fn && a.field === col.key)) aggregates.push({ fn, field: col.key });
  });
  const grouped = groupBy.length > 0 || aggregates.length > 0;
  if (groupBy.length && !aggregates.length) aggregates.push({ fn: 'count' });

  const limit = Math.min(ROW_LIMIT_MAX, Math.max(1, Math.floor(Number(request.limit)) || ROW_LIMIT_DEFAULT));

  // Output columns: either the chosen columns, or the group keys followed by the totals.
  const output = grouped
    ? groupBy.map((g) => ({ key: g.key, source: g.key, bucket: g.bucket }))
        .concat(aggregates.map((a) => ({ key: a.fn === 'count' ? 'count' : `${a.fn}_${a.field}`, aggregate: a })))
    : columns.map((key) => ({ key, source: key }));

  let sort = null;
  if (request.sort && request.sort.key) {
    const key = String(request.sort.key);
    if (!output.some((o) => o.key === key)) errors.push({ field: 'sort.key', message: 'Sort by one of the columns shown' });
    else sort = { key, dir: request.sort.dir === 'desc' ? 'desc' : 'asc' };
  } else if (!grouped && def.defaultSort && output.some((o) => o.key === def.defaultSort.key)) {
    sort = { key: def.defaultSort.key, dir: def.defaultSort.dir === 'desc' ? 'desc' : 'asc' };
  }

  if (errors.length) throw bad(errors, errors.length === 1 ? errors[0].message : `${errors.length} things need fixing in this report`);
  if (!output.length) throw bad([{ field: 'columns', message: 'Choose at least one column' }], 'Choose at least one column');

  return { columns, filters, groupBy, aggregates, grouped, output, sort, limit };
}

/* ------------------------------------------------------------- processing rows */

function bucketOf(key, bucket) {
  if (bucket === 'day') return key;
  if (bucket === 'month') return key.slice(0, 7);
  if (bucket === 'year') return key.slice(0, 4);
  return `${key.slice(0, 4)}-Q${Math.floor((Number(key.slice(5, 7)) - 1) / 3) + 1}`;
}

function groupLabel(col, value, bucket) {
  if (family(col.type) === 'date') {
    const key = dayKeyOf(col, value);
    return key ? bucketOf(key, bucket) : NONE;
  }
  if (isEmpty(value)) return NONE;
  if (family(col.type) === 'bool') return value === true ? 'Yes' : 'No';
  if (col.options) {
    const hit = col.options.find((o) => (typeof o === 'object' ? o.value : o) === value);
    if (hit && typeof hit === 'object') return hit.label;
  }
  return String(value);
}

function accumulator(aggregates) {
  return aggregates.map((a) => ({ a, count: 0, sum: 0, n: 0, min: null, max: null, seen: a.fn === 'distinct' ? new Set() : null }));
}
function accumulate(accs, rec) {
  accs.forEach((acc) => {
    acc.count += 1;
    if (acc.a.fn === 'count') return;
    const value = rec[acc.a.field];
    if (isEmpty(value)) return;
    if (acc.a.fn === 'distinct') { acc.seen.add(String(value)); return; }
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    acc.sum += n; acc.n += 1;
    acc.min = acc.min === null ? n : Math.min(acc.min, n);
    acc.max = acc.max === null ? n : Math.max(acc.max, n);
  });
}
function finish(acc) {
  switch (acc.a.fn) {
    case 'count': return acc.count;
    case 'distinct': return acc.seen.size;
    case 'sum': return round2(acc.sum);
    case 'avg': return acc.n ? round2(acc.sum / acc.n) : null;
    case 'min': return acc.min === null ? null : round2(acc.min);
    default: return acc.max === null ? null : round2(acc.max);
  }
}

const NONE = '(none)';

function compare(a, b, dir) {
  const sign = dir === 'desc' ? -1 : 1;
  // the "(none)" bucket of a grouping is a blank like any other, so it sorts last
  const an = isEmpty(a) || a === NONE;
  const bn = isEmpty(b) || b === NONE;
  if (an || bn) return an && bn ? 0 : an ? 1 : -1; // blanks always last
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * sign;
  if (a instanceof Date && b instanceof Date) return (a - b) * sign;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }) * sign;
}

/** One value as it leaves the engine: day keys, ISO timestamps, rounded numbers. */
function serialise(col, value) {
  if (isEmpty(value)) return null;
  const fam = family(col.type);
  if (fam === 'date') return col.type === 'datetime' ? (value instanceof Date ? value : new Date(value)).toISOString() : dayKeyOf(col, value);
  if (fam === 'number') { const n = Number(value); return Number.isFinite(n) ? round2(n) : null; }
  if (fam === 'bool') return value === true;
  return String(value);
}

/**
 * Filters, groups, sorts and trims records. `records` are plain objects
 * holding the value of every column the plan refers to.
 */
function process(def, query, records, user) {
  const cols = new Map(visibleColumns(def, user).map((c) => [c.key, c]));
  const kept = records.filter((rec) => query.filters.every((f) => testFilter(cols.get(f.field), rec[f.field], f)));
  let outputColumns;
  let rows;
  let totals = {};

  if (query.grouped) {
    const groups = new Map();
    kept.forEach((rec) => {
      const labels = query.groupBy.map((g) => groupLabel(cols.get(g.key), rec[g.key], g.bucket));
      const id = labels.join('\u0000');
      if (!groups.has(id)) groups.set(id, { labels, accs: accumulator(query.aggregates) });
      accumulate(groups.get(id).accs, rec);
    });
    outputColumns = query.output.map((o) => {
      if (o.aggregate) {
        const a = o.aggregate;
        const source = a.field ? cols.get(a.field) : null;
        const type = a.fn === 'count' || a.fn === 'distinct' ? 'number' : source.type === 'number' ? 'number' : source.type;
        return { key: o.key, label: a.fn === 'count' ? 'Count' : `${AGG_LABELS[a.fn]} ${source.label}`, type: type === 'datetime' ? 'number' : type };
      }
      const source = cols.get(o.source);
      return { key: o.key, label: o.bucket ? `${source.label} (by ${o.bucket})` : source.label, type: o.bucket || family(source.type) === 'bool' ? 'text' : source.type, options: source.options || null };
    });
    rows = [...groups.values()].map((g) => g.labels.concat(g.accs.map(finish)));
    const overall = accumulator(query.aggregates);
    kept.forEach((rec) => accumulate(overall, rec));
    query.output.filter((o) => o.aggregate).forEach((o, i) => { totals[o.key] = finish(overall[i]); });
    if (!query.sort) {
      const firstDate = query.groupBy.length && family(cols.get(query.groupBy[0].key).type) === 'date';
      const aggAt = query.groupBy.length;
      rows.sort((a, b) => (firstDate ? compare(a[0], b[0], 'asc') : compare(a[aggAt], b[aggAt], 'desc') || compare(a[0], b[0], 'asc')));
    }
  } else {
    outputColumns = query.output.map((o) => {
      const c = cols.get(o.source);
      return { key: o.key, label: c.label, type: c.type, options: c.options || null };
    });
    rows = kept.map((rec) => query.output.map((o) => {
      const c = cols.get(o.source);
      return serialise(c, rec[o.source]);
    }));
    query.output.forEach((o) => {
      const c = cols.get(o.source);
      if (c.summable) totals[o.key] = round2(kept.reduce((sum, rec) => sum + (Number(rec[o.source]) || 0), 0));
    });
  }

  if (query.sort) {
    const at = query.output.findIndex((o) => o.key === query.sort.key);
    rows.sort((a, b) => compare(a[at], b[at], query.sort.dir));
  }

  return { columns: outputColumns, rows: rows.slice(0, query.limit), total: rows.length, totals, sourceRows: kept.length, kept };
}

/* ----------------------------------------------------------------- the runner */

function recordOf(def, query, doc, needed) {
  const rec = {};
  needed.forEach((col) => {
    rec[col.key] = typeof col.get === 'function' ? col.get(doc) : getPath(doc, col.path);
  });
  return rec;
}

/**
 * Runs a report for `user`. `scopeIds` is who the caller may see: null for
 * everyone (HR), otherwise a list of employee ids.
 */
async function run(def, body, user, scopeIds) {
  if (def.access === 'hr' && !isHr(user)) throw ApiError.forbidden('This dataset is for HR only');
  const query = plan(def, body, user);
  const cols = new Map(visibleColumns(def, user).map((c) => [c.key, c]));

  const and = [def.scope(scopeIds, user) || {}];
  const employeeClauses = [];
  query.filters.forEach((f) => {
    const col = cols.get(f.field);
    const clause = toMongo(col, f);
    if (!clause) return;
    if (col.via === 'employee') employeeClauses.push({ [col.path]: clause });
    else if (!col.via) and.push({ [col.path]: clause });
  });

  if (employeeClauses.length) {
    const Employee = require('../../models/Employee');
    const ids = await Employee.find({ $and: employeeClauses }).select('_id').lean();
    if (!ids.length) return emptyResult(def, query, user);
    and.push({ [def.employeeField || 'employee']: { $in: ids.map((row) => row._id) } });
  }

  const needed = new Map();
  const need = (key) => { if (key && cols.has(key)) needed.set(key, cols.get(key)); };
  query.output.forEach((o) => { if (o.source) need(o.source); if (o.aggregate && o.aggregate.field) need(o.aggregate.field); });
  query.filters.forEach((f) => need(f.field));
  query.groupBy.forEach((g) => need(g.key));
  const neededCols = [...needed.values()];

  const Model = def.model();
  let find = Model.find({ $and: and });
  (def.populate || []).forEach((p) => { find = find.populate(p); });
  const docs = await find.limit(FETCH_CAP + 1).lean();
  const truncated = docs.length > FETCH_CAP;
  const records = docs.slice(0, FETCH_CAP).map((doc, i) => Object.assign(recordOf(def, query, doc, neededCols), { __i: i }));

  const result = process(def, query, records, user);
  // Currency only matters when the report shows an amount.
  const showsMoney = result.columns.some((c) => c.type === 'money');
  const currencies = def.currencyOf && showsMoney ? [...new Set(result.kept.map((rec) => def.currencyOf(docs[rec.__i])).filter(Boolean))] : [];
  delete result.kept;
  return Object.assign(result, {
    dataset: { key: def.key, label: def.label },
    truncated,
    fetchCap: FETCH_CAP,
    currencies,
    timezone: env.timezone,
    generatedAt: new Date().toISOString(),
    plan: { columns: query.columns, filters: query.filters, groupBy: query.groupBy, aggregates: query.aggregates, sort: query.sort },
  });
}

function emptyResult(def, query, user) {
  const result = process(def, query, [], user);
  delete result.kept;
  return Object.assign(result, { dataset: { key: def.key, label: def.label }, truncated: false, fetchCap: FETCH_CAP, currencies: [], timezone: env.timezone, generatedAt: new Date().toISOString(), plan: { columns: query.columns, filters: query.filters, groupBy: query.groupBy, aggregates: query.aggregates, sort: query.sort } });
}

/** Distinct values of a column, for filter pickers. Capped, and scoped like a report. */
async function distinct(def, key, user, scopeIds) {
  if (def.access === 'hr' && !isHr(user)) throw ApiError.forbidden('This dataset is for HR only');
  const col = visibleColumns(def, user).find((c) => c.key === key);
  if (!col || !col.path || col.computed) return [];
  if (col.via === 'employee') {
    const Employee = require('../../models/Employee');
    const values = await Employee.distinct(col.path, scopeIds ? { _id: { $in: scopeIds } } : {});
    return values.filter((v) => !isEmpty(v)).map(String).sort().slice(0, 200);
  }
  const values = await def.model().distinct(col.path, def.scope(scopeIds, user) || {});
  return values.filter((v) => !isEmpty(v)).map(String).sort().slice(0, 200);
}

module.exports = { FETCH_CAP, OPS, OP_LABELS, AGGREGATES, AGG_LABELS, BUCKETS, family, getPath, dayKeyOf, testFilter, toMongo, describe, visibleColumns, plan, process, run, distinct, isHr };
