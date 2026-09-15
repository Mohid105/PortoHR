'use strict';

/**
 * Organization, grade, event and Pakistan Release-1 catalogues from the Core HR
 * functional design. Employee.department still uses the existing department
 * names so payroll and attendance keep a stable projection.
 */

const ORG_LEVELS = ['cluster', 'department', 'unit', 'section', 'team'];

const ORG_LEVEL_LABELS = {
  cluster: 'Cluster',
  department: 'Department',
  unit: 'Unit',
  section: 'Section',
  team: 'Team',
};

const ORG_STATUSES = ['draft', 'active', 'inactive', 'closed'];
const TEAM_TYPES = ['operational', 'general'];

const POSITION_STATUSES = ['draft', 'approved', 'vacant', 'filled', 'frozen', 'closed'];

const ORG_ROLES = ['worker', 'supervisor', 'team_lead', 'functional_head', 'hod'];

const ORG_ROLE_LABELS = {
  worker: 'Worker',
  supervisor: 'Supervisor',
  team_lead: 'Team Lead',
  functional_head: 'Functional Head',
  hod: 'Head of Department',
};

const GRADE_CATEGORIES = ['management', 'non_management', 'worker'];

const GRADE_CATEGORY_LABELS = {
  management: 'Management',
  non_management: 'Non-management',
  worker: 'Worker',
};

const EMPLOYEE_CATEGORIES = ['executive', 'non_executive', 'management', 'worker'];

const EMPLOYEE_CATEGORY_LABELS = {
  executive: 'Executive',
  non_executive: 'Non-executive',
  management: 'Management',
  worker: 'Worker',
};

const MARITAL_STATUSES = ['single', 'married', 'divorced', 'widowed', 'undisclosed'];

const NATIONALITIES = ['PK', 'US', 'GB', 'AE', 'IN', 'IT', 'DE', 'NG', 'other'];

const NATIONALITY_LABELS = {
  PK: 'Pakistan',
  US: 'United States',
  GB: 'United Kingdom',
  AE: 'United Arab Emirates',
  IN: 'India',
  IT: 'Italy',
  DE: 'Germany',
  NG: 'Nigeria',
  other: 'Other',
};

const ID_TYPES = ['cnic', 'passport', 'nicop', 'poc', 'work_permit', 'other'];

const ID_TYPE_LABELS = {
  cnic: 'CNIC',
  passport: 'Passport',
  nicop: 'NICOP',
  poc: 'POC',
  work_permit: 'Work permit',
  other: 'Other',
};

const ADDRESS_TYPES = ['permanent', 'current'];

const RELATIONSHIPS = ['spouse', 'father', 'mother', 'child', 'sibling', 'guardian', 'other'];

const PAY_GROUPS = ['monthly_pk', 'monthly_intl', 'weekly'];

const PAY_GROUP_LABELS = {
  monthly_pk: 'Monthly (Pakistan)',
  monthly_intl: 'Monthly (international)',
  weekly: 'Weekly',
};

const PAYMENT_METHODS = ['bank_transfer', 'cheque', 'cash'];

const PAYMENT_METHOD_LABELS = {
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
  cash: 'Cash',
};

const STATUTORY_SCHEMES = ['eobi', 'provident_fund', 'social_security', 'tax', 'health_insurance'];

const STATUTORY_SCHEME_LABELS = {
  eobi: 'EOBI',
  provident_fund: 'Provident fund',
  social_security: 'Social security (SESSI / PESSI)',
  tax: 'Income tax / NTN',
  health_insurance: 'Health insurance',
};

const DOCUMENT_TYPES = [
  'cnic',
  'passport',
  'visa',
  'work_permit',
  'contract',
  'appointment_letter',
  'confirmation_letter',
  'promotion_letter',
  'transfer_letter',
  'certificate',
  'other',
];

const DOCUMENT_TYPE_LABELS = {
  cnic: 'CNIC',
  passport: 'Passport',
  visa: 'Visa',
  work_permit: 'Work permit',
  contract: 'Employment contract',
  appointment_letter: 'Appointment letter',
  confirmation_letter: 'Confirmation letter',
  promotion_letter: 'Promotion letter',
  transfer_letter: 'Transfer letter',
  certificate: 'Certificate',
  other: 'Other',
};

const DOCUMENT_STATUSES = ['unverified', 'verified', 'rejected', 'expired'];

const CONFIDENTIALITY = ['general', 'sensitive', 'restricted'];

const QUALIFICATION_TYPES = ['education', 'professional', 'license', 'language', 'membership', 'skill'];

const SEPARATION_TYPES = ['resignation', 'retirement', 'termination', 'redundancy', 'end_of_contract', 'other'];

const SEPARATION_TYPE_LABELS = {
  resignation: 'Resignation',
  retirement: 'Retirement',
  termination: 'Termination',
  redundancy: 'Redundancy',
  end_of_contract: 'End of contract',
  other: 'Other',
};

const PERSONNEL_EVENTS = [
  'hire',
  'confirmation',
  'promotion',
  'transfer',
  'regrade',
  'shift_change',
  'manager_change',
  'salary_change',
  'correction',
  'separation',
  'rehire',
  'personal_change',
  'bank_change',
  'statutory_change',
];

