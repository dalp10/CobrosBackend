// src/controllers/deudores.controller.js
const { query } = require('../config/db');
const logger = require('../config/logger');

// GET /deudores — lista con resumen financiero (una fila por persona; agrupa duplicados por nombre+apellidos)
const DEUDORES_LIMIT_MAX = 200;

const getAll = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limitRaw = parseInt(req.query.limit) || DEUDORES_LIMIT_MAX;
  const limit = Math.min(Math.max(1, limitRaw), DEUDORES_LIMIT_MAX);
  const offset = (page - 1) * limit;

  try {
    const { rows } = await query(`
      WITH pagos_por_deudor AS (
        SELECT deudor_id, SUM(monto) AS total_pagado, MAX(fecha_pago) AS ultimo_pago
        FROM pagos GROUP BY deudor_id
      ),
      prestamos_por_deudor AS (
        SELECT deudor_id, SUM(monto_original) AS total_prestado, COUNT(*) AS num_prestamos
        FROM prestamos GROUP BY deudor_id
      )
      SELECT
        MIN(d.id) AS id,
        d.nombre,
        d.apellidos,
        MAX(d.dni) AS dni,
        MAX(d.telefono) AS telefono,
        MAX(d.email) AS email,
        MAX(d.direccion) AS direccion,
        MAX(d.notas) AS notas,
        BOOL_OR(d.activo) AS activo,
        MIN(d.created_at) AS created_at,
        MIN(d.updated_at) AS updated_at,
        COALESCE(SUM(ppd.total_pagado), 0) AS total_pagado,
        COALESCE(SUM(prd.total_prestado), 0) AS total_prestado,
        COALESCE(SUM(prd.total_prestado), 0) - COALESCE(SUM(ppd.total_pagado), 0) AS saldo_pendiente,
        COALESCE(SUM(prd.num_prestamos), 0)::int AS total_prestamos,
        MAX(ppd.ultimo_pago) AS ultimo_pago
      FROM deudores d
      LEFT JOIN pagos_por_deudor ppd ON ppd.deudor_id = d.id
      LEFT JOIN prestamos_por_deudor prd ON prd.deudor_id = d.id
      WHERE d.activo = true
      GROUP BY d.nombre, d.apellidos
      ORDER BY d.apellidos, d.nombre
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const { rows: [{ total }] } = await query(`
      SELECT COUNT(*) AS total FROM (
        SELECT 1 FROM deudores WHERE activo = true GROUP BY nombre, apellidos
      ) t
    `);

    res.json({ data: rows, total: parseInt(total), page, limit });
  } catch (err) {
    logger.error({ err });
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

    // Sus préstamos (con totales pagados, saldo pendiente y desglose capital/interés)
    const { rows: prestamos } = await query(`
      SELECT
        pr.*,
        COALESCE(SUM(p.monto), 0) AS total_pagado,
        COALESCE(
          (SELECT SUM(c.monto_esperado) FROM cuotas c WHERE c.prestamo_id = pr.id),
          pr.monto_original
        ) - COALESCE(SUM(p.monto), 0) AS saldo_pendiente,
        pr.monto_original - (
          SELECT COALESCE(SUM(c.monto_capital * c.monto_pagado / NULLIF(c.monto_esperado, 0)), 0)
          FROM cuotas c WHERE c.prestamo_id = pr.id
        ) AS saldo_capital,
        (SELECT COALESCE(SUM(c.monto_interes), 0) FROM cuotas c WHERE c.prestamo_id = pr.id) AS interes_total,
        (
          SELECT COALESCE(SUM(c.monto_interes * c.monto_pagado / NULLIF(c.monto_esperado, 0)), 0)
          FROM cuotas c WHERE c.prestamo_id = pr.id
        ) AS interes_pagado
      FROM prestamos pr
      LEFT JOIN pagos p ON p.prestamo_id = pr.id
      WHERE pr.deudor_id = $1
      GROUP BY pr.id
      ORDER BY pr.fecha_inicio DESC
    `, [id]);

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

    const total_prestado = prestamos.reduce((s, p) => s + +(p.monto_original ?? 0), 0);
    const total_pagado = +resumen.total_pagado;
    const saldo_pendiente = prestamos.reduce((s, p) => s + +(p.saldo_pendiente ?? 0), 0);

    res.json({ ...deudor, total_prestado, total_pagado, saldo_pendiente, prestamos, pagos, resumen });
  } catch (err) {
    logger.error({ err });
    res.status(500).json({ error: 'Error al obtener deudor' });
  }
};

// POST /deudores
const create = async (req, res) => {
  const { nombre, apellidos, dni, telefono, email, direccion, notas, fecha_compromiso_pago, monto_compromiso_pago, notas_compromiso } = req.body;
  if (!nombre || !apellidos)
    return res.status(400).json({ error: 'Nombre y apellidos son requeridos' });
  try {
    const { rows: [row] } = await query(`
      INSERT INTO deudores (nombre, apellidos, dni, telefono, email, direccion, notas, fecha_compromiso_pago, monto_compromiso_pago, notas_compromiso)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *
    `, [nombre, apellidos, dni||null, telefono||null, email||null, direccion||null, notas||null, fecha_compromiso_pago||null, monto_compromiso_pago||null, notas_compromiso||null]);
    res.status(201).json(row);
  } catch (err) {
    logger.error({ err });
    res.status(500).json({ error: 'Error al crear deudor' });
  }
};

// PUT /deudores/:id
const update = async (req, res) => {
  const { id } = req.params;
  const body = req.body;
  const updates = [];
  const values = [];
  const optionalNullables = ['dni', 'telefono', 'email', 'direccion', 'notas', 'fecha_compromiso_pago', 'monto_compromiso_pago', 'notas_compromiso'];
  let i = 1;
  const set = (key, val) => {
    updates.push(`${key}=$${i}`);
    values.push(val);
    i++;
  };
  if (body.nombre !== undefined) set('nombre', body.nombre);
  if (body.apellidos !== undefined) set('apellidos', body.apellidos);
  for (const key of optionalNullables) {
    if (!body.hasOwnProperty(key)) continue;
    const val = body[key];
    if (key === 'monto_compromiso_pago' && val != null && val !== '') {
      set(key, parseFloat(val));
    } else {
      set(key, val === '' || val === null ? null : val);
    }
  }
  if (body.activo !== undefined) set('activo', body.activo);
  if (updates.length === 0) return res.status(400).json({ error: 'No hay campos para actualizar' });
  values.push(id);
  try {
    const { rows: [row] } = await query(
      `UPDATE deudores SET ${updates.join(', ')}, updated_at = NOW() WHERE id=$${i} RETURNING *`,
      values
    );
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    res.json(row);
  } catch (err) {
    logger.error({ err });
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
