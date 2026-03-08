// src/validators/alertas.validator.js
const { body } = require('express-validator');

const enviarWhatsAppValidations = [
  body('mensaje').optional().trim().isLength({ max: 1600 }).withMessage('mensaje máximo 1600 caracteres'),
  body('telefono').optional().trim(),
  body('deudor_id').optional().isInt({ min: 1 }).withMessage('deudor_id debe ser un entero positivo'),
];

module.exports = { enviarWhatsAppValidations };
