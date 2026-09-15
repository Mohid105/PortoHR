'use strict';

/**
 * Employee-relations cases are not team data. Changing a status here is a
 * policy edit, not a hunt through the case screens.
 */

const CASE_TYPES = ['grievance', 'complaint', 'investigation', 'disciplinary'];

const CASE_TYPE_LABELS = {
  grievance: 'Grievance',
  complaint: 'Complaint',
  investigation: 'Investigation',
  disciplinary: 'Disciplinary',
};

const CASE_STATUSES = ['intake', 'investigation', 'hearing', 'decision', 'appeal', 'closed', 'rejected'];

const CASE_STATUS_LABELS = {
  intake: 'Intake',
  investigation: 'Investigation',
  hearing: 'Hearing',
  decision: 'Decision',
  appeal: 'Appeal',
  closed: 'Closed',
  rejected: 'Rejected',
};

const PARTY_ROLES = ['complainant', 'subject', 'witness', 'investigator'];

const PARTY_ROLE_LABELS = {
  complainant: 'Complainant',
  subject: 'Subject',
  witness: 'Witness',
  investigator: 'Investigator',
};

const ACTION_TYPES = ['none', 'verbal_warning', 'written_warning', 'suspension', 'termination'];

const ACTION_TYPE_LABELS = {
  none: 'No action',
  verbal_warning: 'Verbal warning',
  written_warning: 'Written warning',
  suspension: 'Suspension',
  termination: 'Termination',
};

const DECISION_OUTCOMES = ['upheld', 'not_upheld', 'informal_resolution', 'action'];

const DECISION_OUTCOME_LABELS = {
  upheld: 'Upheld',
  not_upheld: 'Not upheld',
  informal_resolution: 'Informal resolution',
  action: 'Disciplinary action',
};

const NOTE_VISIBILITY = ['parties', 'hr'];

const CLASSIFICATIONS = ['general', 'sensitive', 'restricted'];

function asOptions(values, labels) {
  return values.map((value) => ({ value, label: labels[value] || value }));
}

function metaPayload() {
  return {
    types: asOptions(CASE_TYPES, CASE_TYPE_LABELS),
    statuses: asOptions(CASE_STATUSES, CASE_STATUS_LABELS),
    partyRoles: asOptions(PARTY_ROLES, PARTY_ROLE_LABELS),
    actionTypes: asOptions(ACTION_TYPES, ACTION_TYPE_LABELS),
    outcomes: asOptions(DECISION_OUTCOMES, DECISION_OUTCOME_LABELS),
    classifications: CLASSIFICATIONS.map((value) => ({ value, label: value })),
  };
}

module.exports = {
  CASE_TYPES,
  CASE_TYPE_LABELS,
  CASE_STATUSES,
  CASE_STATUS_LABELS,
  PARTY_ROLES,
  PARTY_ROLE_LABELS,
  ACTION_TYPES,
  ACTION_TYPE_LABELS,
  DECISION_OUTCOMES,
  DECISION_OUTCOME_LABELS,
  NOTE_VISIBILITY,
  CLASSIFICATIONS,
  metaPayload,
};
