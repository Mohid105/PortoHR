'use strict';

/** A thin layer over PDFKit: A4 pages, key/value blocks, and tables that break across pages. */

const PDFDocument = require('pdfkit');
const env = require('../../config/env');

const COLORS = { ink: '#15212b', muted: '#5b6672', line: '#b9c0c7', head: '#e8edf0', band: '#f5f7f8', accent: '#0e6379' };
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** 02-JAN-25, from a date or a 'YYYY-MM-DD' key. */
function day(value) {
  if (!value) return '';
  const k = typeof value === 'string' ? value.slice(0, 10) : new Date(value).toISOString().slice(0, 10);
  return `${k.slice(8, 10)}-${MON[Number(k.slice(5, 7)) - 1]}-${k.slice(2, 4)}`;
}
const monthLabel = (key) => `${MON[Number(key.slice(5, 7)) - 1]}-${key.slice(0, 4)}`;
const money = (n) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
const hhmm = (hours) => { const m = Math.round((Number(hours) || 0) * 60); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const printedAt = () => new Intl.DateTimeFormat('en-GB', { timeZone: env.timezone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());

function create({ landscape = false, title = 'Report' } = {}) {
  return new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: 36, bufferPages: true, info: { Title: title, Author: 'PortoHR' } });
}

const usable = (doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right;
const bottom = (doc) => doc.page.height - doc.page.margins.bottom;

function title(doc, text, sub) {
  doc.font('Helvetica-Bold').fontSize(15).fillColor(COLORS.ink).text(text, { align: 'center' });
  if (sub) doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text(sub, { align: 'center' });
  doc.moveDown(0.3);
}

function printedLine(doc, left) {
  const y = doc.y;
  doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.ink).text(left || '', doc.page.margins.left, y, { width: usable(doc) * 0.55, lineBreak: false });
  doc.text(printedAt(), doc.page.margins.left + usable(doc) * 0.45, y, { width: usable(doc) * 0.55, align: 'right', lineBreak: false });
  doc.y = y + 14;
  doc.x = doc.page.margins.left;
}

/** Labelled pairs in `columns` columns. */
function pairs(doc, list, { columns = 2, labelWidth = 92, size = 9, rows: fixedRows } = {}) {
  const colW = usable(doc) / columns;
  const rows = fixedRows || Math.ceil(list.length / columns);
  const top = doc.y;
  let maxY = top;
  list.forEach(([label, value], i) => {
    const col = Math.floor(i / rows);
    const row = i % rows;
    const x = doc.page.margins.left + col * colW;
    const y = top + row * (size + 7);
    doc.font('Helvetica-Bold').fontSize(size).fillColor(COLORS.ink).text(`${label}:`, x, y, { width: labelWidth, lineBreak: false });
    doc.font('Helvetica').text(String(value === null || value === undefined ? '' : value), x + labelWidth, y, { width: colW - labelWidth - 6, lineBreak: false, ellipsis: true });
    maxY = Math.max(maxY, y + size + 7);
  });
  doc.x = doc.page.margins.left;
  doc.y = maxY + 4;
}

/**
 * Columns are { label, key | get(row), w (relative width), align }. Rows break across pages, and the
 * header is repeated on each new page.
 */
function table(doc, columns, rows, { size = 8, headSize, rowPad = 3, padX = 3, zebra = false, footerRow = null } = {}) {
  const total = columns.reduce((s, c) => s + (c.w || 1), 0);
  const widths = columns.map((c) => ((c.w || 1) / total) * usable(doc));
  const hs = headSize || size;
  const cell = (c, row) => String(typeof c.get === 'function' ? c.get(row) : row[c.key] === undefined || row[c.key] === null ? '' : row[c.key]);

  const drawHead = () => {
    doc.font('Helvetica-Bold').fontSize(hs);
    const h = Math.max(...columns.map((c, i) => doc.heightOfString(c.label, { width: widths[i] - padX * 2 }))) + rowPad * 2;
    let x = doc.page.margins.left;
    const y = doc.y;
    doc.save().rect(x, y, usable(doc), h).fill(COLORS.head).restore();
    columns.forEach((c, i) => { doc.fillColor(COLORS.ink).text(c.label, x + padX, y + rowPad, { width: widths[i] - padX * 2, align: c.align || 'left' }); x += widths[i]; });
    doc.save().moveTo(doc.page.margins.left, y + h).lineTo(doc.page.margins.left + usable(doc), y + h).strokeColor(COLORS.line).lineWidth(0.6).stroke().restore();
    doc.y = y + h;
  };

  const drawRow = (row, i, bold) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
    const h = Math.max(...columns.map((c, k) => doc.heightOfString(cell(c, row) || ' ', { width: widths[k] - padX * 2 }))) + rowPad * 2;
    if (doc.y + h > bottom(doc)) { doc.addPage(); drawHead(); doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size); }
    const y = doc.y;
    if (zebra && i % 2) doc.save().rect(doc.page.margins.left, y, usable(doc), h).fill(COLORS.band).restore();
    let x = doc.page.margins.left;
    columns.forEach((c, k) => { doc.fillColor(COLORS.ink).text(cell(c, row), x + padX, y + rowPad, { width: widths[k] - padX * 2, align: c.align || 'left' }); x += widths[k]; });
    doc.save().moveTo(doc.page.margins.left, y + h).lineTo(doc.page.margins.left + usable(doc), y + h).strokeColor('#dde2e6').lineWidth(0.4).stroke().restore();
    doc.y = y + h;
  };

  if (doc.y + 40 > bottom(doc)) doc.addPage();
  drawHead();
  rows.forEach((row, i) => drawRow(row, i, false));
  if (footerRow) drawRow(footerRow, 0, true);
  doc.x = doc.page.margins.left;
}

function bar(doc, text) {
  const y = doc.y;
  doc.save().rect(doc.page.margins.left, y, usable(doc), 14).fill(COLORS.head).restore();
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.ink).text(text, doc.page.margins.left, y + 3, { width: usable(doc), align: 'center' });
  doc.y = y + 18;
  doc.x = doc.page.margins.left;
}

/** "Page x of y" and a small footer on every page. Call once, after all content. */
function finish(doc, footer) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const keep = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted);
    doc.text(footer || 'Generated by PortoHR', doc.page.margins.left, doc.page.height - 26, { width: usable(doc) / 2, lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, doc.page.margins.left + usable(doc) / 2, doc.page.height - 26, { width: usable(doc) / 2, align: 'right', lineBreak: false });
    doc.page.margins.bottom = keep;
  }
  doc.end();
}

module.exports = { COLORS, day, monthLabel, money, hhmm, printedAt, create, title, printedLine, pairs, table, bar, finish, usable, bottom };
