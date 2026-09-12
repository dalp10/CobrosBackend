// src/routes/deudores.routes.js
const router = require('express').Router();
const ctrl = require('../controllers/deudores.controller');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { validateParamId } = require('../middleware/validateParamId');
const { createDeudorValidations, updateDeudorValidations } = require('../validators/deudores.validator');

router.use(auth);

/**
 * @openapi
 * /deudores:
 *   get:
 *     tags: [Deudores]
 *     summary: Listar deudores (paginado)
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Lista paginada de deudores
 *       401:
 *         description: No autenticado
 *   post:
 *     tags: [Deudores]
 *     summary: Crear deudor
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nombre, apellidos]
 *             properties:
 *               nombre: { type: string }
 *               apellidos: { type: string }
 *               telefono: { type: string }
 *               notas: { type: string }
 *     responses:
 *       201:
 *         description: Deudor creado
 *       400:
 *         description: Datos inválidos
 */
router.get('/', ctrl.getAll);
router.post('/', createDeudorValidations, validate(createDeudorValidations), ctrl.create);

/**
 * @openapi
 * /deudores/{id}:
 *   get:
 *     tags: [Deudores]
 *     summary: Obtener un deudor por id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Deudor encontrado
 *       404:
 *         description: No encontrado
 *   put:
 *     tags: [Deudores]
 *     summary: Actualizar un deudor
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nombre: { type: string }
 *               apellidos: { type: string }
 *               telefono: { type: string }
 *               notas: { type: string }
 *               activo: { type: boolean }
 *     responses:
 *       200:
 *         description: Deudor actualizado
 *       404:
 *         description: No encontrado
 *   delete:
 *     tags: [Deudores]
 *     summary: Eliminar un deudor
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       204:
 *         description: Eliminado
 *       404:
 *         description: No encontrado
 */
router.get('/:id', validateParamId, ctrl.getById);
router.put('/:id', validateParamId, updateDeudorValidations, validate(updateDeudorValidations), ctrl.update);
router.delete('/:id', validateParamId, ctrl.remove);

module.exports = router;
