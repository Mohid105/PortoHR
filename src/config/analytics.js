'use strict';

/**
 * Standard reports and dashboard scopes. Adding a report here is a catalogue
 * edit — the runner still has to know how to fill the rows.
 */

const REPORTS = [
  {
    code: 'headcount_department',
    name: 'Headcount by department',
    category: 'headcount',
    summary: 'Active employees grouped by department as of a chosen date.',
    visibility: 'manager',
    groupBy: ['department', 'status', 'location'],
  },
  {
    code: 'headcount_status',
    name: 'Headcount by status',
    category: 'headcount',
    summary: 'Confirmed, probation, notice and exit counts.',
    visibility: 'manager',
    groupBy: ['status', 'department'],
  },
  {
    code: 'roster',
    name: 'Workforce roster',
    category: 'headcount',
    summary: 'Named roster for the caller’s scope. Compensation is omitted unless you are HR.',
    visibility: 'manager',
    groupBy: ['department', 'status'],
  },
  {
    code: 'vacancies',
    name: 'Approved vs filled seats',
    category: 'headcount',
    summary: 'Position FTE by team from the org structure.',
    visibility: 'hr',
    groupBy: [],
  },
  {
    code: 'pending_work',
    name: 'Unapproved requests',
    category: 'quality',
    summary: 'Leave, assignments, bank, offers and similar items still waiting.',
    visibility: 'manager',
    groupBy: ['type'],
  },
  {
    code: 'expiring',
    name: 'Expiring documents and licences',
    category: 'quality',
    summary: 'Personnel documents, work permits and certificates in the next 30 days.',
    visibility: 'manager',
    groupBy: ['kind'],
  },
  {
    code: 'open_requisitions',
    name: 'Open requisitions',
    category: 'talent',
    summary: 'Approved or pending seats still to fill.',
    visibility: 'manager',
    groupBy: ['department'],
  },
  {
    code: 'payroll_coverage',
    name: 'Payroll coverage',
    category: 'payroll',
    summary: 'Latest payslip month versus active headcount. Cost totals are HR-only.',
    visibility: 'hr',
    groupBy: [],
  },
  {
    code: 'er_caseload',
    name: 'Employee-relations caseload',
    category: 'compliance',
    summary: 'Anonymized counts by type and status. No names.',
    visibility: 'hr',
    groupBy: ['type', 'status'],
  },
  {
    code: 'retention_watch',
    name: 'Retention watch',
    category: 'talent',
    summary: 'Rule-based watch list: notice, missing manager, probation, high overtime. Not a statistical model.',
    visibility: 'manager',
    groupBy: ['band'],
  },
  {
    code: 'headcount_outlook',
    name: 'Headcount outlook',
    category: 'headcount',
    summary: 'If every notice exit completes and no hire lands, versus open requisitions. Transparent arithmetic, not a forecast model.',
    visibility: 'hr',
    groupBy: [],
  },
];

const DASHBOARD_VIEWS = ['executive', 'hr_ops', 'payroll', 'talent', 'compliance'];

const EXPORT_FORMATS = ['json'];

const ADHOC_GROUP_BY = ['department', 'status', 'location', 'designation', 'team'];

function metaPayload() {
  return {
    reports: REPORTS.map((row) => ({
      code: row.code,
      name: row.name,
      category: row.category,
      summary: row.summary,
      visibility: row.visibility,
      groupBy: row.groupBy,
    })),
    views: DASHBOARD_VIEWS,
    formats: EXPORT_FORMATS,
    adhocGroupBy: ADHOC_GROUP_BY,
  };
}

module.exports = {
  REPORTS,
  DASHBOARD_VIEWS,
  EXPORT_FORMATS,
  ADHOC_GROUP_BY,
  metaPayload,
};
