// src/routes/pagos.routes.js
const router = require('express').Router();
const ctrl = require('../controllers/pagos.controller');
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');
const validate = require('../middleware/validate');
const { validateParamId } = require('../middleware/validateParamId');
const { createPagoValidations, updatePagoValidations } = require('../validators/pagos.validator');

router.use(auth);
router.get('/resumen', ctrl.resumen);
router.get('/', ctrl.getAll);
router.post('/', upload.single('imagen'), createPagoValidations, validate(createPagoValidations), ctrl.create);
router.put('/:id', validateParamId, upload.single('imagen'), updatePagoValidations, validate(updatePagoValidations), ctrl.update);
router.delete('/:id', validateParamId, ctrl.remove);

module.exports = router;
