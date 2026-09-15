'use strict';

const express = require('express');
const controller = require('../controllers/recruitment.controller');
const { authenticate, requireModule } = require('../middleware/auth');
const { MODULES } = require('../config/roles');

const router = express.Router();

router.use(authenticate, requireModule(MODULES.RECRUITMENT));

router.get('/meta', controller.meta);
router.get('/requisitions', controller.listRequisitions);
router.post('/requisitions', controller.createRequisition);
router.patch('/requisitions/:id/status', controller.decideRequisition);

router.get('/applications', controller.listApplications);
router.post('/applications', controller.addCandidate);
router.post('/apply', controller.applyInternal);
router.patch('/applications/:id', controller.patchApplication);
router.post('/applications/:id/interviews', controller.addInterview);
router.post('/applications/:id/offer', controller.createOffer);

router.get('/offers', controller.listOffers);
router.patch('/offers/:id/status', controller.decideOffer);
router.post('/offers/:id/accept', controller.acceptOffer);

router.get('/onboarding', controller.listOnboarding);
router.patch('/onboarding/:id', controller.completeOnboarding);

module.exports = router;
