'use strict';

const express = require('express');
const controller = require('../controllers/reports.controller');
const { authenticate, requireModule } = require('../middleware/auth');
const { MODULES } = require('../config/roles');

const router = express.Router();

router.use(authenticate, requireModule(MODULES.REPORTS));

router.get('/meta', controller.meta);
router.get('/datasets/:key', controller.describeDataset);
router.get('/datasets/:key/values', controller.columnValues);
router.post('/run', controller.run);
router.post('/saved', controller.saveReport);
router.put('/saved/:id', controller.saveReport);
router.delete('/saved/:id', controller.deleteSaved);
router.get('/people', controller.people);
router.get('/employee/:id', controller.employee);
router.post('/log', controller.logUse);

module.exports = router;
