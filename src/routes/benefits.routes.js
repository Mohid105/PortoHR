'use strict';

const express = require('express');
const controller = require('../controllers/benefits.controller');
const { authenticate, requireModule } = require('../middleware/auth');
const { MODULES } = require('../config/roles');

const router = express.Router();

router.use(authenticate, requireModule(MODULES.BENEFITS));

router.get('/meta', controller.meta);
router.get('/me', controller.myCoverage);
router.get('/plans', controller.listPlans);
router.post('/plans', controller.createPlan);
router.post('/plans/:id/options', controller.addOption);

router.get('/enrollments', controller.listEnrollments);
router.post('/enrollments', controller.elect);
router.patch('/enrollments/:id/status', controller.decideEnrollment);
router.post('/enrollments/:id/end', controller.endEnrollment);

router.get('/summary', controller.summary);
router.get('/export', controller.exportEnrollments);

module.exports = router;
