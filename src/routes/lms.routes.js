'use strict';

const express = require('express');
const controller = require('../controllers/lms.controller');
const { authenticate, requireModule } = require('../middleware/auth');
const { MODULES } = require('../config/roles');

const router = express.Router();

router.use(authenticate, requireModule(MODULES.LMS));

router.get('/meta', controller.meta);
router.get('/me', controller.myLearning);
router.get('/compliance', controller.compliance);
router.get('/team', controller.teamLearners);

router.get('/courses', controller.listCourses);
router.post('/courses', controller.createCourse);
router.patch('/courses/:id', controller.updateCourse);

router.get('/sessions', controller.listSessions);
router.post('/sessions', controller.createSession);

router.get('/enrollments', controller.listEnrollments);
router.post('/enrollments', controller.createEnrollment);
router.patch('/enrollments/:id/status', controller.decideEnrollment);
router.post('/enrollments/:id/attend', controller.markAttendance);
router.post('/enrollments/:id/complete', controller.completeEnrollment);
router.post('/enrollments/:id/cancel', controller.cancelEnrollment);

module.exports = router;
