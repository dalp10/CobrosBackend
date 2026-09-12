// src/validators/deudores.validator.js
const { body } = require('express-validator');

const createDeudorValidations = [
  body('nombre')
    .trim()
    .notEmpty()
    .withMessage('Nombre requerido')
    .isLength({ max: 100 })
    .withMessage('Nombre demasiado largo'),
  body('apellidos')
    .trim()
    .notEmpty()
    .withMessage('Apellidos requeridos')
    .isLength({ max: 100 })
    .withMessage('Apellidos demasiado largos'),
  body('dni').optional().trim().isLength({ max: 20 }),
  body('telefono').optional().trim().isLength({ max: 30 }),
  body('email').optional().trim().isEmail().withMessage('Email inválido'),
  body('direccion').optional().trim().isLength({ max: 255 }),
  body('notas').optional().trim().isLength({ max: 500 }),
  body('fecha_compromiso_pago').optional().isISO8601().withMessage('Fecha de compromiso inválida'),
  body('monto_compromiso_pago').optional().isFloat({ min: 0 }).withMessage('Monto de compromiso debe ser ≥ 0'),
  body('notas_compromiso').optional().trim().isLength({ max: 500 }),
];

const updateDeudorValidations = [
  body('nombre').optional().trim().notEmpty().isLength({ max: 100 }),
  body('apellidos').optional().trim().notEmpty().isLength({ max: 100 }),
  body('dni').optional().trim().isLength({ max: 20 }),
  body('telefono').optional().trim().isLength({ max: 30 }),
  body('email').optional().trim().isEmail().withMessage('Email inválido'),
  body('direccion').optional().trim().isLength({ max: 255 }),
  body('notas').optional().trim().isLength({ max: 500 }),
  body('activo').optional().isBoolean(),
  body('fecha_compromiso_pago').optional().isISO8601().withMessage('Fecha de compromiso inválida'),
  body('monto_compromiso_pago').optional().isFloat({ min: 0 }).withMessage('Monto de compromiso debe ser ≥ 0'),
  body('notas_compromiso').optional().trim().isLength({ max: 500 }),
];

module.exports = { createDeudorValidations, updateDeudorValidations };
