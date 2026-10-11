'use strict';

/**
 * The four per-employee printouts HR hands out: the leave record, the final settlement bill, the monthly
 * salary sheet and the individual time sheet. Each is built from live data and returned as a PDF stream.
 */

const Employee = require('../models/Employee');
const Person = require('../models/Person');
const LeaveRequest = require('../models/LeaveRequest');
const Attendance = require('../models/Attendance');
const Payslip = require('../models/Payslip');
const User = require('../models/User');
const FinalSettlement = require('../models/FinalSettlement');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');
const zoned = require('../utils/zoned');
const leaveService = require('./leave.service');
const settlementService = require('./settlement.service');
const { buildMonth, monthRange } = require('./attendance.service');
const { LEAVE_TYPES } = require('../config/leave');
const { WEEKDAY_LABELS } = require('../config/hr');
const pdf = require('./pdf/pdfKit');

const LEAVE_LABEL = Object.fromEntries((LEAVE_TYPES || []).map((t) => [t.code, t.label]));
const isDay = (k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && !Number.isNaN(new Date(`${k}T00:00:00Z`).getTime()) && new Date(`${k}T00:00:00Z`).toISOString().slice(0, 10) === k;
const isMonth = (k) => /^\d{4}-\d{2}$/.test(k) && Number(k.slice(5)) >= 1 && Number(k.slice(5)) <= 12;
const nameOf = (e) => [e.firstName, e.lastName].filter(Boolean).join(' ');
const sectionOf = (e) => [e.department, e.team].filter(Boolean).join(' - ');
const dateKey = (d) => new Date(d).toISOString().slice(0, 10);
const todayKey = () => zoned.dateKey(new Date(), env.timezone);

function dayRange(query) {
  const year = todayKey().slice(0, 4);
  const from = String(query.from || `${year}-01-01`).slice(0, 10);
  const to = String(query.to || `${year}-12-31`).slice(0, 10);
  if (!isDay(from) || !isDay(to)) throw ApiError.badRequest('Choose a valid period');
  if (from > to) throw ApiError.badRequest('The period starts after it ends');
  if ((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000 > 366 * 3) throw ApiError.badRequest('Choose a period of at most three years');
  return { from, to };
}

function monthsIn(query) {
  const now = todayKey().slice(0, 7);
  const from = String(query.from || query.month || now).slice(0, 7);
  const to = String(query.to || query.month || from).slice(0, 7);
  if (!isMonth(from) || !isMonth(to)) throw ApiError.badRequest('Choose a valid month');
  if (from > to) throw ApiError.badRequest('The period starts after it ends');
  const list = [];
  for (let k = from; k <= to && list.length < 13; ) {
    list.push(k);
    const d = new Date(Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5)), 1));
    k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  if (list.length > 12) throw ApiError.badRequest('Choose at most twelve months');
  return list;
}

function employeeBlock(doc, employee, extra) {
  pdf.pairs(doc, [
    ['Employee Number', employee.employeeCode], ['Employee Name', nameOf(employee)], ['Date of Joining', pdf.day(employee.dateOfJoining)],
    ['Quit Date', ['resigned', 'terminated'].includes(employee.employmentStatus) ? pdf.day(employee.lastWorkingDay) : ''],
    ['Position Title', employee.designation], ['Department', employee.department], ['Section', sectionOf(employee)], ...(extra || []),
  ], { columns: 2, labelWidth: 95, rows: 4 });
}

/* ---------------------------------------------------------------- leave record */

