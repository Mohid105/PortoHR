'use strict';

const express = require('express');
const controller = require('../controllers/employee.controller');
const onboarding = require('../controllers/onboarding.controller');
const personnelFile = require('../controllers/personnelFile.controller');
const downloads = require('../controllers/employeeDocuments.controller');
const { authenticate, authorize, requireModule } = require('../middleware/auth');
const { MODULES, ROLES } = require('../config/roles');

const router = express.Router();

router.use(authenticate, requireModule(MODULES.CORE_HR));

router.get('/meta', controller.meta);
router.get('/changes', controller.listChanges);
router.get('/alerts', controller.alerts);
router.get('/reports', controller.reports);
router.get('/next-code', authorize(ROLES.HR_ADMIN), onboarding.nextCode);
router.get('/onboarding', onboarding.overview);
router.patch('/onboarding/:taskId', onboarding.updateTask);
router.get('/', controller.list);
router.get('/:id', controller.getOne);
router.get('/:id/onboarding', onboarding.checklist);
router.get('/:id/personnel-file', personnelFile.get);
router.get('/:id/downloads/:kind', downloads.download);
router.put('/:id/personnel-file', authorize(ROLES.HR_ADMIN), personnelFile.saveDetails);
router.post('/:id/personnel-file/:list', authorize(ROLES.HR_ADMIN), personnelFile.addEntry);
router.delete('/:id/personnel-file/:list/:entryId', authorize(ROLES.HR_ADMIN), personnelFile.removeEntry);
router.post('/:id/onboarding', authorize(ROLES.HR_ADMIN), onboarding.start);

router.patch('/assignments/:id/status', controller.decideAssignment);
router.patch('/bank/:bankId/status', controller.decideBank);
router.patch('/statutory/:statId/status', controller.decideStatutory);

router.post('/import', authorize(ROLES.HR_ADMIN), controller.importEmployees);
router.post('/onboard', authorize(ROLES.HR_ADMIN), onboarding.onboard);
router.post('/', authorize(ROLES.HR_ADMIN), controller.create);
router.patch('/:id', controller.update);
router.delete('/:id', authorize(ROLES.HR_ADMIN), controller.remove);

router.post('/:id/separate', authorize(ROLES.HR_ADMIN), controller.separate);
router.post('/:id/rehire', authorize(ROLES.HR_ADMIN), controller.rehire);
router.post('/:id/family', controller.saveFamily);
router.post('/:id/addresses', controller.saveAddress);
router.post('/:id/qualifications', controller.saveQualification);
router.post('/:id/experience', controller.saveExperience);
router.post('/:id/rewards', authorize(ROLES.HR_ADMIN), controller.saveReward);
router.post('/:id/documents', controller.saveDocument);
router.post('/:id/documents/:docId/file', express.raw({ type: () => true, limit: '6mb' }), controller.uploadDocumentFile);
router.get('/:id/documents/:docId/file', controller.downloadDocumentFile);
router.post('/:id/bank', controller.saveBank);
router.post('/:id/statutory', authorize(ROLES.HR_ADMIN), controller.saveStatutory);

module.exports = router;
