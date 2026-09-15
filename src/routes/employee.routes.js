'use strict';

const express = require('express');
const controller = require('../controllers/employee.controller');
const { authenticate, authorize, requireModule } = require('../middleware/auth');
const { MODULES, ROLES } = require('../config/roles');

const router = express.Router();

router.use(authenticate, requireModule(MODULES.CORE_HR));

router.get('/meta', controller.meta);
router.get('/changes', controller.listChanges);
router.get('/alerts', controller.alerts);
router.get('/reports', controller.reports);
router.get('/', controller.list);
router.get('/:id', controller.getOne);

router.patch('/assignments/:id/status', controller.decideAssignment);
router.patch('/bank/:bankId/status', controller.decideBank);
router.patch('/statutory/:statId/status', controller.decideStatutory);

router.post('/', authorize(ROLES.HR_ADMIN), controller.create);
router.patch('/:id', controller.update);
router.delete('/:id', authorize(ROLES.HR_ADMIN), controller.remove);

router.post('/:id/separate', authorize(ROLES.HR_ADMIN), controller.separate);
router.post('/:id/rehire', authorize(ROLES.HR_ADMIN), controller.rehire);
router.post('/:id/family', controller.saveFamily);
router.post('/:id/addresses', controller.saveAddress);
router.post('/:id/qualifications', controller.saveQualification);
router.post('/:id/documents', controller.saveDocument);
router.post('/:id/bank', controller.saveBank);
router.post('/:id/statutory', authorize(ROLES.HR_ADMIN), controller.saveStatutory);

module.exports = router;
