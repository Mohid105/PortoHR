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

router.get('/inputs', authorize(ROLES.HR_ADMIN), controller.listInputs);
router.put('/inputs', authorize(ROLES.HR_ADMIN), controller.saveInput);
router.post('/inputs/import', authorize(ROLES.HR_ADMIN), controller.importInputs);
router.get('/register', authorize(ROLES.HR_ADMIN), controller.register);
router.get('/bank-advice', authorize(ROLES.HR_ADMIN), controller.bankAdvice);
router.get('/statutory', authorize(ROLES.HR_ADMIN), controller.statutoryReport);

router.get('/settlements', authorize(ROLES.HR_ADMIN), controller.settlementList);
router.post('/settlements', authorize(ROLES.HR_ADMIN), controller.settlementPrepare);
router.get('/settlements/:id', authorize(ROLES.HR_ADMIN), controller.settlementGet);
router.patch('/settlements/:id/status', authorize(ROLES.HR_ADMIN), controller.settlementStatus);

// Reading is scoped inside the controller: self, direct reports, or everyone.
router.get('/', controller.list);
router.get('/:id', controller.getOne);

// Running and approving payroll is HR only.
router.post('/generate', authorize(ROLES.HR_ADMIN), controller.generate);
router.patch('/:id/status', authorize(ROLES.HR_ADMIN), controller.updateStatus);
router.delete('/:id', authorize(ROLES.HR_ADMIN), controller.remove);

module.exports = router;
