'use strict';

/**
 * Login accounts for real people. Core HR owns the employee record; this is the
 * bridge that lets an employee actually sign in. Passwords are never emailed
 * from here: HR receives a one-time temporary password, and the account is
 * flagged so the person must choose their own on first sign-in.
 */

const crypto = require('crypto');
const User = require('../models/User');
const Employee = require('../models/Employee');
const ApiError = require('../utils/ApiError');
const { ROLE_VALUES, ROLES, ROLE_LABELS } = require('../config/roles');

const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function temporaryPassword() {
  let out = '';
  const bytes = crypto.randomBytes(12);
  for (let i = 0; i < 12; i += 1) out += TEMP_ALPHABET[bytes[i] % TEMP_ALPHABET.length];
  // Guarantee the policy below is satisfied.
  return `${out}7a`;
}

/** Returns a human-readable problem, or '' when the password is acceptable. */
function passwordProblem(password) {
  const value = String(password || '');
  if (value.length < 8) return 'Password must be at least 8 characters';
  if (value.length > 72) return 'Password must be at most 72 characters';
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return 'Password must contain letters and numbers';
  return '';
}

function present(user, employee) {
  return {
    id: String(user._id),
    employeeId: user.employeeId,
    fullName: `${user.firstName} ${user.lastName}`.trim(),
    email: user.email,
    role: user.role,
    roleLabel: ROLE_LABELS[user.role],
    designation: user.designation,
    department: user.department,
    isActive: user.isActive,
    mustChangePassword: Boolean(user.mustChangePassword),
    locked: Boolean(user.lockedUntil && new Date(user.lockedUntil) > new Date()),
    lockedUntil: user.lockedUntil || null,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    employee: employee
      ? { id: String(employee._id), code: employee.employeeCode, status: employee.employmentStatus }
      : null,
  };
}

async function listUsers() {
  const [users, employees] = await Promise.all([
    User.find({}).sort({ firstName: 1, lastName: 1 }),
    Employee.find({}).select('employeeCode email userAccount employmentStatus'),
  ]);
  const byUser = new Map();
  const byEmail = new Map();
  employees.forEach((row) => {
    if (row.userAccount) byUser.set(String(row.userAccount), row);
    byEmail.set(row.email, row);
  });
  return users.map((user) => present(user, byUser.get(String(user._id)) || byEmail.get(user.email) || null));
}

/** Employees still in service who have no way to sign in yet. */
async function listUnlinked() {
  const users = await User.find({}).select('email');
  const emails = new Set(users.map((user) => user.email));
  const rows = await Employee.find({
    employmentStatus: { $nin: ['resigned', 'terminated'] },
    $or: [{ userAccount: null }, { userAccount: { $exists: false } }],
  })
    .select('employeeCode firstName lastName email designation department')
    .sort({ firstName: 1 });
  return rows
    .filter((row) => !emails.has(row.email))
    .map((row) => ({
      id: String(row._id),
      employeeCode: row.employeeCode,
      fullName: row.fullName,
      email: row.email,
      designation: row.designation,
      department: row.department,
    }));
}

async function createLogin(employeeId, body) {
  const role = (body && body.role) || ROLES.EMPLOYEE;
  if (!ROLE_VALUES.includes(role)) throw ApiError.badRequest('Unsupported role');

  const employee = await Employee.findById(employeeId);
  if (!employee) throw ApiError.notFound('Employee not found');
  if (['resigned', 'terminated'].includes(employee.employmentStatus)) {
    throw ApiError.badRequest('A separated employee cannot be given a login');
  }
  if (employee.userAccount) throw ApiError.conflict('This employee already has a login');
  if (await User.findOne({ $or: [{ email: employee.email }, { employeeId: employee.employeeCode }] })) {
    throw ApiError.conflict('A login with this email or employee code already exists');
  }

  const password = temporaryPassword();
  const user = await User.create({
    employeeId: employee.employeeCode,
    firstName: employee.firstName,
    lastName: employee.lastName,
    email: employee.email,
    password,
    role,
    designation: employee.designation,
    department: employee.department,
    mustChangePassword: true,
  });
  employee.userAccount = user._id;
  await employee.save();

  return { user: present(user, employee), temporaryPassword: password };
}

async function assertNotLastAdmin(user) {
  if (user.role !== ROLES.HR_ADMIN || !user.isActive) return;
  const others = await User.countDocuments({ role: ROLES.HR_ADMIN, isActive: true, _id: { $ne: user._id } });
  if (!others) throw ApiError.badRequest('At least one active HR Admin must remain');
}

async function updateUser(id, body, actor) {
  const user = await User.findById(id);
  if (!user) throw ApiError.notFound('Account not found');

  const nextRole = body.role !== undefined ? body.role : user.role;
  const nextActive = body.isActive !== undefined ? Boolean(body.isActive) : user.isActive;
  if (!ROLE_VALUES.includes(nextRole)) throw ApiError.badRequest('Unsupported role');

  const isSelf = String(actor._id) === String(user._id);
  if (isSelf && (nextRole !== user.role || nextActive !== user.isActive)) {
    throw ApiError.badRequest('You cannot change your own role or deactivate yourself');
  }
  if (nextRole !== ROLES.HR_ADMIN || !nextActive) await assertNotLastAdmin(user);

  user.role = nextRole;
  user.isActive = nextActive;
  await user.save();
  const employee = await Employee.findOne({ $or: [{ userAccount: user._id }, { email: user.email }] }).select(
    'employeeCode employmentStatus'
  );
  return present(user, employee);
}

async function resetPassword(id, actor) {
  const user = await User.findById(id);
  if (!user) throw ApiError.notFound('Account not found');
  if (String(actor._id) === String(user._id)) {
    throw ApiError.badRequest('Use "Change password" for your own account');
  }
  const password = temporaryPassword();
  user.password = password;
  user.mustChangePassword = true;
  await user.save();
  return { user: present(user, null), temporaryPassword: password };
}

async function unlock(id) {
  const user = await User.findById(id);
  if (!user) throw ApiError.notFound('Account not found');
  user.failedLogins = 0;
  user.lockedUntil = null;
  await user.save({ validateBeforeSave: false });
  return present(user, null);
}

/** Ends every open session for the account, on every device. */
async function revokeSessions(id) {
  const user = await User.findById(id);
  if (!user) throw ApiError.notFound('Account not found');
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save({ validateBeforeSave: false });
  return present(user, null);
}

async function listEvents(query) {
  const LoginEvent = require('../models/LoginEvent');
  const filter = {};
  if (query.failed === '1') filter.success = false;
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 40));
  const rows = await LoginEvent.find(filter).sort({ createdAt: -1 }).limit(limit);
  return rows.map((row) => row.toJSON());
}

/** Called when offboarding revokes access: the person can no longer sign in. */
async function deactivateForEmployee(employee) {
  const user = await User.findOne({
    $or: [{ _id: employee.userAccount || null }, { email: employee.email }],
  });
  if (!user || !user.isActive) return false;
  if (user.role === ROLES.HR_ADMIN) await assertNotLastAdmin(user);
  user.isActive = false;
  await user.save();
  return true;
}

module.exports = {
  unlock,
  revokeSessions,
  listEvents,
  passwordProblem,
  listUsers,
  listUnlinked,
  createLogin,
  updateUser,
  resetPassword,
  deactivateForEmployee,
};
