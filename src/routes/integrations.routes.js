'use strict';

const express = require('express');
const controller = require('../controllers/integrations.controller');

const router = express.Router();

router.post('/inbox', controller.receiveInbox);

module.exports = router;
