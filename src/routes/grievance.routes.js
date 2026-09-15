'use strict';

const express = require('express');
const controller = require('../controllers/grievance.controller');
const { authenticate, requireModule } = require('../middleware/auth');
const { MODULES } = require('../config/roles');

const router = express.Router();

router.use(authenticate, requireModule(MODULES.GRIEVANCE));

router.get('/meta', controller.meta);
router.get('/people', controller.people);
router.get('/analytics', controller.analytics);
router.get('/cases', controller.listCases);
router.post('/cases', controller.createCase);
router.get('/cases/:id', controller.getCase);
router.post('/cases/:id/triage', controller.triageCase);
router.post('/cases/:id/notes', controller.addNote);
router.post('/cases/:id/hearing', controller.scheduleHearing);
router.post('/cases/:id/decision', controller.decideCase);
router.post('/cases/:id/appeal', controller.appealCase);
router.post('/cases/:id/close', controller.closeCase);
router.post('/cases/:id/documents', controller.addDocument);

module.exports = router;
