'use strict';

const express = require('express');
const controller = require('../controllers/attendance.controller');
const { authenticate, authorize, requireModule } = require('../middleware/auth');
const { MODULES, ROLES } = require('../config/roles');

const router = express.Router();
const hr = authorize(ROLES.HR_ADMIN);
const team = authorize(ROLES.HR_ADMIN, ROLES.MANAGER);

router.use(authenticate, requireModule(MODULES.ATTENDANCE));

router.get('/meta', controller.meta);

// Everyone: their own clock and calendar.
router.get('/today', controller.today);
router.post('/clock-in', controller.clockIn);
router.post('/clock-out', controller.clockOut);
router.post('/clock-undo', controller.clockUndo);
router.get('/', controller.month);
router.get('/day', controller.day);

// Corrections: raised by the employee, decided by their approver.
router.get('/requests', controller.listRequests);
router.post('/requests', controller.createRequest);
router.patch('/requests/:id/status', controller.decideRequest);
router.post('/requests/:id/cancel', controller.cancelRequest);

// Managers and HR: the live board and the monthly register for their people.
router.get('/board', team, controller.board);
router.get('/register', team, controller.register);
router.get('/roster', team, controller.listRoster);
router.post('/roster', team, controller.setRoster);

// HR only.
router.patch('/day', hr, controller.markDay);
router.post('/punches', hr, controller.addPunch);
router.delete('/punches/:id', hr, controller.voidPunch);
router.delete('/roster/:id', hr, controller.removeRoster);

router.post('/import', hr, controller.importPunches);
router.get('/import/batches', hr, controller.importBatches);
router.delete('/import/:batch', hr, controller.undoImport);

router.get('/shifts', controller.listShifts);
router.post('/shifts', hr, controller.createShift);
router.patch('/shifts/:id', hr, controller.updateShift);

router.get('/policy', hr, controller.getPolicy);
router.put('/policy', hr, controller.savePolicy);

router.get('/locks', hr, controller.listLocks);
router.get('/locks/:month/readiness', hr, controller.lockReadiness);
router.post('/locks', hr, controller.lockMonth);
router.delete('/locks/:month', hr, controller.unlockMonth);

module.exports = router;
