// src/controllers/prestamos.controller.js
const { query, getClient } = require('../config/db');
const logger = require('../config/logger');
const { calcularCronograma } = require('../utils/amortizacion');

// GET /prestamos?deudor_id=
const getAll = async (req, res) => {
  const { deudor_id } = req.query;
  try {
    const { rows } = await query(`
      SELECT
        pr.*,
        d.nombre || ' ' || d.apellidos AS deudor_nombre,
        COALESCE(SUM(p.monto), 0)      AS total_pagado,
        COALESCE(
          (SELECT SUM(c.monto_esperado) FROM cuotas c WHERE c.prestamo_id = pr.id),
          pr.monto_original
        ) - COALESCE(SUM(p.monto), 0) AS saldo_pendiente,
        (SELECT COUNT(*) FROM cuotas c WHERE c.prestamo_id = pr.id AND c.estado = 'pagado')  AS cuotas_pagadas,
        (SELECT COUNT(*) FROM cuotas c WHERE c.prestamo_id = pr.id AND c.estado != 'pagado') AS cuotas_pendientes,
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
      JOIN deudores d    ON d.id = pr.deudor_id
      LEFT JOIN pagos p  ON p.prestamo_id = pr.id
      ${deudor_id ? 'WHERE pr.deudor_id = $1' : ''}
      GROUP BY pr.id, d.nombre, d.apellidos
      ORDER BY pr.fecha_inicio DESC
    `, deudor_id ? [deudor_id] : []);
    res.json(rows);
  } catch (err) {
    logger.error({ err });
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

    const capitalAmortizado = cuotas.reduce((s, c) => {
      const esperado = parseFloat(c.monto_esperado) || 0;
      const proporcion = esperado > 0 ? parseFloat(c.monto_pagado) / esperado : 0;
      return s + parseFloat(c.monto_capital || 0) * proporcion;
    }, 0);
    const interesPagado = cuotas.reduce((s, c) => {
      const esperado = parseFloat(c.monto_esperado) || 0;
      const proporcion = esperado > 0 ? parseFloat(c.monto_pagado) / esperado : 0;
      return s + parseFloat(c.monto_interes || 0) * proporcion;
    }, 0);
    const interesTotal = cuotas.reduce((s, c) => s + parseFloat(c.monto_interes || 0), 0);
    const saldo_capital = parseFloat(prestamo.monto_original) - capitalAmortizado;

    const montoTotalEsperado = cuotas.length
      ? cuotas.reduce((s, c) => s + parseFloat(c.monto_esperado), 0)
      : parseFloat(prestamo.monto_original);
    const total_pagado = pagos.reduce((s, p) => s + parseFloat(p.monto), 0);
    const saldo_pendiente = montoTotalEsperado - total_pagado;

    res.json({ ...prestamo, total_pagado, saldo_pendiente, saldo_capital, interes_total: interesTotal, interes_pagado: interesPagado, cuotas, pagos });
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
    logger.error({ err });
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

// PATCH /prestamos/:id — editar préstamo (monto_original, fechas, descripcion, etc.)
const update = async (req, res) => {
  const { id } = req.params;
  const allowed = [
    'estado', 'monto_original', 'fecha_inicio', 'fecha_fin', 'descripcion',
    'tasa_interes', 'total_cuotas', 'cuota_mensual', 'banco', 'numero_operacion', 'notas'
  ];
  const updates = [];
  const values = [];
  let i = 1;
  for (const key of allowed) {
    if (req.body[key] !== undefined && req.body[key] !== null) {
      updates.push(`${key} = $${i}`);
      values.push(key === 'monto_original' || key === 'tasa_interes' || key === 'cuota_mensual'
        ? parseFloat(req.body[key])
        : key === 'total_cuotas'
          ? parseInt(req.body[key], 10)
          : req.body[key]);
      i++;
    }
  }
  if (updates.length === 0)
    return res.status(400).json({ error: 'No se enviaron campos para actualizar' });
  updates.push(`updated_at = NOW()`);
  try {
    const { rows: [row] } = await query(
      `UPDATE prestamos SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
      [...values, id]
    );
    if (!row) return res.status(404).json({ error: 'Préstamo no encontrado' });
    res.json(row);
  } catch (err) {
    logger.error({ err });
    res.status(500).json({ error: 'Error al actualizar préstamo' });
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

// PATCH /prestamos/:id/reprogramar
// Recalcula el cronograma de cuotas pendientes con un nuevo monto de cuota y plazo,
// manteniendo intactas las cuotas ya pagadas.
const reprogramar = async (req, res) => {
  const { id } = req.params;
  const { cuota_mensual, total_cuotas, fecha_inicio } = req.body;

  if (!cuota_mensual || !total_cuotas)
    return res.status(400).json({ error: 'cuota_mensual y total_cuotas son requeridos' });

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows: [prestamo] } = await client.query('SELECT * FROM prestamos WHERE id = $1', [id]);
    if (!prestamo) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Préstamo no encontrado' });
    }

    const { rows: cuotasActuales } = await client.query(
      'SELECT * FROM cuotas WHERE prestamo_id = $1 ORDER BY numero_cuota', [id]
    );
    const cuotasPagadas = cuotasActuales.filter(c => c.estado === 'pagado');
    const cuotasPendientes = cuotasActuales.filter(c => c.estado !== 'pagado');

    let saldoPendiente;
    if (cuotasActuales.length > 0) {
      saldoPendiente = cuotasPendientes.reduce(
        (s, c) => s + (parseFloat(c.monto_esperado) - parseFloat(c.monto_pagado)), 0
      );
    } else {
      const { rows: [{ total_pagado }] } = await client.query(
        `SELECT COALESCE(SUM(monto), 0) AS total_pagado FROM pagos WHERE prestamo_id = $1`, [id]
      );
      saldoPendiente = parseFloat(prestamo.monto_original) - parseFloat(total_pagado);
    }

    await client.query(`DELETE FROM cuotas WHERE prestamo_id = $1 AND estado != 'pagado'`, [id]);

    let fechaBase;
    if (fecha_inicio) {
      fechaBase = new Date(fecha_inicio);
    } else if (cuotasPagadas.length) {
      fechaBase = new Date(cuotasPagadas[cuotasPagadas.length - 1].fecha_vencimiento);
      fechaBase.setMonth(fechaBase.getMonth() + 1);
    } else if (cuotasPendientes.length) {
      fechaBase = new Date(cuotasPendientes[0].fecha_vencimiento);
    } else {
      fechaBase = new Date(prestamo.fecha_inicio);
    }

    const n = parseInt(total_cuotas, 10);
    const cuotaMensual = parseFloat(cuota_mensual);
    const numeroInicial = cuotasPagadas.length + 1;

    const nuevasCuotas = [];
    for (let i = 0; i < n; i++) {
      const fecha = new Date(fechaBase);
      fecha.setMonth(fecha.getMonth() + i);
      const esUltima = i === n - 1;
      const monto = esUltima ? Math.max(0, saldoPendiente - cuotaMensual * (n - 1)) : cuotaMensual;
      nuevasCuotas.push({
        numero_cuota: numeroInicial + i,
        fecha_vencimiento: fecha.toISOString().split('T')[0],
        monto_esperado: Math.round(monto * 100) / 100
      });
    }

    // Saldo de capital pendiente: monto original menos el capital ya amortizado
    // por las cuotas pagadas/parciales, para repartir interés sobre saldos decrecientes.
    const capitalAmortizado = cuotasActuales.reduce((s, c) => {
      const esperado = parseFloat(c.monto_esperado) || 0;
      const proporcion = esperado > 0 ? parseFloat(c.monto_pagado) / esperado : 0;
      return s + parseFloat(c.monto_capital || 0) * proporcion;
    }, 0);
    const saldoCapitalPendiente = parseFloat(prestamo.monto_original) - capitalAmortizado;

    const nuevasCuotasConSplit = calcularCronograma(nuevasCuotas, saldoCapitalPendiente, prestamo.tasa_interes);

    for (const c of nuevasCuotasConSplit) {
      await client.query(
        `INSERT INTO cuotas (prestamo_id, numero_cuota, fecha_vencimiento, monto_esperado, monto_pagado, estado, monto_capital, monto_interes)
         VALUES ($1, $2, $3, $4, 0, 'pendiente', $5, $6)`,
        [id, c.numero_cuota, c.fecha_vencimiento, c.monto_esperado, c.monto_capital, c.monto_interes]
      );
    }

    const { rows: [prestamoActualizado] } = await client.query(
      'UPDATE prestamos SET total_cuotas = $1, cuota_mensual = $2, updated_at = NOW() WHERE id = $3 RETURNING *',
      [numeroInicial - 1 + n, cuotaMensual, id]
    );

    await client.query('COMMIT');

    const { rows: cuotas } = await query('SELECT * FROM cuotas WHERE prestamo_id = $1 ORDER BY numero_cuota', [id]);
    res.json({ ...prestamoActualizado, cuotas });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err });
    res.status(500).json({ error: 'Error al reprogramar cronograma' });
  } finally {
    client.release();
  }
};

module.exports = { getAll, getById, create, update, updateEstado, getCuotas, reprogramar };
