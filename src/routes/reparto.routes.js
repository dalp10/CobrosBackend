// src/routes/reparto.routes.js
const router = require('express').Router();
const path = require('path');
const multer = require('multer');
const auth = require('../middleware/auth');
const { validateParamId } = require('../middleware/validateParamId');
const { validateRepartoId } = require('../middleware/validateRepartoId');
const ctrl = require('../controllers/reparto.controller');
const ctrlExtra = require('../controllers/reparto-extra.controller');

const upload = multer({
  dest: path.join(process.cwd(), 'uploads', 'tmp'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

router.use(auth);
router.use(validateRepartoId);

router.get('/resumen', ctrl.getResumen);
router.get('/miembros', ctrl.getMiembros);
router.post('/miembros', ctrl.createMiembro);
router.put('/miembros/:id', validateParamId, ctrl.updateMiembro);
router.delete('/miembros/:id', validateParamId, ctrl.deleteMiembro);
router.get('/gastos', ctrl.getGastos);
router.post('/gastos', ctrl.createGasto);
router.put('/gastos/:id', validateParamId, ctrl.updateGasto);
router.delete('/gastos/:id', validateParamId, ctrl.deleteGasto);
router.get('/reembolsos', ctrl.getReembolsos);
router.post('/reembolsos', ctrl.createReembolso);
router.put('/reembolsos/:id', validateParamId, ctrl.updateReembolso);
router.delete('/reembolsos/:id', validateParamId, ctrl.deleteReembolso);
router.get('/reembolsos/:id/adjuntos', validateParamId, ctrlExtra.getAdjuntosReembolso);
router.post('/reembolsos/:id/adjuntos', validateParamId, upload.single('archivo'), ctrlExtra.uploadAdjuntoReembolso);
router.delete('/reembolso-adjuntos/:id', validateParamId, ctrlExtra.deleteAdjuntoReembolso);
router.get('/reembolso-adjuntos/:id/descargar', validateParamId, ctrlExtra.descargarAdjuntoReembolso);
router.get('/reportes/exportar', (req, res) => {
  if ((req.query.formato || '').toLowerCase() === 'xlsx')
    return ctrlExtra.exportarReporteExcel(req, res);
  return ctrl.exportarReporte(req, res);
});

router.get('/categorias', ctrlExtra.getCategorias);
router.post('/categorias', ctrlExtra.createCategoria);
router.put('/categorias/:id', validateParamId, ctrlExtra.updateCategoria);
router.delete('/categorias/:id', validateParamId, ctrlExtra.deleteCategoria);
router.get('/pendientes', ctrlExtra.getPendientes);
router.get('/presupuestos', ctrlExtra.getPresupuestos);
router.post('/presupuestos', ctrlExtra.createPresupuesto);
router.put('/presupuestos/:id', validateParamId, ctrlExtra.updatePresupuesto);
router.delete('/presupuestos/:id', validateParamId, ctrlExtra.deletePresupuesto);
router.post('/gastos/:id/repetir-mes', validateParamId, ctrlExtra.repetirGastoMes);
router.get('/gastos/:id/adjuntos', validateParamId, ctrlExtra.getAdjuntos);
router.post('/gastos/:id/adjuntos', validateParamId, upload.single('archivo'), ctrlExtra.uploadAdjunto);
router.delete('/adjuntos/:id', validateParamId, ctrlExtra.deleteAdjunto);
router.get('/adjuntos/:id/descargar', validateParamId, ctrlExtra.descargarAdjunto);
router.get('/grupos', ctrlExtra.getGrupos);
router.post('/grupos', ctrlExtra.createGrupo);

module.exports = router;
