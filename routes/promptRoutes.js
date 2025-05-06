const express = require('express');
const router = express.Router();
const { handlePrompt } = require('../controllers/promptController');

router.post('/prompt', handlePrompt);

module.exports = router;
