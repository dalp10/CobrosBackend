// src/routes/alertas.routes.js
const router = require('express').Router();
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/alertas.controller');
const { enviarWhatsAppValidations } = require('../validators/alertas.validator');

router.use(auth);
router.get('/mora', ctrl.getMora);
router.get('/proximas', ctrl.getProximas);
router.post('/whatsapp', enviarWhatsAppValidations, validate(enviarWhatsAppValidations), ctrl.enviarWhatsApp);

module.exports = router;
