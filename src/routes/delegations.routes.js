'use strict';

const express = require('express');
const controller = require('../controllers/admin.controller');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);
router.get('/', controller.myDelegations);
router.post('/', controller.createMyDelegation);
router.patch('/:id/cancel', controller.cancelMyDelegation);

module.exports = router;
