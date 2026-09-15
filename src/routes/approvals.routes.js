'use strict';

const express = require('express');
const controller = require('../controllers/approvals.controller');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);
router.get('/', controller.inbox);

module.exports = router;