async function leaveRecord(employee, query) {
  const { from, to } = dayRange(query);
  const [leaves, absences] = await Promise.all([
    LeaveRequest.find({ employee: employee._id, status: 'approved', fromDate: { $lte: new Date(`${to}T00:00:00Z`) }, toDate: { $gte: new Date(`${from}T00:00:00Z`) } }).lean(),
    Attendance.find({ employee: employee._id, shiftStatus: 'absent', date: { $gte: new Date(`${from}T00:00:00Z`), $lte: new Date(`${to}T00:00:00Z`) } }).select('date').lean(),
  ]);
  const deciders = await User.find({ _id: { $in: leaves.map((l) => l.decidedBy).filter(Boolean) } }).select('firstName lastName').lean();
  const who = Object.fromEntries(deciders.map((u) => [String(u._id), nameOf(u)]));
  const rows = leaves.map((l) => ({ type: LEAVE_LABEL[l.leaveType] || l.leaveType, days: l.days, from: dateKey(l.fromDate), to: dateKey(l.toDate), authority: who[String(l.decidedBy)] || '' }))
    .concat(absences.map((a) => ({ type: 'Absence', days: 1, from: dateKey(a.date), to: dateKey(a.date), authority: '' })))
    .sort((a, b) => a.from.localeCompare(b.from))
    .map((r, i) => ({ ...r, sr: i + 1, month: pdf.monthLabel(r.from) }));
  const balances = await leaveService.balancesFor(employee, Number(to.slice(0, 4)));

  const doc = pdf.create({ title: `Leave record ${employee.employeeCode}` });
  pdf.title(doc, "Employee's Leave Record");
  pdf.printedLine(doc, `From: ${pdf.day(from)}  To: ${pdf.day(to)}`);
  employeeBlock(doc, employee);
  doc.moveDown(0.4);
  pdf.table(doc, [
    { label: 'SR #', key: 'sr', w: 0.6 }, { label: 'Leave Type', key: 'type', w: 2.4 }, { label: 'Days', key: 'days', w: 0.7, align: 'right' },
    { label: 'Month', key: 'month', w: 1.1 }, { label: 'From Start', get: (r) => pdf.day(r.from), w: 1.1 }, { label: 'To Date', get: (r) => pdf.day(r.to), w: 1.1 }, { label: 'Authority', key: 'authority', w: 1.6 },
  ], rows, { size: 8.5, zebra: true });
  if (!rows.length) doc.font('Helvetica').fontSize(9).fillColor(pdf.COLORS.muted).text('No leave or absence in this period.');
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(pdf.COLORS.ink).text(`Balances (${to.slice(0, 4)})`);
  doc.moveDown(0.2);
  pdf.table(doc, [{ label: 'Employee Number', get: () => employee.employeeCode, w: 1.4 }].concat(balances.map((b) => ({ label: b.label.replace(/ leave$/i, ''), get: () => b.balanceDays, w: 1, align: 'right' }))), [{}], { size: 9 });
  pdf.finish(doc, `Leave record · ${employee.employeeCode}`);
  return doc;
}

/* ------------------------------------------------------------ final settlement */

async function finalSettlement(employee) {
  const rows = await settlementService.list({ employee: String(employee._id) });
  const s = rows[0];
  if (!s) throw ApiError.notFound('There is no final settlement for this employee yet. Prepare one under Payroll first.');
  const person = employee.person ? await Person.findById(employee.person).lean() : null;
  const sn = s.snapshot || {};
  const d = s.deductions || {};
  const doc = pdf.create({ title: `Final settlement ${s.requestNo}` });
  pdf.title(doc, 'FINAL SETTLEMENT BILL', s.status === 'draft' ? 'DRAFT: not yet approved' : null);
  pdf.pairs(doc, [
    ['Division', sn.team || sn.department], ['Name', sn.fullName], ['Father/Husband Name', (person && person.fatherName) || sn.fatherName], ['CNIC', sn.nationalId],
    ['Employee Code', employee.employeeCode], ['Designation', sn.designation], ['Department', sn.department], ['Quit Reason', sn.quitReason],
    ['Date of Joining', pdf.day(sn.dateOfJoining)], ['Date of Relieving', pdf.day(sn.dateOfRelieving)], ['Total Service', `${sn.serviceYears || 0} Years ${sn.serviceMonths || 0} Months`], ['Address', sn.address],
    ['Rest Day', s.days && s.days.restDay], ['Skip Days', s.days && s.days.skipDays], ['Abs Days', s.days && s.days.absentDays], ['WOP Leaves', s.days && s.days.withoutPayLeaveDays],
    ['Attendance Days', s.days && s.days.attendanceDays], ['Request Id', s.requestNo],
  ], { columns: 2, labelWidth: 105, rows: 12 });
  doc.moveDown(0.5);

  const line = (label, value, strong) => {
    const y = doc.y;
    doc.font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor(pdf.COLORS.ink).text(label, doc.page.margins.left + 8, y, { width: pdf.usable(doc) * 0.65, lineBreak: false });
    doc.text(value === null || value === undefined || value === '' ? '' : pdf.money(value), doc.page.margins.left + pdf.usable(doc) * 0.6, y, { width: pdf.usable(doc) * 0.4 - 8, align: 'right', lineBreak: false });
    doc.y = y + 15;
    doc.x = doc.page.margins.left;
  };
  pdf.bar(doc, 'Salary / Allowances');
  line('Unadjusted Gross Salary', s.unadjustedGross); line('Adjusted Gross Salary', s.adjustedGross); line('Long Service Allowance', s.longServiceAllowance);
  line('Net Salary Payable', s.netSalaryPayable, true);
  doc.moveDown(0.3);
  pdf.bar(doc, 'FINAL SETTLEMENT');
  line(`Leave Encashment (${s.leaveEncashmentDays || 0} days)`, s.leaveEncashment);
  (s.additions || []).forEach((a) => line(a.label, a.amount));
  line('Final Settlement', s.finalSettlement, true);
  doc.moveDown(0.3);
  pdf.bar(doc, 'Deductions');
  line('Long Service Deduction', d.longServiceDeduction);
  line('Deduction of Short Term Salary Loan', d.shortTermLoan);
  line('Excess Paid Salary Recovery', d.excessPaidSalary);
  line(`Excess Availed Leaves for ${d.excessLeaveDays || 0} days`, d.excessLeaveRecovery);
  (d.others || []).forEach((o) => line(o.label, o.amount));
  line('Total Deductions', d.total, true);
  doc.moveDown(0.3);
  line(s.netPayable < 0 ? 'Net Recoverable from Employee' : 'Net Payable', Math.abs(s.netPayable), true);
  if (s.leave && s.leave.length) {
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(9).text('Leave position at relieving');
    doc.moveDown(0.2);
    pdf.table(doc, [{ label: 'Leave type', key: 'label', w: 2 }, { label: 'Accrued', key: 'accruedDays', w: 1, align: 'right' }, { label: 'Taken', key: 'takenDays', w: 1, align: 'right' }, { label: 'Balance', key: 'balanceDays', w: 1, align: 'right' }], s.leave, { size: 8.5 });
  }
  doc.moveDown(2.5);
  const y = doc.y;
  ['Prepared By', 'Audit By', 'Debit Note'].forEach((t, i) => {
    const x = doc.page.margins.left + (pdf.usable(doc) / 3) * i;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(pdf.COLORS.ink).text(t, x, y, { width: pdf.usable(doc) / 3, lineBreak: false });
    if (i === 0 && s.preparedByName) doc.font('Helvetica').fontSize(8).text(s.preparedByName, x, y + 12, { lineBreak: false });
    if (i === 1 && s.approvedByName) doc.font('Helvetica').fontSize(8).text(s.approvedByName, x, y + 12, { lineBreak: false });
  });
  doc.y = y + 30;
  doc.x = doc.page.margins.left;
  doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(pdf.COLORS.muted).text('This is a system generated bill, and does not need signatures.');
  pdf.finish(doc, `Final settlement · ${s.requestNo}`);
  return doc;
}

