'use strict';

/**
 * Recruitment pipeline labels and default pre-boarding tasks. Changing a stage
 * here is a policy edit, not a hunt through the ATS screens.
 */

const REQUISITION_STATUSES = ['pending', 'open', 'on_hold', 'filled', 'rejected', 'cancelled'];

const REQUISITION_STATUS_LABELS = {
  pending: 'Pending approval',
  open: 'Open',
  on_hold: 'On hold',
  filled: 'Filled',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

const PIPELINE_STAGES = ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn'];

const STAGE_LABELS = {
  applied: 'Applied',
  screening: 'Screening',
  interview: 'Interview',
  offer: 'Offer',
  hired: 'Hired',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

const OFFER_STATUSES = ['pending', 'approved', 'sent', 'accepted', 'declined', 'rejected'];

const OFFER_STATUS_LABELS = {
  pending: 'Pending approval',
  approved: 'Approved',
  sent: 'Sent',
  accepted: 'Accepted',
  declined: 'Declined',
  rejected: 'Rejected',
};

const SOURCES = ['internal', 'referral', 'agency', 'career_site', 'other'];

const SOURCE_LABELS = {
  internal: 'Internal',
  referral: 'Referral',
  agency: 'Agency',
  career_site: 'Career site',
  other: 'Other',
};

const ONBOARDING_DEFAULTS = [
  { title: 'Sign employment contract', owner: 'hr' },
  { title: 'Submit national ID / CNIC copy', owner: 'hire' },
  { title: 'Bank account for payroll', owner: 'hire' },
  { title: 'Issue laptop and building access', owner: 'it' },
  { title: 'Day-1 orientation', owner: 'manager' },
];

function metaPayload() {
  const asOptions = (values, labels) => values.map((value) => ({ value, label: labels[value] || value }));
  return {
    requisitionStatuses: asOptions(REQUISITION_STATUSES, REQUISITION_STATUS_LABELS),
    stages: asOptions(PIPELINE_STAGES, STAGE_LABELS),
    offerStatuses: asOptions(OFFER_STATUSES, OFFER_STATUS_LABELS),
    sources: asOptions(SOURCES, SOURCE_LABELS),
  };
}

module.exports = {
  REQUISITION_STATUSES,
  REQUISITION_STATUS_LABELS,
  PIPELINE_STAGES,
  STAGE_LABELS,
  OFFER_STATUSES,
  OFFER_STATUS_LABELS,
  SOURCES,
  SOURCE_LABELS,
  ONBOARDING_DEFAULTS,
  metaPayload,
};
