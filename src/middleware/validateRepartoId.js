// src/middleware/validateRepartoId.js
// Valida que reparto_id (query o body) exista en reparto_grupos cuando se envía.
const { query } = require('../config/db');

async function validateRepartoId(req, res, next) {
  const repartoIdRaw = req.query.reparto_id ?? req.body?.reparto_id;
  if (repartoIdRaw === undefined || repartoIdRaw === null || repartoIdRaw === '') return next();
  const repartoId = parseInt(repartoIdRaw, 10);
  if (Number.isNaN(repartoId) || repartoId < 1)
    return res.status(400).json({ error: 'reparto_id debe ser un entero mayor o igual a 1' });
  try {
    const { rows } = await query('SELECT id FROM reparto_grupos WHERE id = $1', [repartoId]);
    if (rows.length === 0)
      return res.status(404).json({ error: 'Reparto no encontrado' });
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al validar reparto' });
  }
}

module.exports = { validateRepartoId };
