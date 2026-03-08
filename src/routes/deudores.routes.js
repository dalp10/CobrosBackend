// src/routes/deudores.routes.js
const router = require('express').Router();
const ctrl = require('../controllers/deudores.controller');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { validateParamId } = require('../middleware/validateParamId');
const { createDeudorValidations, updateDeudorValidations } = require('../validators/deudores.validator');

router.use(auth);
router.get('/', ctrl.getAll);
router.get('/:id', validateParamId, ctrl.getById);
router.post('/', createDeudorValidations, validate(createDeudorValidations), ctrl.create);
router.put('/:id', validateParamId, updateDeudorValidations, validate(updateDeudorValidations), ctrl.update);
router.delete('/:id', validateParamId, ctrl.remove);

module.exports = router;
