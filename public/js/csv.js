/* A small RFC 4180 CSV reader/writer shared by the import screens. */
(function (window) {
  'use strict';

  /** Rows as objects keyed by the header line. Quoted fields, doubled quotes, embedded newlines; comma, semicolon or tab. */
  function parse(text) {
    text = String(text || '').replace(/^﻿/, '');
    var firstLine = text.split(/\r?\n/)[0] || '';
    var delimiter = [',', ';', '\t'].reduce(function (best, d) {
      return firstLine.split(d).length > firstLine.split(best).length ? d : best;
    }, ',');
    var rows = [];
    var row = [];
    var field = '';
    var quoted = false;
    var blank = function (cells) { return !cells.some(function (c) { return String(c).trim() !== ''; }); };
    for (var i = 0; i < text.length; i += 1) {
      var ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
        } else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delimiter) { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i += 1;
        row.push(field); field = '';
        if (!blank(row)) rows.push(row);
        row = [];
      } else field += ch;
    }
    row.push(field);
    if (!blank(row)) rows.push(row);
    if (rows.length < 2) return [];
    var header = rows[0].map(function (h) { return h.trim(); });
    return rows.slice(1).map(function (cells) {
      var obj = {};
      header.forEach(function (name, idx) { if (name) obj[name] = cells[idx] === undefined ? '' : cells[idx]; });
      return obj;
    });
  }

  /** One field, quoted if needed, and defanged against spreadsheet formula injection. */
  function cell(value) {
    var text = String(value === null || value === undefined ? '' : value);
    if (/^[=+\-@\t\r]/.test(text) && isNaN(Number(text))) text = "'" + text;
    return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function download(filename, header, rows) {
    var lines = [header.map(cell).join(',')].concat(rows.map(function (r) { return r.map(cell).join(','); }));
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  window.PortoHR = window.PortoHR || {};
  window.PortoHR.csv = { parse: parse, cell: cell, download: download };
})(window);
