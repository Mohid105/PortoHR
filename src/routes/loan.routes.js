'use strict';

const express = require('express');
const controller = require('../controllers/loan.controller');
const { authenticate, requireModule } = require('../middleware/auth');
const { MODULES } = require('../config/roles');

const router = express.Router();

router.use(authenticate, requireModule(MODULES.LOANS));

router.get('/meta', controller.meta);
router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id', controller.getOne);

/**
 * Approving is not a role check but a relationship one — a manager may decide
 * for their reports and HR for anyone but themselves — so the controller
 * authorises per record rather than the route doing it by role.
 */
router.patch('/:id/status', controller.decide);
router.delete('/:id', controller.withdraw);

module.exports = router;
