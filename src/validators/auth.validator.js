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

module.exports = { loginValidations };
