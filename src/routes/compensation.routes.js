'use strict';

const express = require('express');
const controller = require('../controllers/compensation.controller');
const { authenticate, requireModule } = require('../middleware/auth');
const { MODULES } = require('../config/roles');

const router = express.Router();

router.use(authenticate, requireModule(MODULES.COMPENSATION));

router.get('/meta', controller.meta);
router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id', controller.getOne);

/** Decided per record by the approver relationship — see loan.routes.js. */
router.patch('/:id/status', controller.decide);
router.delete('/:id', controller.withdraw);

module.exports = router;
