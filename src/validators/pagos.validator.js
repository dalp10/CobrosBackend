// src/validators/pagos.validator.js
const { body } = require('express-validator');

const METODOS_PAGO = ['efectivo', 'transferencia', 'yape', 'plin', 'pandero', 'otro'];

const createPagoValidations = [
  body('deudor_id')
    .notEmpty()
    .withMessage('deudor_id requerido')
    .isInt({ min: 1 })
    .withMessage('deudor_id debe ser un número entero positivo'),
  body('fecha_pago')
    .notEmpty()
    .withMessage('fecha_pago requerido')
    .isISO8601()
    .withMessage('fecha_pago debe ser una fecha válida (ISO 8601)'),
  body('monto')
    .notEmpty()
    .withMessage('monto requerido')
    .isFloat({ min: 0.01 })
    .withMessage('monto debe ser un número positivo'),
  body('metodo_pago')
    .notEmpty()
    .withMessage('metodo_pago requerido')
    .isIn(METODOS_PAGO)
    .withMessage(`metodo_pago debe ser uno de: ${METODOS_PAGO.join(', ')}`),
  body('prestamo_id').optional().isInt({ min: 1 }),
  body('cuota_id').optional().isInt({ min: 1 }),
  body('numero_operacion').optional().trim().isLength({ max: 50 }),
  body('banco_origen').optional().trim().isLength({ max: 100 }),
  body('concepto').optional().trim().isLength({ max: 255 }),
  body('notas').optional().trim().isLength({ max: 500 }),
];

const updatePagoValidations = [
  body('fecha_pago').optional().isISO8601().withMessage('fecha_pago debe ser una fecha válida'),
  body('monto').optional().isFloat({ min: 0.01 }).withMessage('monto debe ser positivo'),
  body('metodo_pago').optional().isIn(METODOS_PAGO).withMessage(`metodo_pago debe ser uno de: ${METODOS_PAGO.join(', ')}`),
  body('numero_operacion').optional().trim().isLength({ max: 50 }),
  body('banco_origen').optional().trim().isLength({ max: 100 }),
  body('concepto').optional().trim().isLength({ max: 255 }),
  body('notas').optional().trim().isLength({ max: 500 }),
  body('remove_imagen').optional().isIn(['true', 'false']),
];

module.exports = { createPagoValidations, updatePagoValidations };
