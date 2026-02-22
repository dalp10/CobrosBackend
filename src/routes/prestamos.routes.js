// src/routes/prestamos.routes.js
const router = require('express').Router();
const ctrl   = require('../controllers/prestamos.controller');
const auth   = require('../middleware/auth');

router.use(auth);
router.get('/',              ctrl.getAll);
router.get('/:id',           ctrl.getById);
router.get('/:id/cuotas',    ctrl.getCuotas);
router.post('/',             ctrl.create);
router.patch('/:id/estado',  ctrl.updateEstado);

module.exports = router;
