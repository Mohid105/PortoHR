'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many sign-in attempts, please try again later' },
});

router.post('/', loginLimiter, controller.login);
router.post('/login', loginLimiter, controller.login);
router.post('/logout', authenticate, controller.logout);
router.get('/me', authenticate, controller.me);
router.post('/change-password', authenticate, controller.changePassword);
router.post('/logout-all', authenticate, controller.logoutAll);
router.get('/activity', authenticate, controller.activity);

module.exports = router;
