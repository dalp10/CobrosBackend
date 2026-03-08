// src/middleware/validateParamId.js
const { param, validationResult } = require('express-validator');

const idParamValidations = [param('id').isInt({ min: 1 }).withMessage('ID debe ser un entero positivo')];

async function validateParamId(req, res, next) {
  await Promise.all(idParamValidations.map((v) => v.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(400).json({ error: 'ID inválido', errors: errors.array().map((e) => ({ field: e.path, message: e.msg })) });
  next();
}

module.exports = { validateParamId };
