// src/routes/auth.routes.js
const router = require('express').Router();
const { login, me } = require('../controllers/auth.controller');
const auth = require('../middleware/auth');

router.post('/login', login);
router.get('/me', auth, me);

module.exports = router;
