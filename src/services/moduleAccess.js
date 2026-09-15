'use strict';

const { ROLES, ROLE_MODULES, MODULES } = require('../config/roles');
const ApiError = require('../utils/ApiError');

let cache = { at: 0, byRole: null };

function cloneDefaults() {
  return {
    [ROLES.EMPLOYEE]: ROLE_MODULES[ROLES.EMPLOYEE].slice(),
    [ROLES.MANAGER]: ROLE_MODULES[ROLES.MANAGER].slice(),
    [ROLES.HR_ADMIN]: ROLE_MODULES[ROLES.HR_ADMIN].slice(),
  };
}

function invalidateModuleCache() {
  cache = { at: 0, byRole: null };
}

async function loadOverlay() {
  if (cache.byRole && Date.now() - cache.at < 4000) return cache.byRole;
  const byRole = cloneDefaults();
  try {
    const RolePermission = require('../models/RolePermission');
    const rows = await RolePermission.find({});
    rows.forEach((row) => {
      if (Array.isArray(row.modules) && row.modules.length) byRole[row.role] = row.modules.slice();
    });
  } catch (err) {
    /* collection may not exist yet on a fresh boot */
  }
  cache = { at: Date.now(), byRole };
  return byRole;
}

async function resolveModules(role) {
  const overlay = await loadOverlay();
  return overlay[role] || [];
}

async function roleCanAccess(role, moduleKey) {
  const modules = await resolveModules(role);
  return modules.includes(moduleKey);
}

function guardMatrix(role, modules) {
  const next = Array.from(new Set(modules || []));
  if (role === ROLES.HR_ADMIN) {
    if (!next.includes(MODULES.ADMIN)) next.push(MODULES.ADMIN);
    if (!next.includes(MODULES.CORE_HR)) next.push(MODULES.CORE_HR);
  } else if (next.includes(MODULES.ADMIN)) {
    throw ApiError.badRequest('Only HR Admin can hold the Admin module');
  }
  return next;
}

module.exports = {
  resolveModules,
  roleCanAccess,
  invalidateModuleCache,
  guardMatrix,
  loadOverlay,
};
