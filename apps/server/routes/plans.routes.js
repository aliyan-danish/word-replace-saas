const express = require('express');
const { listPublicPlans } = require('../controllers/plans.controller');

const router = express.Router();

// GET /api/plans — public, no JWT. Landing page reads live Free/Pro limits here.
router.get('/', listPublicPlans);

module.exports = router;
