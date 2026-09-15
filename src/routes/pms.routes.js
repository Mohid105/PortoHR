'use strict';

const express = require('express');
const controller = require('../controllers/pms.controller');
const { authenticate, authorize, requireModule } = require('../middleware/auth');
const { MODULES, ROLES } = require('../config/roles');

const router = express.Router();

router.use(authenticate, requireModule(MODULES.PMS));

router.get('/meta', controller.meta);
router.get('/team', controller.team);
router.get('/me', controller.me);
router.get('/employees/:id/plan', controller.employeePlan);

router.get('/appraisals', controller.listAppraisals);
router.get('/appraisals/:id', controller.getAppraisal);
router.post('/appraisals/:id/self', controller.submitSelf);
router.post('/appraisals/:id/review', controller.submitReview);

router.post('/objectives', authorize(ROLES.MANAGER, ROLES.HR_ADMIN), controller.createObjective);
router.patch('/objectives/:id', authorize(ROLES.MANAGER, ROLES.HR_ADMIN), controller.updateObjective);
router.delete('/objectives/:id', authorize(ROLES.MANAGER, ROLES.HR_ADMIN), controller.deleteObjective);

router.post('/kpis', authorize(ROLES.MANAGER, ROLES.HR_ADMIN), controller.createKpi);
router.patch('/kpis/:id', authorize(ROLES.MANAGER, ROLES.HR_ADMIN), controller.updateKpi);
router.delete('/kpis/:id', authorize(ROLES.MANAGER, ROLES.HR_ADMIN), controller.deleteKpi);

module.exports = router;
