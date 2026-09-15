'use strict';

/**
 * In-app signature packs. The original document is frozen at send time; the
 * signature is evidence that the named employee accepted that snapshot. Signing
 * never writes Core HR or payroll.
 */

const KINDS = ['contract', 'offer', 'policy', 'disciplinary', 'generic'];

const KIND_LABELS = {
  contract: 'Contract',
  offer: 'Offer letter',
  policy: 'Policy acknowledgement',
  disciplinary: 'Disciplinary notice',
  generic: 'Document',
};

const STATUSES = ['sent', 'signed', 'declined', 'cancelled'];

const STATUS_LABELS = {
  sent: 'Awaiting signature',
  signed: 'Signed',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

const TRANSITIONS = {
  sent: ['signed', 'declined', 'cancelled'],
  signed: [],
  declined: [],
  cancelled: [],
};

function metaPayload() {
  return {
    kinds: KINDS.map((value) => ({ value, label: KIND_LABELS[value] })),
    statuses: STATUSES.map((value) => ({
      value,
      label: STATUS_LABELS[value],
      next: TRANSITIONS[value],
    })),
  };
}

module.exports = {
  KINDS,
  KIND_LABELS,
  STATUSES,
  STATUS_LABELS,
  TRANSITIONS,
  metaPayload,
};
