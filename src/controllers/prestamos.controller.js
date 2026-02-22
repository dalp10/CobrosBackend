// src/controllers/prestamos.controller.js
const { query } = require('../config/db');

// GET /prestamos?deudor_id=
const getAll = async (req, res) => {
  const { deudor_id } = req.query;
  try {
    const { rows } = await query(`
      SELECT
        pr.*,
        d.nombre || ' ' || d.apellidos AS deudor_nombre,
        COALESCE(SUM(p.monto), 0)      AS total_pagado,
        pr.monto_original - COALESCE(SUM(p.monto), 0) AS saldo_pendiente,
        COUNT(DISTINCT c.id) FILTER (WHERE c.estado = 'pagado')   AS cuotas_pagadas,
        COUNT(DISTINCT c.id) FILTER (WHERE c.estado != 'pagado')  AS cuotas_pendientes
      FROM prestamos pr
      JOIN deudores d    ON d.id = pr.deudor_id
      LEFT JOIN pagos p  ON p.prestamo_id = pr.id
      LEFT JOIN cuotas c ON c.prestamo_id = pr.id
      ${deudor_id ? 'WHERE pr.deudor_id = $1' : ''}
      GROUP BY pr.id, d.nombre, d.apellidos
      ORDER BY pr.fecha_inicio DESC
    `, deudor_id ? [deudor_id] : []);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener préstamos' });
  }
};

// GET /prestamos/:id — con cuotas
const getById = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows: [prestamo] } = await query(
      `SELECT pr.*, d.nombre || ' ' || d.apellidos AS deudor_nombre
       FROM prestamos pr JOIN deudores d ON d.id = pr.deudor_id
       WHERE pr.id = $1`, [id]
    );
    if (!prestamo) return res.status(404).json({ error: 'Préstamo no encontrado' });

    const { rows: cuotas } = await query(
      'SELECT * FROM cuotas WHERE prestamo_id = $1 ORDER BY numero_cuota', [id]
    );

    const { rows: pagos } = await query(
      'SELECT * FROM pagos WHERE prestamo_id = $1 ORDER BY fecha_pago DESC', [id]
    );

    res.json({ ...prestamo, cuotas, pagos });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener préstamo' });
  }
};

// POST /prestamos
const create = async (req, res) => {
  const {
    deudor_id, tipo, descripcion, monto_original, tasa_interes,
    total_cuotas, cuota_mensual, fecha_inicio, fecha_fin,
    banco, numero_operacion, notas
  } = req.body;

  if (!deudor_id || !tipo || !monto_original || !fecha_inicio)
    return res.status(400).json({ error: 'Faltan campos requeridos' });

  try {
    const { rows: [row] } = await query(`
      INSERT INTO prestamos
        (deudor_id, tipo, descripcion, monto_original, tasa_interes,
         total_cuotas, cuota_mensual, fecha_inicio, fecha_fin,
         banco, numero_operacion, notas)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *
    `, [deudor_id, tipo, descripcion, monto_original, tasa_interes||0,
        total_cuotas||1, cuota_mensual||null, fecha_inicio, fecha_fin||null,
        banco||null, numero_operacion||null, notas||null]);
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear préstamo' });
  }
};

// PUT /prestamos/:id/estado
const updateEstado = async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;
  try {
    const { rows: [row] } = await query(
      'UPDATE prestamos SET estado = $1 WHERE id = $2 RETURNING *',
      [estado, id]
    );
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar estado' });
  }
};

// GET /prestamos/:id/cuotas
const getCuotas = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await query(
      'SELECT * FROM cuotas WHERE prestamo_id = $1 ORDER BY numero_cuota', [id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener cuotas' });
  }
};

module.exports = { getAll, getById, create, updateEstado, getCuotas };
