// src/routes/deudores.routes.js
const router = require('express').Router();
const ctrl   = require('../controllers/deudores.controller');
const auth   = require('../middleware/auth');

router.use(auth);
router.get('/',     ctrl.getAll);
router.get('/:id',  ctrl.getById);
router.post('/',    ctrl.create);
router.put('/:id',  ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;


// ─────────────────────────────────────────────
// Pega esto en src/routes/pagos.routes.js
// ─────────────────────────────────────────────
/*
const router = require('express').Router();
const ctrl   = require('../controllers/pagos.controller');
const auth   = require('../middleware/auth');
const upload = require('../middleware/upload');

router.use(auth);
router.get('/resumen', ctrl.resumen);
router.get('/',        ctrl.getAll);
router.post('/',       upload.single('imagen'), ctrl.create);
router.put('/:id',     ctrl.update);
router.delete('/:id',  ctrl.remove);

module.exports = router;
*/
