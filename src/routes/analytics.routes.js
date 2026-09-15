'use strict';

const express = require('express');
const controller = require('../controllers/analytics.controller');
const { authenticate, requireModule } = require('../middleware/auth');
const { MODULES } = require('../config/roles');

const router = express.Router();

router.use(authenticate, requireModule(MODULES.ANALYTICS));

router.get('/meta', controller.meta);
router.get('/overview', controller.overview);
router.get('/headcount', controller.headcount);
router.get('/quality', controller.quality);
router.get('/outlook', controller.outlook);
router.post('/adhoc', controller.adhoc);
router.get('/reports', controller.listReports);
router.get('/reports/:code', controller.runReport);
router.post('/reports/:code/export', controller.exportReport);
router.get('/snapshots', controller.snapshots);
router.post('/snapshots', controller.refresh);
router.get('/exports', controller.exportsList);

module.exports = router;
