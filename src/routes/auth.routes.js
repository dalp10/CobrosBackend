// src/routes/auth.routes.js
const router = require('express').Router();
const { login, me } = require('../controllers/auth.controller');
const auth = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimit');
const validate = require('../middleware/validate');
const { loginValidations } = require('../validators/auth.validator');

router.post('/login', loginLimiter, loginValidations, validate(loginValidations), login);
router.get('/me', auth, me);

module.exports = router;
