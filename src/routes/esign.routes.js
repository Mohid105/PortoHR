'use strict';

const express = require('express');
const controller = require('../controllers/esign.controller');
const { authenticate, authorize, requireModule } = require('../middleware/auth');
const { MODULES, ROLES } = require('../config/roles');

const router = express.Router();

router.use(authenticate, requireModule(MODULES.ESIGN));

router.get('/meta', controller.meta);
router.get('/people', authorize(ROLES.HR_ADMIN), controller.people);

router.get('/packs', controller.list);
router.post('/packs', authorize(ROLES.HR_ADMIN), controller.create);
router.get('/packs/:id/evidence', controller.evidence);
router.get('/packs/:id', controller.getOne);
router.post('/packs/:id/sign', controller.sign);
router.post('/packs/:id/decline', controller.decline);
router.post('/packs/:id/cancel', authorize(ROLES.HR_ADMIN), controller.cancel);

module.exports = router;
