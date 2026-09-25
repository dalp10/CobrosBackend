// src/validators/auth.validator.js
const { body } = require('express-validator');

const loginValidations = [
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email requerido')
    .isEmail()
    .withMessage('Email inválido'),
  body('password')
    .notEmpty()
    .withMessage('Contraseña requerida'),
];

const forgotPasswordValidations = [
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email requerido')
    .isEmail()
    .withMessage('Email inválido'),
];

const resetPasswordValidations = [
  body('token')
    .notEmpty()
    .withMessage('Token requerido'),
  body('password_nuevo')
    .isLength({ min: 6 })
    .withMessage('La nueva contraseña debe tener al menos 6 caracteres'),
];

module.exports = { loginValidations, forgotPasswordValidations, resetPasswordValidations };
