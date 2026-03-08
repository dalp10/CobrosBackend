// src/middleware/validate.js
const { validationResult } = require('express-validator');

const validate = (validations) => async (req, res, next) => {
  await Promise.all(validations.map((v) => v.run(req)));
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  return res.status(400).json({
    error: 'Error de validación',
    errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
  });
};

module.exports = validate;
