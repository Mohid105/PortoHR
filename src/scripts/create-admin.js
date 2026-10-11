'use strict';

/**
 * Creates the first HR Admin for a fresh installation: an employee record in
 * Human Resources plus a login for it. This is the production alternative to
 * the demo seed, which creates accounts with a published password.
 *
 *   npm run create-admin -- --email=you@company.com --first=Sara --last=Khan
 *   (optional: --code=EMP-0001 --designation="HR Manager" --password=...)
 *
 * Without --password a strong temporary one is generated and printed once; the
 * account must change it at first sign-in either way.
 */

const User = require('../models/User');
const Employee = require('../models/Employee');
const org = require('../services/org.service');
const workforce = require('../services/workforce.service');
const access = require('../services/access.service');
const { connectDatabase, disconnectDatabase } = require('../config/database');
const env = require('../config/env');

function args() {
  const out = {};
  process.argv.slice(2).forEach((arg) => {
    const match = /^--([a-zA-Z]+)=(.*)$/.exec(arg);
    if (match) out[match[1]] = match[2];
  });
  return out;
}

async function main() {
  const a = args();
  const email = String(a.email || process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  const first = a.first || process.env.ADMIN_FIRST_NAME;
  const last = a.last || process.env.ADMIN_LAST_NAME;
  if (!email || !first || !last) {
    console.error('Usage: npm run create-admin -- --email=you@company.com --first=Sara --last=Khan');
    process.exit(1);
  }
  if (a.password) {
    const problem = access.passwordProblem(a.password);
    if (problem) {
      console.error(problem);
      process.exit(1);
    }
  }

  await connectDatabase(env.mongoUri);
  if (await User.findOne({ email })) throw new Error(`A login for ${email} already exists`);

  await org.ensureOrganization();
  const code = String(a.code || 'EMP-0001').toUpperCase();
  const employee = await workforce.createHire(
    {
      employeeCode: code,
      firstName: first,
      lastName: last,
      email,
      designation: a.designation || 'HR Administrator',
      department: 'Human Resources',
      dateOfJoining: new Date().toISOString().slice(0, 10),
      employmentStatus: 'confirmed',
      employeeCategory: 'management',
      compensation: { baseSalary: 0, currency: 'PKR' },
    },
    null
  );

  const { user, temporaryPassword } = await access.createLogin(employee._id, { role: 'hr_admin' });
  if (a.password) {
    const account = await User.findById(user.id);
    account.password = a.password;
    account.mustChangePassword = true;
    await account.save();
  }

  console.log(`\nHR Admin created: ${user.fullName} <${email}> (${code})`);
  console.log(a.password ? 'Password: the one you supplied (it must be changed at first sign-in).' : `Temporary password: ${temporaryPassword}`);
  console.log('Sign in, set your own password, then add departments and employees.\n');
}

main()
  .then(() => disconnectDatabase())
  .catch(async (err) => {
    console.error(`\nFailed: ${err.message}\n`);
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  });
