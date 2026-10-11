'use strict';

const mongoose = require('mongoose');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const ExportLog = require('../models/ExportLog');
const docs = require('../services/employeeDocuments.service');
const { accessFor } = require('../services/reports/employeeReport.service');
const { visibleEmployeeIds, resolveViewerEmployee } = require('../services/employeeAccess');

const NAMES = { 'leave-record': 'Leave-Record', 'final-settlement': 'Final-Settlement', 'salary-sheet': 'Salary-Sheet', 'time-sheet': 'Time-Sheet' };

/** GET /api/employees/:id/downloads/:kind — one of the four printouts, as a PDF. */
const download = asyncHandler(async (req, res) => {
  const { kind } = req.params;
  if (!docs.KINDS.includes(kind)) throw ApiError.notFound('Unknown document');
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Employee not found');

  const employee = await docs.load(req.params.id);
  const [scope, viewer] = await Promise.all([visibleEmployeeIds(req.user), resolveViewerEmployee(req.user)]);
  const inLine = scope !== null && scope.some((id) => String(id) === String(employee._id));
  const access = accessFor(req.user, viewer, employee, inLine);
  if (!access.isHr && !access.isSelf && !access.isManager) throw ApiError.forbidden('You cannot download documents for this employee');
  // Pay documents follow the same rule as the payslips themselves; the settlement is HR's (and the leaver's).
  if (kind === 'salary-sheet' && !access.pay) throw ApiError.forbidden();
  if (kind === 'final-settlement' && !access.isHr && !access.isSelf) throw ApiError.forbidden('Final settlements are available to HR and the employee only');

  let doc;
  if (kind === 'leave-record') doc = await docs.leaveRecord(employee, req.query);
  else if (kind === 'final-settlement') doc = await docs.finalSettlement(employee);
  else if (kind === 'salary-sheet') doc = await docs.salarySheet(employee, req.query, access.isHr);
  else doc = await docs.timeSheet(employee, req.query);

  const filename = `${NAMES[kind]}-${employee.employeeCode}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.setHeader('Cache-Control', 'no-store');
  doc.pipe(res);

  ExportLog.create({
    reportCode: `employee-pdf:${kind}`, reportName: `${NAMES[kind]} ${employee.employeeCode}`, format: 'pdf', rowCount: 1, filters: req.query,
    actor: req.user._id, actorName: [req.user.firstName, req.user.lastName].filter(Boolean).join(' '), role: req.user.role,
  }).catch(() => {});
});

module.exports = { download };
