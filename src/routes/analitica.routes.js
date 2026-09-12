// src/routes/analitica.routes.js
const router = require('express').Router();
const auth = require('../middleware/auth');
const ctrl = require('../controllers/analitica.controller');

router.use(auth);
router.get('/dashboard', ctrl.getDashboard);

module.exports = router;
