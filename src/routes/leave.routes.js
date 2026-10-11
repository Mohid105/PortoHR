'use strict';

const express = require('express');
const controller = require('../controllers/leave.controller');
const { authenticate, authorize, requireModule } = require('../middleware/auth');
const { MODULES, ROLES } = require('../config/roles');

const router = express.Router();

router.use(authenticate, requireModule(MODULES.LEAVE));

router.get('/meta', controller.meta);
router.get('/balances', controller.balances);
router.get('/statement', controller.statement);
router.post('/adjustments', authorize(ROLES.HR_ADMIN), controller.createAdjustment);
router.get('/calendar', controller.calendar);
router.get('/', controller.list);
router.post('/', controller.create);
router.post('/holidays', authorize(ROLES.HR_ADMIN), controller.createHoliday);
router.get('/:id', controller.getOne);
router.patch('/:id/status', controller.decide);
router.post('/:id/cancel', controller.cancel);

module.exports = router;
