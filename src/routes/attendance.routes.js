'use strict';

const express = require('express');
const controller = require('../controllers/attendance.controller');
const { authenticate, authorize, requireModule } = require('../middleware/auth');
const { MODULES, ROLES } = require('../config/roles');

const router = express.Router();

router.use(authenticate, requireModule(MODULES.ATTENDANCE));

router.get('/meta', controller.meta);

// Clocking always acts on the caller's own record, so it needs no role check.
router.get('/today', controller.today);
router.post('/clock-in', controller.clockIn);
router.post('/clock-out', controller.clockOut);

// Reading a month defaults to self; the controller authorises any other target.
router.get('/', controller.month);

// Marking absence or leave is an HR correction.
router.patch('/day', authorize(ROLES.HR_ADMIN), controller.markDay);

module.exports = router;