const PERSONNEL_EVENT_LABELS = {
  hire: 'Hire',
  confirmation: 'Confirmation',
  promotion: 'Promotion',
  transfer: 'Transfer',
  regrade: 'Regrade',
  shift_change: 'Shift / schedule change',
  manager_change: 'Manager change',
  salary_change: 'Salary change',
  correction: 'Correction',
  separation: 'Separation',
  rehire: 'Rehire',
  personal_change: 'Personal data change',
  bank_change: 'Bank / payment change',
  statutory_change: 'Statutory / benefit change',
};

const EVENT_REASONS = {
  hire: ['new_hire', 'campus', 'replacement'],
  promotion: ['performance', 'vacancy', 'restructure'],
  transfer: ['business_need', 'employee_request', 'restructure'],
  regrade: ['market_adjustment', 'role_expansion'],
  shift_change: ['roster', 'employee_request', 'operations'],
  manager_change: ['restructure', 'span_of_control'],
  salary_change: ['annual_review', 'promotion', 'market_adjustment', 'correction'],
  correction: ['data_error', 'legal_name_change'],
  separation: ['resignation', 'retirement', 'termination', 'redundancy', 'end_of_contract'],
  rehire: ['eligible_return', 'project_need'],
};

/** Risk-based maker-checker from §24.1. Medium events require approval by default. */
const RISK = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
};

const HIGH_ASSIGNMENT_FIELDS = [
  'designation',
  'department',
  'team',
  'position',
  'grade',
  'orgRole',
  'compensation',
  'location',
];

const MEDIUM_ASSIGNMENT_FIELDS = ['shiftType', 'restDays', 'reportsTo', 'reportsToPosition'];

const LOW_SELF_FIELDS = ['phone', 'personalEmail', 'mobile', 'address', 'preferredName'];

function asOptions(values, labels) {
  return values.map((value) => ({ value, label: (labels && labels[value]) || value }));
}

function orgMeta() {
  return {
    orgLevels: asOptions(ORG_LEVELS, ORG_LEVEL_LABELS),
    orgStatuses: asOptions(ORG_STATUSES),
    teamTypes: asOptions(TEAM_TYPES, { operational: 'Operational', general: 'General' }),
    positionStatuses: asOptions(POSITION_STATUSES),
    orgRoles: asOptions(ORG_ROLES, ORG_ROLE_LABELS),
    gradeCategories: asOptions(GRADE_CATEGORIES, GRADE_CATEGORY_LABELS),
    employeeCategories: asOptions(EMPLOYEE_CATEGORIES, EMPLOYEE_CATEGORY_LABELS),
    maritalStatuses: asOptions(MARITAL_STATUSES),
    nationalities: asOptions(NATIONALITIES, NATIONALITY_LABELS),
    idTypes: asOptions(ID_TYPES, ID_TYPE_LABELS),
    addressTypes: asOptions(ADDRESS_TYPES),
    relationships: asOptions(RELATIONSHIPS),
    payGroups: asOptions(PAY_GROUPS, PAY_GROUP_LABELS),
    paymentMethods: asOptions(PAYMENT_METHODS, PAYMENT_METHOD_LABELS),
    statutorySchemes: asOptions(STATUTORY_SCHEMES, STATUTORY_SCHEME_LABELS),
    documentTypes: asOptions(DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS),
    documentStatuses: asOptions(DOCUMENT_STATUSES),
    confidentiality: asOptions(CONFIDENTIALITY),
    qualificationTypes: asOptions(QUALIFICATION_TYPES),
    separationTypes: asOptions(SEPARATION_TYPES, SEPARATION_TYPE_LABELS),
    personnelEvents: asOptions(PERSONNEL_EVENTS, PERSONNEL_EVENT_LABELS),
    eventReasons: EVENT_REASONS,
  };
}

module.exports = {
  ORG_LEVELS,
  ORG_LEVEL_LABELS,
  ORG_STATUSES,
  TEAM_TYPES,
  POSITION_STATUSES,
  ORG_ROLES,
  ORG_ROLE_LABELS,
  GRADE_CATEGORIES,
  GRADE_CATEGORY_LABELS,
  EMPLOYEE_CATEGORIES,
  EMPLOYEE_CATEGORY_LABELS,
  MARITAL_STATUSES,
  NATIONALITIES,
  NATIONALITY_LABELS,
  ID_TYPES,
  ID_TYPE_LABELS,
  ADDRESS_TYPES,
  RELATIONSHIPS,
  PAY_GROUPS,
  PAY_GROUP_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  STATUTORY_SCHEMES,
  STATUTORY_SCHEME_LABELS,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_STATUSES,
  CONFIDENTIALITY,
  QUALIFICATION_TYPES,
  SEPARATION_TYPES,
  SEPARATION_TYPE_LABELS,
  PERSONNEL_EVENTS,
  PERSONNEL_EVENT_LABELS,
  EVENT_REASONS,
  RISK,
  HIGH_ASSIGNMENT_FIELDS,
  MEDIUM_ASSIGNMENT_FIELDS,
  LOW_SELF_FIELDS,
  orgMeta,
};
