'use strict';

const express = require('express');
const controller = require('../controllers/compliance.controller');
const { authenticate, requireModule } = require('../middleware/auth');
const { MODULES } = require('../config/roles');

const router = express.Router();

router.use(authenticate, requireModule(MODULES.COMPLIANCE));

router.get('/meta', controller.meta);
router.get('/me', controller.myCompliance);
router.get('/calendar', controller.calendar);
router.get('/people', controller.people);

router.get('/rules', controller.listRules);
router.post('/rules', controller.createRule);

router.get('/filings', controller.listFilings);
router.post('/filings/:id/file', controller.fileReturn);

router.get('/licenses', controller.listLicenses);
router.post('/licenses', controller.createLicense);
router.post('/licenses/:id/revoke', controller.revokeLicense);

router.get('/policies', controller.listPolicies);
router.post('/policies', controller.createPolicy);
router.post('/policies/:id/publish', controller.publishPolicy);
router.post('/policies/:id/acknowledge', controller.acknowledgePolicy);
router.get('/acknowledgements', controller.acknowledgementBoard);

router.get('/retention', controller.listRetention);
router.post('/retention', controller.saveRetention);

router.get('/export', controller.exportPack);

module.exports = router;
