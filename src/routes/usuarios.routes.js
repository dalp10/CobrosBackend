const router = require('express').Router();
const auth = require('../middleware/auth');
const { getAll, create, update, changePassword } = require('../controllers/usuarios.controller');

router.get('/',          auth, getAll);
router.post('/',         auth, create);
router.put('/:id',       auth, update);
router.put('/:id/password', auth, changePassword);

module.exports = router;
