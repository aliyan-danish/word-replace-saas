const express = require('express');
const { register, login } = require('../controllers/auth.controller');

const router = express.Router();

// Routes are relative to the /auth mount point in index.js.
router.post('/register', register);
router.post('/login', login);

module.exports = router;
