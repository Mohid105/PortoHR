'use strict';

/**
 * Facilities catalogue, custody states and finance-reference fields live here
 * so the screens never invent a status the schema will reject.
 */

const ASSET_CATEGORIES = ['it', 'id_card', 'access_card', 'uniform', 'ppe', 'vehicle', 'furniture', 'other'];

const ASSET_CATEGORY_LABELS = {
  it: 'IT equipment',
  id_card: 'ID card',
  access_card: 'Access card',
  uniform: 'Uniform',
  ppe: 'PPE',
  vehicle: 'Vehicle',
  furniture: 'Furniture',
  other: 'Other',
};

const ASSET_STATUSES = ['available', 'issued', 'maintenance', 'retired'];

const ASSET_STATUS_LABELS = {
  available: 'Available',
  issued: 'Issued',
  maintenance: 'In maintenance',
  retired: 'Retired',
};

const ASSIGNMENT_STATUSES = ['requested', 'issued', 'acknowledged', 'recovery', 'returned', 'lost'];

const ASSIGNMENT_STATUS_LABELS = {
  requested: 'Requested',
  issued: 'Issued',
  acknowledged: 'Acknowledged',
  recovery: 'Recovery due',
  returned: 'Returned',
  lost: 'Lost',
};

const HOLDING_STATUSES = ['requested', 'issued', 'acknowledged', 'recovery'];

const CUSTODY_STATUSES = ['issued', 'acknowledged', 'recovery'];

const SEPARATION_STATUSES = ['notice_period', 'resigned', 'terminated'];

const CONDITIONS = ['new', 'good', 'fair', 'poor'];

const CONDITION_LABELS = {
  new: 'New',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
};

const MAINTENANCE_STATUSES = ['open', 'scheduled', 'done', 'cancelled'];

const MAINTENANCE_STATUS_LABELS = {
  open: 'Open',
  scheduled: 'Scheduled',
  done: 'Done',
  cancelled: 'Cancelled',
};

const MAINTENANCE_KINDS = ['repair', 'service', 'inspection'];

const MAINTENANCE_KIND_LABELS = {
  repair: 'Repair',
  service: 'Service',
  inspection: 'Inspection',
};

const ALLOCATION_STATUSES = ['requested', 'allocated', 'cancelled', 'vacated'];

const ALLOCATION_STATUS_LABELS = {
  requested: 'Requested',
  allocated: 'Allocated',
  cancelled: 'Cancelled',
  vacated: 'Vacated',
};

function asOptions(values, labels) {
  return values.map((value) => ({ value, label: labels[value] || value }));
}

function metaPayload() {
  return {
    categories: asOptions(ASSET_CATEGORIES, ASSET_CATEGORY_LABELS),
    assetStatuses: asOptions(ASSET_STATUSES, ASSET_STATUS_LABELS),
    assignmentStatuses: asOptions(ASSIGNMENT_STATUSES, ASSIGNMENT_STATUS_LABELS),
    conditions: asOptions(CONDITIONS, CONDITION_LABELS),
    maintenanceStatuses: asOptions(MAINTENANCE_STATUSES, MAINTENANCE_STATUS_LABELS),
    maintenanceKinds: asOptions(MAINTENANCE_KINDS, MAINTENANCE_KIND_LABELS),
    allocationStatuses: asOptions(ALLOCATION_STATUSES, ALLOCATION_STATUS_LABELS),
  };
}

module.exports = {
  ASSET_CATEGORIES,
  ASSET_CATEGORY_LABELS,
  ASSET_STATUSES,
  ASSET_STATUS_LABELS,
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_STATUS_LABELS,
  HOLDING_STATUSES,
  CUSTODY_STATUSES,
  SEPARATION_STATUSES,
  CONDITIONS,
  CONDITION_LABELS,
  MAINTENANCE_STATUSES,
  MAINTENANCE_STATUS_LABELS,
  MAINTENANCE_KINDS,
  MAINTENANCE_KIND_LABELS,
  ALLOCATION_STATUSES,
  ALLOCATION_STATUS_LABELS,
  metaPayload,
};
