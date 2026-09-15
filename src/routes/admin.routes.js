'use strict';

const express = require('express');
const controller = require('../controllers/admin.controller');
const { authenticate, requireModule } = require('../middleware/auth');
const { MODULES } = require('../config/roles');

const router = express.Router();

router.use(authenticate, requireModule(MODULES.ADMIN));

router.get('/meta', controller.meta);
router.patch('/settings', controller.saveSettings);
router.get('/permissions', controller.permissions);
router.put('/permissions', controller.savePermissions);
router.get('/workflows', controller.workflows);
router.patch('/workflows/:id', controller.saveWorkflow);
router.post('/workflows/:id/publish', controller.publishWorkflow);
router.post('/workflows/:id/archive', controller.archiveWorkflow);
router.get('/delegations', controller.delegations);
router.post('/delegations', controller.createDelegation);
router.patch('/delegations/:id/cancel', controller.cancelDelegation);
router.get('/templates', controller.templates);
router.patch('/templates/:id', controller.saveTemplate);
router.post('/templates/:id/test', controller.testTemplate);
router.get('/lookups', controller.lookups);
router.post('/lookups', controller.createLookup);
router.patch('/lookups/:id', controller.saveLookup);
router.get('/connectors', controller.connectors);
router.patch('/connectors/:id', controller.saveConnector);
router.post('/connectors/:id/test', controller.testConnector);
router.get('/deliveries', controller.deliveries);
router.get('/outbox', controller.outbox);
router.get('/keys', controller.keys);
router.post('/keys', controller.createKey);
router.delete('/keys/:id', controller.revokeKey);
router.get('/audit', controller.auditLog);
router.get('/directory', controller.directory);

module.exports = router;
