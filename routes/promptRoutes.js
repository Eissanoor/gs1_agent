const express = require('express');
const router = express.Router();
const { handlePrompt } = require('../controllers/promptControllerv3');

router.post('/prompt', handlePrompt);

module.exports = router;
