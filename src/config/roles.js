'use strict';

/**
 * Single source of truth for RBAC. The sidebar in the UI is rendered from the
 * same module list the API authorises against, so a role can never see a nav
 * entry it is not allowed to call.
 */

const ROLES = {
  EMPLOYEE: 'employee',
  MANAGER: 'manager',
  HR_ADMIN: 'hr_admin',
};

const ROLE_VALUES = Object.values(ROLES);

const MODULES = {
  CORE_HR: 'core_hr',
  ATTENDANCE: 'attendance',
  LEAVE: 'leave',
  PAYROLL: 'payroll',
  LOANS: 'loans',
  COMPENSATION: 'compensation',
  PMS: 'pms',
  RECRUITMENT: 'recruitment',
  LMS: 'lms',
  BENEFITS: 'benefits',
  COMPLIANCE: 'compliance',
  GRIEVANCE: 'grievance',
  ESIGN: 'esign',
  ASSETS: 'assets',
  ANALYTICS: 'analytics',
  ADMIN: 'admin',
};

const MODULE_LABELS = {
  [MODULES.CORE_HR]: 'Core HR',
  [MODULES.ATTENDANCE]: 'Attendance',
  [MODULES.LEAVE]: 'Leave',
  [MODULES.PAYROLL]: 'Payroll',
  [MODULES.LOANS]: 'Loans',
  [MODULES.COMPENSATION]: 'Compensation',
  [MODULES.PMS]: 'PMS',
  [MODULES.RECRUITMENT]: 'Recruitment',
  [MODULES.LMS]: 'Learning',
  [MODULES.BENEFITS]: 'Benefits',
  [MODULES.COMPLIANCE]: 'Compliance',
  [MODULES.GRIEVANCE]: 'Grievance',
  [MODULES.ESIGN]: 'E-sign',
  [MODULES.ASSETS]: 'Assets',
  [MODULES.ANALYTICS]: 'Analytics',
  [MODULES.ADMIN]: 'Admin',
};

/**
 * Loans and Compensation are self-service: everyone needs the module to raise a
 * request. What separates the roles is who may approve one, which the request
 * controllers enforce per record rather than at module level.
 */
const ROLE_MODULES = {
  [ROLES.EMPLOYEE]: [
    MODULES.CORE_HR,
    MODULES.ATTENDANCE,
    MODULES.LEAVE,
    MODULES.PAYROLL,
    MODULES.LOANS,
    MODULES.COMPENSATION,
    MODULES.PMS,
    MODULES.RECRUITMENT,
    MODULES.LMS,
    MODULES.BENEFITS,
    MODULES.COMPLIANCE,
    MODULES.GRIEVANCE,
    MODULES.ESIGN,
    MODULES.ASSETS,
    MODULES.ANALYTICS,
  ],
  [ROLES.MANAGER]: [
    MODULES.CORE_HR,
    MODULES.ATTENDANCE,
    MODULES.LEAVE,
    MODULES.PAYROLL,
    MODULES.LOANS,
    MODULES.COMPENSATION,
    MODULES.PMS,
    MODULES.RECRUITMENT,
    MODULES.LMS,
    MODULES.BENEFITS,
    MODULES.COMPLIANCE,
    MODULES.GRIEVANCE,
    MODULES.ESIGN,
    MODULES.ASSETS,
    MODULES.ANALYTICS,
  ],
  [ROLES.HR_ADMIN]: Object.values(MODULES),
};

const ROLE_LABELS = {
  [ROLES.EMPLOYEE]: 'Employee',
  [ROLES.MANAGER]: 'Manager',
  [ROLES.HR_ADMIN]: 'HR Admin',
};

function modulesForRole(role) {
  return ROLE_MODULES[role] || [];
}

function roleCanAccess(role, moduleKey) {
  return modulesForRole(role).includes(moduleKey);
}

module.exports = {
  ROLES,
  ROLE_VALUES,
  ROLE_LABELS,
  MODULES,
  MODULE_LABELS,
  ROLE_MODULES,
  modulesForRole,
  roleCanAccess,
};
