'use strict';

/**
 * Admin catalogue: workflow events, connector kinds and notification channels.
 * Publishing a workflow here is what the approval screens consult.
 */

const WORKFLOW_EVENTS = [
  'leave',
  'assignment',
  'loan',
  'compensation',
  'bank',
  'requisition',
  'offer',
  'benefits',
  'statutory',
  'lms',
];

const WORKFLOW_EVENT_LABELS = {
  leave: 'Leave',
  assignment: 'Assignment change',
  loan: 'Salary loan',
  compensation: 'Compensation claim',
  bank: 'Bank / payment method',
  requisition: 'Requisition',
  offer: 'Offer',
  benefits: 'Benefits enrolment',
  statutory: 'Statutory enrolment',
  lms: 'Learning nomination',
};

const ACTOR_ROLES = ['manager', 'hr_admin'];

const ACTOR_ROLE_LABELS = {
  manager: 'Manager',
  hr_admin: 'HR Admin',
};

const WORKFLOW_STATUSES = ['draft', 'published', 'archived'];

const LOOKUP_CATEGORIES = ['reason_code', 'document_type', 'separation_reason', 'cost_center'];

const LOOKUP_CATEGORY_LABELS = {
  reason_code: 'Reason codes',
  document_type: 'Document types',
  separation_reason: 'Separation reasons',
  cost_center: 'Cost centres',
};

const CONNECTOR_KINDS = ['webhook', 'biometric', 'bank_file', 'sso', 'erp', 'statutory_portal'];

const CONNECTOR_KIND_LABELS = {
  webhook: 'Outbound webhook',
  biometric: 'Biometric device',
  bank_file: 'Bank payment file',
  sso: 'SSO / identity',
  erp: 'ERP / accounting',
  statutory_portal: 'Statutory portal',
};

const NOTIFICATION_CHANNELS = ['in_app', 'email', 'sms'];

const WEBHOOK_EVENTS = [
  'employee.hired',
  'employee.transferred',
  'employee.separated',
  'payroll.closed',
  'approval.completed',
  'webhook.test',
];

function asOptions(values, labels) {
  return values.map((value) => ({ value, label: labels[value] || value }));
}

function metaPayload() {
  return {
    events: asOptions(WORKFLOW_EVENTS, WORKFLOW_EVENT_LABELS),
    actorRoles: asOptions(ACTOR_ROLES, ACTOR_ROLE_LABELS),
    workflowStatuses: WORKFLOW_STATUSES.map((value) => ({ value, label: value })),
    lookupCategories: asOptions(LOOKUP_CATEGORIES, LOOKUP_CATEGORY_LABELS),
    connectors: asOptions(CONNECTOR_KINDS, CONNECTOR_KIND_LABELS),
    channels: NOTIFICATION_CHANNELS.map((value) => ({ value, label: value.replace('_', ' ') })),
    webhookEvents: WEBHOOK_EVENTS,
  };
}

module.exports = {
  WORKFLOW_EVENTS,
  WORKFLOW_EVENT_LABELS,
  ACTOR_ROLES,
  ACTOR_ROLE_LABELS,
  WORKFLOW_STATUSES,
  LOOKUP_CATEGORIES,
  LOOKUP_CATEGORY_LABELS,
  CONNECTOR_KINDS,
  CONNECTOR_KIND_LABELS,
  NOTIFICATION_CHANNELS,
  WEBHOOK_EVENTS,
  metaPayload,
};
