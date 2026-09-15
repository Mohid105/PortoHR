'use strict';

const express = require('express');
const controller = require('../controllers/assets.controller');
const { authenticate, requireModule } = require('../middleware/auth');
const { MODULES } = require('../config/roles');

const router = express.Router();

router.use(authenticate, requireModule(MODULES.ASSETS));

router.get('/meta', controller.meta);
router.get('/people', controller.people);
router.get('/export', controller.financeExport);
router.get('/recovery', controller.recovery);
router.post('/scan', controller.scan);

router.get('/assets', controller.listCatalogue);
router.post('/assets', controller.createAsset);
router.post('/assets/:id/retire', controller.retireAsset);

router.get('/assignments', controller.listAssignments);
router.post('/assignments', controller.createAssignment);
router.get('/assignments/:id', controller.getAssignment);
router.post('/assignments/:id/issue', controller.issueAssignment);
router.post('/assignments/:id/acknowledge', controller.acknowledgeAssignment);
router.post('/assignments/:id/return', controller.returnAssignment);
router.post('/assignments/:id/lost', controller.lostAssignment);

router.get('/routes', controller.listRoutes);
router.post('/routes', controller.createRoute);
router.post('/routes/:id/allocate', controller.allocateRoute);
router.post('/routes/:id/allocations/:slotId/cancel', controller.cancelRouteSeat);

router.get('/accommodation', controller.listRooms);
router.post('/accommodation', controller.allocateRoom);
router.post('/accommodation/:id/vacate', controller.vacateRoom);

router.get('/maintenance', controller.listMaintenance);
router.post('/maintenance', controller.createMaintenance);
router.post('/maintenance/:id/schedule', controller.scheduleJob);
router.post('/maintenance/:id/complete', controller.completeJob);

module.exports = router;
