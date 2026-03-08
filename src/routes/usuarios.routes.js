const router = require('express').Router();
const auth = require('../middleware/auth');
const { validateParamId } = require('../middleware/validateParamId');
const validate = require('../middleware/validate');
const { createUsuarioValidations, updateUsuarioValidations, changePasswordValidations } = require('../validators/usuarios.validator');
const { getAll, create, update, changePassword } = require('../controllers/usuarios.controller');

router.get('/', auth, getAll);
router.post('/', auth, createUsuarioValidations, validate(createUsuarioValidations), create);
router.put('/:id', auth, validateParamId, updateUsuarioValidations, validate(updateUsuarioValidations), update);
router.put('/:id/password', auth, validateParamId, changePasswordValidations, validate(changePasswordValidations), changePassword);

module.exports = router;
