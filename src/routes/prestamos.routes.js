// src/routes/prestamos.routes.js
const router = require('express').Router();
const ctrl = require('../controllers/prestamos.controller');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { validateParamId } = require('../middleware/validateParamId');
const { createPrestamoValidations, updateEstadoValidations, updatePrestamoValidations, reprogramarValidations } = require('../validators/prestamos.validator');

router.use(auth);
router.get('/', ctrl.getAll);
router.get('/:id', validateParamId, ctrl.getById);
router.get('/:id/cuotas', validateParamId, ctrl.getCuotas);
router.post('/', createPrestamoValidations, validate(createPrestamoValidations), ctrl.create);
router.patch('/:id/estado', validateParamId, updateEstadoValidations, validate(updateEstadoValidations), ctrl.updateEstado);
router.patch('/:id/reprogramar', validateParamId, reprogramarValidations, validate(reprogramarValidations), ctrl.reprogramar);
router.patch('/:id', validateParamId, updatePrestamoValidations, validate(updatePrestamoValidations), ctrl.update);

module.exports = router;
