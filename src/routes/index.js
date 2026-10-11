'use strict';

const express = require('express');
const mongoose = require('mongoose');
const authRoutes = require('./auth.routes');
const employeeRoutes = require('./employee.routes');
const attendanceRoutes = require('./attendance.routes');
const payrollRoutes = require('./payroll.routes');
const loanRoutes = require('./loan.routes');
const compensationRoutes = require('./compensation.routes');
const pmsRoutes = require('./pms.routes');
const orgRoutes = require('./org.routes');
const leaveRoutes = require('./leave.routes');
const recruitmentRoutes = require('./recruitment.routes');
const lmsRoutes = require('./lms.routes');
const benefitsRoutes = require('./benefits.routes');
const complianceRoutes = require('./compliance.routes');
const grievanceRoutes = require('./grievance.routes');
const esignRoutes = require('./esign.routes');
const assetsRoutes = require('./assets.routes');
const analyticsRoutes = require('./analytics.routes');
const reportsRoutes = require('./reports.routes');
const adminRoutes = require('./admin.routes');
const notificationsRoutes = require('./notifications.routes');
const delegationsRoutes = require('./delegations.routes');
const approvalsRoutes = require('./approvals.routes');
const integrationsRoutes = require('./integrations.routes');
const companyRoutes = require('./company.routes');
const moduleRoutes = require('./modules.routes');

const router = express.Router();

router.get('/health', (_req, res) => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  res.json({
    success: true,
    service: 'portohr-api',
    uptime: Math.round(process.uptime()),
    database: states[mongoose.connection.readyState] || 'unknown',
    timestamp: new Date().toISOString(),
  });
});

router.use('/auth', authRoutes);
router.use('/employees', employeeRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/payroll', payrollRoutes);
router.use('/loans', loanRoutes);
router.use('/compensation', compensationRoutes);
router.use('/pms', pmsRoutes);
router.use('/org', orgRoutes);
router.use('/leave', leaveRoutes);
router.use('/recruitment', recruitmentRoutes);
router.use('/lms', lmsRoutes);
router.use('/benefits', benefitsRoutes);
router.use('/compliance', complianceRoutes);
router.use('/grievance', grievanceRoutes);
router.use('/esign', esignRoutes);
router.use('/assets', assetsRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/reports', reportsRoutes);
router.use('/admin', adminRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/delegations', delegationsRoutes);
router.use('/approvals', approvalsRoutes);
router.use('/integrations', integrationsRoutes);
router.use('/company', companyRoutes);
moduleRoutes.forEach(({ path, router: moduleRouter }) => router.use(path, moduleRouter));

module.exports = router;
