// src/controllers/deudores.controller.js
const { query } = require('../config/db');

// GET /deudores — lista con resumen financiero
const getAll = async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        d.*,
        COALESCE(SUM(p.monto), 0)                          AS total_pagado,
        COALESCE(SUM(pr.monto_original), 0)                AS total_prestado,
        COALESCE(SUM(pr.monto_original), 0)
          - COALESCE(SUM(p.monto), 0)                      AS saldo_pendiente,
        COUNT(DISTINCT pr.id)                              AS total_prestamos,
        MAX(p.fecha_pago)                                  AS ultimo_pago
      FROM deudores d
      LEFT JOIN prestamos pr ON pr.deudor_id = d.id
      LEFT JOIN pagos p      ON p.deudor_id  = d.id
      WHERE d.activo = true
      GROUP BY d.id
      ORDER BY d.apellidos, d.nombre;
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener deudores' });
  }
};

// GET /deudores/:id — detalle completo
const getById = async (req, res) => {
  const { id } = req.params;
  try {
    // Datos del deudor
    const { rows: [deudor] } = await query(
      'SELECT * FROM deudores WHERE id = $1 AND activo = true', [id]
    );
    if (!deudor) return res.status(404).json({ error: 'Deudor no encontrado' });

    // Sus préstamos
    const { rows: prestamos } = await query(
      'SELECT * FROM prestamos WHERE deudor_id = $1 ORDER BY fecha_inicio DESC', [id]
    );

    // Sus pagos
    const { rows: pagos } = await query(`
      SELECT p.*, pr.descripcion AS prestamo_desc
      FROM pagos p
      LEFT JOIN prestamos pr ON pr.id = p.prestamo_id
      WHERE p.deudor_id = $1
      ORDER BY p.fecha_pago DESC
    `, [id]);

    // Resumen financiero
    const { rows: [resumen] } = await query(`
      SELECT
        COALESCE(SUM(monto), 0)     AS total_pagado,
        COUNT(*)                    AS total_pagos
      FROM pagos WHERE deudor_id = $1
    `, [id]);

    res.json({ ...deudor, prestamos, pagos, resumen });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener deudor' });
  }
};

// POST /deudores
const create = async (req, res) => {
  const { nombre, apellidos, dni, telefono, email, direccion, notas } = req.body;
  if (!nombre || !apellidos)
    return res.status(400).json({ error: 'Nombre y apellidos son requeridos' });
  try {
    const { rows: [row] } = await query(`
      INSERT INTO deudores (nombre, apellidos, dni, telefono, email, direccion, notas)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [nombre, apellidos, dni||null, telefono||null, email||null, direccion||null, notas||null]);
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear deudor' });
  }
};

// PUT /deudores/:id
const update = async (req, res) => {
  const { id } = req.params;
  const { nombre, apellidos, dni, telefono, email, direccion, notas, activo } = req.body;
  try {
    const { rows: [row] } = await query(`
      UPDATE deudores SET
        nombre=$1, apellidos=$2, dni=$3, telefono=$4,
        email=$5, direccion=$6, notas=$7, activo=$8
      WHERE id=$9 RETURNING *
    `, [nombre, apellidos, dni, telefono, email, direccion, notas,
        activo !== undefined ? activo : true, id]);
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar' });
  }
};

// DELETE /deudores/:id (soft delete)
const remove = async (req, res) => {
  const { id } = req.params;
  try {
    await query('UPDATE deudores SET activo = false WHERE id = $1', [id]);
    res.json({ message: 'Deudor desactivado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar' });
  }
};

module.exports = { getAll, getById, create, update, remove };
