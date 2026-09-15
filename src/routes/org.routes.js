'use strict';

const express = require('express');
const controller = require('../controllers/org.controller');
const { authenticate, authorize, requireModule } = require('../middleware/auth');
const { MODULES, ROLES } = require('../config/roles');

const router = express.Router();

router.use(authenticate, requireModule(MODULES.CORE_HR));

router.get('/units', controller.listUnits);
router.get('/grades', controller.listGrades);
router.get('/jobs', controller.listJobs);
router.get('/positions', controller.listPositions);

router.post('/units', authorize(ROLES.HR_ADMIN), controller.createUnit);
router.post('/grades', authorize(ROLES.HR_ADMIN), controller.createGrade);
router.post('/jobs', authorize(ROLES.HR_ADMIN), controller.createJob);
router.post('/positions', authorize(ROLES.HR_ADMIN), controller.createPosition);

module.exports = router;