/* ----------------------------------------------------------------- salary sheet */

async function salarySheet(employee, query, isHr) {
  const months = monthsIn(query);
  const filter = { employee: employee._id, month: { $gte: months[0], $lte: months[months.length - 1] } };
  if (!isHr) filter.status = { $in: ['finalised', 'paid'] };
  const slips = await Payslip.find(filter).sort({ month: 1 }).lean();
  if (!slips.length) throw ApiError.notFound('There is no payslip for this employee in that period.');

  const doc = pdf.create({ landscape: true, title: `Salary sheet ${employee.employeeCode}` });
  slips.forEach((p, i) => {
    if (i) doc.addPage();
    const e = p.earnings || {};
    const d = p.deductions || {};
    const a = p.attendance || {};
    const r = p.rates || {};
    const sn = p.snapshot || {};
    doc.font('Helvetica-Bold').fontSize(12).fillColor(pdf.COLORS.ink).text(`EMPLOYEE'S PAYROLL FOR THE MONTH OF  ${p.month.slice(5)}-${p.month.slice(0, 4)}`, { align: 'center' });
    doc.font('Helvetica').fontSize(8.5).text(`Payroll: ${employee.payGroup === 'monthly_pk' ? 'Monthly (Pakistan)' : 'Monthly'}    Salary Base: Fixed Rate Salary Basis    Currency: ${p.currency}    Status: ${String(p.status).toUpperCase()}`, { align: 'center' });
    doc.moveDown(0.6);
    const row = {
      sr: 1, no: employee.employeeCode, name: nameOf(employee), pos: sn.designation || employee.designation, grade: employee.grade || '', dept: sn.department || employee.department,
      ug: sn.contractedGross, wd: (p.period && p.period.employedWorkingDays) || a.paymentDays, ab: a.absentDays, lv: a.leaveDays, lwp: a.lwpDays, ag: e.adjustedGross !== undefined ? e.adjustedGross : Math.max(0, (Number(e.basic) || 0) + (Number(e.totalAllowances) || 0) - (Number(d.attendanceTotal) || 0)),
      oth: a.overtimeHours, otr: r.overtimeRate, ota: e.overtimePay, ghh: a.gazettedHolidayHours, gha: e.gazettedHolidayPay, tot: (Number(e.overtimePay) || 0) + (Number(e.gazettedHolidayPay) || 0),
      med: e.medicalAllowance, inc: e.incentive, arr: e.otherEarnings, ts: e.gross, loan: d.loanRecovery, pf: d.providentFund, mess: d.messCharges, tax: d.incomeTax, eobi: d.socialSecurity, od: d.otherDeductions, td: d.total, net: p.netPay,
    };
    const m = (k) => (r2) => pdf.money(r2[k] === undefined || r2[k] === null ? 0 : r2[k]);
    pdf.table(doc, [
      { label: 'Sr.', key: 'sr', w: 0.4 }, { label: 'Emp. #', key: 'no', w: 0.9 }, { label: 'Name', key: 'name', w: 1.4 }, { label: 'Position', key: 'pos', w: 1.5 }, { label: 'Grade', key: 'grade', w: 0.7 }, { label: 'Department', key: 'dept', w: 1.4 },
      { label: 'Unadjusted Gross', get: m('ug'), w: 1.1, align: 'right' }, { label: 'Working Days', get: m('wd'), w: 0.8, align: 'right' }, { label: 'Absent Days', get: m('ab'), w: 0.7, align: 'right' }, { label: 'Approved Leaves', get: m('lv'), w: 0.8, align: 'right' }, { label: 'LWP', get: m('lwp'), w: 0.5, align: 'right' },
      { label: 'Adjusted Gross', get: m('ag'), w: 1.1, align: 'right' }, { label: 'OT Hours', get: m('oth'), w: 0.7, align: 'right' }, { label: 'OT Rate', get: m('otr'), w: 0.7, align: 'right' }, { label: 'OT Amount', get: m('ota'), w: 0.9, align: 'right' },
      { label: 'Gaz. H.day Hours', get: m('ghh'), w: 0.8, align: 'right' }, { label: 'Gaz. H.day Amount', get: m('gha'), w: 0.9, align: 'right' }, { label: 'T. Overtime', get: m('tot'), w: 0.9, align: 'right' },
      { label: 'Medical Allowance', get: m('med'), w: 0.8, align: 'right' }, { label: 'Incentive', get: m('inc'), w: 0.8, align: 'right' }, { label: 'Arrears', get: m('arr'), w: 0.7, align: 'right' }, { label: 'Total Salary', get: m('ts'), w: 1.1, align: 'right' },
      { label: 'Loan & Advances', get: m('loan'), w: 0.8, align: 'right' }, { label: 'Provident Fund', get: m('pf'), w: 0.8, align: 'right' }, { label: 'Mess Charges', get: m('mess'), w: 0.7, align: 'right' }, { label: 'Income Tax', get: m('tax'), w: 0.9, align: 'right' },
      { label: 'EOBI', get: m('eobi'), w: 0.7, align: 'right' }, { label: 'Other Deductions', get: m('od'), w: 0.8, align: 'right' }, { label: 'Total Deductions', get: m('td'), w: 1, align: 'right' }, { label: 'Net Payable', get: m('net'), w: 1.1, align: 'right' },
    ], [row], { size: 5.2, headSize: 4.8, rowPad: 3, padX: 1.2 });
    if (p.warnings && p.warnings.length) {
      doc.moveDown(0.8);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(pdf.COLORS.ink).text('Notes on this payslip');
      doc.font('Helvetica').fontSize(7.5).fillColor(pdf.COLORS.muted);
      p.warnings.slice(0, 8).forEach((w) => doc.text(`• ${w}`));
    }
  });
  pdf.finish(doc, `Salary sheet · ${employee.employeeCode}`);
  return doc;
}

