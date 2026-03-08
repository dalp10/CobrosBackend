// src/validators/prestamos.validator.js
const { body } = require('express-validator');

const TIPOS = ['prestamo_personal', 'prestamo_bancario', 'pandero', 'otro'];
const ESTADOS = ['activo', 'pagado', 'vencido', 'cancelado'];

const createPrestamoValidations = [
  body('deudor_id')
    .notEmpty()
    .withMessage('deudor_id requerido')
    .isInt({ min: 1 })
    .withMessage('deudor_id debe ser un entero positivo'),
  body('tipo')
    .notEmpty()
    .withMessage('tipo requerido')
    .isIn(TIPOS)
    .withMessage(`tipo debe ser uno de: ${TIPOS.join(', ')}`),
  body('monto_original')
    .notEmpty()
    .withMessage('monto_original requerido')
    .isFloat({ min: 0.01 })
    .withMessage('monto_original debe ser un número positivo'),
  body('fecha_inicio')
    .notEmpty()
    .withMessage('fecha_inicio requerido')
    .isISO8601()
    .withMessage('fecha_inicio debe ser una fecha válida (ISO 8601)'),
  body('descripcion').optional().trim().isLength({ max: 255 }),
  body('tasa_interes').optional().isFloat({ min: 0 }),
  body('total_cuotas').optional().isInt({ min: 1 }),
  body('cuota_mensual').optional().isFloat({ min: 0 }),
  body('fecha_fin').optional().isISO8601(),
  body('banco').optional().trim().isLength({ max: 100 }),
  body('numero_operacion').optional().trim().isLength({ max: 50 }),
  body('notas').optional().trim().isLength({ max: 500 }),
];

const updateEstadoValidations = [
  body('estado')
    .notEmpty()
    .withMessage('estado requerido')
    .isIn(ESTADOS)
    .withMessage(`estado debe ser uno de: ${ESTADOS.join(', ')}`),
];

module.exports = { createPrestamoValidations, updateEstadoValidations };
