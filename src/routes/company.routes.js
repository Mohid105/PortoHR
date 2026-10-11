'use strict';

const express = require('express');
const controller = require('../controllers/company.controller');
const { authenticate, authorize, requireModule } = require('../middleware/auth');
const { MODULES, ROLES } = require('../config/roles');

const router = express.Router();
const hr = authorize(ROLES.HR_ADMIN);

router.use(authenticate, requireModule(MODULES.COMPANY));

router.get('/announcements', controller.announcements);
router.post('/announcements', hr, controller.createAnnouncement);
router.patch('/announcements/:id', hr, controller.updateAnnouncement);
router.delete('/announcements/:id', hr, controller.deleteAnnouncement);

router.get('/pulse', authorize(ROLES.HR_ADMIN, ROLES.MANAGER), controller.pulse);
router.get('/moments', controller.moments);
router.get('/org-chart', controller.orgChart);

router.get('/offboarding', hr, controller.offboarding);
router.post('/offboarding/:employeeId/start', hr, controller.startOffboarding);
router.patch('/offboarding/tasks/:id', hr, controller.setExitTask);

module.exports = router;