/* ------------------------------------------------------------------- time sheet */

async function timeSheet(employee, query) {
  const months = monthsIn(query);
  const doc = pdf.create({ title: `Time sheet ${employee.employeeCode}` });
  const year = Number(months[months.length - 1].slice(0, 4));
  const balances = await leaveService.balancesFor(employee, year);
  const bal = (code) => { const b = balances.find((x) => x.code === code); return b ? b.balanceDays : '-'; };
  const rest = (employee.restDays || []).map((r) => (WEEKDAY_LABELS[r] || r).toUpperCase()).join(', ');
  const clock = (iso) => zoned.clock(new Date(iso), env.timezone);
  const dayOf = (iso) => zoned.dateKey(new Date(iso), env.timezone);

  for (let i = 0; i < months.length; i += 1) {
    const month = months[i];
    if (i) doc.addPage();
    const range = monthRange(month);
    const [records, holidays, slip] = await Promise.all([
      Attendance.find({ employee: employee._id, date: { $gte: range.start, $lt: range.end } }),
      leaveService.holidayKeys(range.start, new Date(range.end.getTime() - 86400000), employee.location),
      Payslip.findOne({ employee: employee._id, month }).select('attendance.paymentDays').lean(),
    ]);
    const { days, summary } = buildMonth(employee, range, records, new Date(), holidays);
    doc.font('Helvetica-Bold').fontSize(14).fillColor(pdf.COLORS.ink).text('Employee Attendance', { align: 'center' });
    doc.font('Helvetica').fontSize(9).fillColor(pdf.COLORS.muted).text(`(Individual) · ${pdf.monthLabel(month)}`, { align: 'center' });
    pdf.printedLine(doc, '');
    pdf.pairs(doc, [['Emp Code', employee.employeeCode], ['Weekly Rest', rest], ['ERP Code', employee.employeeCode], ['Position', employee.designation], ['Name', nameOf(employee)], ['Section', sectionOf(employee)]], { columns: 2, labelWidth: 70 });
    doc.moveDown(0.3);

    const rows = [];
    days.forEach((d) => {
      if (['not_employed', 'upcoming'].includes(d.status)) return;
      const shift = d.shiftLabel ? d.shiftLabel.charAt(0).toUpperCase() : '';
      if (d.timeIn || d.timeOut) {
        if (d.timeIn) rows.push({ shift, status: 'IN', dated: pdf.day(dayOf(d.timeIn)), time: clock(d.timeIn), ot: '' });
        if (d.timeOut) rows.push({ shift, status: 'OUT', dated: pdf.day(dayOf(d.timeOut)), time: clock(d.timeOut), ot: d.overtimeHours > 0 ? pdf.hhmm(d.overtimeHours) : '' });
        else rows.push({ shift: '', status: 'MISSED PUNCH', dated: pdf.day(d.date), time: '', ot: '' });
      } else {
        const label = { rest_day: 'REST DAY', holiday: 'GAZETTED HOLIDAY', absent: 'ABSENT', on_leave: 'ON LEAVE', missing_punch: 'MISSED PUNCH', in_progress: 'IN PROGRESS', present: 'PRESENT', short_day: 'SHORT DAY' }[d.status] || String(d.status).toUpperCase();
        rows.push({ shift: '', status: label, dated: pdf.day(d.date), time: '', ot: '' });
      }
    });
    pdf.table(doc, [{ label: 'Shift', key: 'shift', w: 0.6 }, { label: 'Status', key: 'status', w: 2.4 }, { label: 'Dated', key: 'dated', w: 1.2 }, { label: 'Time', key: 'time', w: 0.9 }, { label: 'Overtime', key: 'ot', w: 0.9 }], rows, { size: 8, rowPad: 2 });
    if (!rows.length) doc.font('Helvetica').fontSize(9).fillColor(pdf.COLORS.muted).text('No attendance for this month.');

    const pay = slip && slip.attendance && slip.attendance.paymentDays !== undefined ? slip.attendance.paymentDays : null;
    const estimate = summary.presentDays + summary.shortDays + summary.leaveDays + summary.restDays + summary.holidayDays;
    if (doc.y + 70 > pdf.bottom(doc)) doc.addPage();
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(pdf.COLORS.ink).text('SUMMARY');
    doc.moveDown(0.2);
    pdf.pairs(doc, [
      ['No. of payment days', pay !== null ? pay : `${estimate} (estimate)`], ['Gaz. Holiday', days.filter((d) => d.status === 'holiday').map((d) => pdf.day(d.date)).join(' ') || '-'],
      ['No. of OT Hrs', pdf.hhmm(summary.overtimeHours)], ['Gaz. Holiday OT Hrs', pdf.hhmm(summary.holidayWorkedHours)],
      ['No. of with pay leaves', summary.leaveDays], ['Current Leave Bal.', `Casual ${bal('casual')}  Medical ${bal('sick')}  Annual ${bal('annual')}`],
    ], { columns: 2, labelWidth: 105 });
  }
  pdf.finish(doc, `Time sheet · ${employee.employeeCode}`);
  return doc;
}

async function load(employeeId) {
  const employee = await Employee.findById(employeeId);
  if (!employee) throw ApiError.notFound('Employee not found');
  return employee;
}

module.exports = { KINDS: ['leave-record', 'final-settlement', 'salary-sheet', 'time-sheet'], load, leaveRecord, finalSettlement, salarySheet, timeSheet, monthsIn, dayRange };
