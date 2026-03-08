// src/validators/usuarios.validator.js
const { body } = require('express-validator');

const ROLES = ['admin', 'usuario', 'viewer'];

const createUsuarioValidations = [
  body('nombre')
    .trim()
    .notEmpty()
    .withMessage('Nombre requerido')
    .isLength({ max: 100 })
    .withMessage('Nombre demasiado largo'),
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email requerido')
    .isEmail()
    .withMessage('Email inválido')
    .isLength({ max: 150 }),
  body('password')
    .notEmpty()
    .withMessage('Contraseña requerida')
    .isLength({ min: 6 })
    .withMessage('La contraseña debe tener al menos 6 caracteres'),
  body('rol').optional().isIn(ROLES).withMessage(`rol debe ser uno de: ${ROLES.join(', ')}`),
];

const updateUsuarioValidations = [
  body('nombre').optional().trim().notEmpty().isLength({ max: 100 }),
  body('email').optional().trim().isEmail().withMessage('Email inválido').isLength({ max: 150 }),
  body('rol').optional().isIn(ROLES).withMessage(`rol debe ser uno de: ${ROLES.join(', ')}`),
  body('activo').optional().isBoolean(),
];

const changePasswordValidations = [
  body('password_nuevo')
    .notEmpty()
    .withMessage('password_nuevo requerido')
    .isLength({ min: 6 })
    .withMessage('La nueva contraseña debe tener al menos 6 caracteres'),
  body('password_actual').optional().trim(),
];

module.exports = { createUsuarioValidations, updateUsuarioValidations, changePasswordValidations };
