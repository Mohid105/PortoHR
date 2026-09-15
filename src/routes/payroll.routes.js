'use strict';

const express = require('express');
const controller = require('../controllers/payroll.controller');
const { authenticate, authorize, requireModule } = require('../middleware/auth');
const { MODULES, ROLES } = require('../config/roles');

const router = express.Router();

router.use(authenticate, requireModule(MODULES.PAYROLL));

router.get('/meta', controller.meta);

router.get('/arrears', controller.listArrears);
router.post('/arrears/simulate', authorize(ROLES.HR_ADMIN), controller.simulateArrears);
router.patch('/arrears/:id/status', authorize(ROLES.HR_ADMIN), controller.updateArrearsStatus);

// Reading is scoped inside the controller: self, direct reports, or everyone.
router.get('/', controller.list);
router.get('/:id', controller.getOne);

// Running and approving payroll is HR only.
router.post('/generate', authorize(ROLES.HR_ADMIN), controller.generate);
router.patch('/:id/status', authorize(ROLES.HR_ADMIN), controller.updateStatus);
router.delete('/:id', authorize(ROLES.HR_ADMIN), controller.remove);

module.exports = router;
