'use strict';

/**
 * Creates an HR Admin, a Manager and an Employee (each with an employee record and a login)
 * on an empty or live database. The password is set exactly as given and is not forced to change.
 *
 *   PASSWORD='...' npm run create-users
 *   (optional: ADMIN_EMAIL, MANAGER_EMAIL, EMPLOYEE_EMAIL)
 */

const User = require('../models/User');
const org = require('../services/org.service');
const workforce = require('../services/workforce.service');
const access = require('../services/access.service');
const { connectDatabase, disconnectDatabase } = require('../config/database');
const env = require('../config/env');

const PEOPLE = [
  { role: 'hr_admin', env: 'ADMIN_EMAIL', email: 'porto@hr.com', first: 'Porto', last: 'Admin', code: 'EMP-0001', designation: 'HR Administrator', department: 'Human Resources', category: 'management' },
  { role: 'manager', env: 'MANAGER_EMAIL', email: 'porto@manager.com', first: 'Porto', last: 'Manager', code: 'EMP-0002', designation: 'Operations Manager', department: 'Operations', category: 'management' },
  { role: 'employee', env: 'EMPLOYEE_EMAIL', email: 'porto@employee.com', first: 'Porto', last: 'Employee', code: 'EMP-0003', designation: 'Operations Executive', department: 'Operations', category: 'non_executive' },
];

async function main() {
  const password = process.env.PASSWORD;
  const problem = access.passwordProblem(password);
  if (problem) throw new Error(`Set PASSWORD in the environment. ${problem}`);

  await connectDatabase(env.mongoUri);
  await org.ensureOrganization();
  let managerId = null;
  for (const p of PEOPLE) {
    const email = String(process.env[p.env] || p.email).toLowerCase();
    // eslint-disable-next-line no-await-in-loop
    if (await User.findOne({ email })) { console.log(`Skipped ${email}: a login already exists`); continue; }
    // eslint-disable-next-line no-await-in-loop
    const employee = await workforce.createHire({
      employeeCode: p.code, firstName: p.first, lastName: p.last, email, designation: p.designation, department: p.department,
      dateOfJoining: new Date().toISOString().slice(0, 10), employmentStatus: 'confirmed', employeeCategory: p.category,
      compensation: { baseSalary: 0, currency: 'PKR' }, reportsTo: p.role === 'employee' ? managerId : null,
    }, null);
    // eslint-disable-next-line no-await-in-loop
    const { user } = await access.createLogin(employee._id, { role: p.role });
    // eslint-disable-next-line no-await-in-loop
    const account = await User.findById(user.id);
    account.password = password;
    account.mustChangePassword = false;
    // eslint-disable-next-line no-await-in-loop
    await account.save();
    if (p.role === 'manager') managerId = employee._id;
    console.log(`Created ${p.role}: ${email}`);
  }
}

main().then(() => disconnectDatabase()).catch(async (err) => { console.error(`\nFailed: ${err.message}\n`); await disconnectDatabase().catch(() => {}); process.exit(1); });
