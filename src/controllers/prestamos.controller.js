// src/controllers/prestamos.controller.js
const { query, getClient } = require('../config/db');
const logger = require('../config/logger');
const { calcularCronograma } = require('../utils/amortizacion');
const { addMonthsIso } = require('../utils/fechas');

// GET /prestamos?deudor_id=
const getAll = async (req, res) => {
  const { deudor_id } = req.query;
  try {
    const { rows } = await query(`
      SELECT
        pr.*,
        d.nombre || ' ' || d.apellidos AS deudor_nombre,
        COALESCE(SUM(p.monto), 0)      AS total_pagado,
        -- Idealmente SUM(cuotas.monto_pagado) == SUM(pagos.monto) para un mismo
        -- préstamo (aplicarPagoACuotas mantiene ambas en sync), pero en datos
        -- históricos/migrados pueden divergir en cualquier dirección: un pago
        -- reflejado en cuotas sin fila en pagos, o viceversa. Usar solo una
        -- de las dos fuentes puede subestimar lo abonado (mostrando de más
        -- pendiente) o directamente dar un pendiente absurdo (mayor al monto
        -- total). Se toma el máximo de ambas para no penalizar al deudor por
        -- una fuente incompleta, acotado a nunca superar lo esperado ni bajar
        -- de 0.
        GREATEST(0,
          CASE WHEN EXISTS (SELECT 1 FROM cuotas c WHERE c.prestamo_id = pr.id)
            THEN (SELECT SUM(c.monto_esperado) FROM cuotas c WHERE c.prestamo_id = pr.id)
                 - GREATEST(
                     (SELECT SUM(c.monto_pagado) FROM cuotas c WHERE c.prestamo_id = pr.id),
                     COALESCE(SUM(p.monto), 0)
                   )
            ELSE pr.monto_original - COALESCE(SUM(p.monto), 0)
          END
        ) AS saldo_pendiente,
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
    // Igual que en getAll(): se toma el máximo entre lo que dicen las cuotas
    // (monto_pagado) y lo que dice pagos.monto, por si divergen en datos
    // históricos — evita subestimar lo abonado o mostrar un pendiente absurdo.
    const cuotasPagadoSum = cuotas.reduce((s, c) => s + parseFloat(c.monto_pagado || 0), 0);
    const saldo_pendiente = Math.max(0, cuotas.length
      ? montoTotalEsperado - Math.max(cuotasPagadoSum, total_pagado)
      : montoTotalEsperado - total_pagado);

    res.json({ ...prestamo, total_pagado, saldo_pendiente, saldo_capital, interes_total: interesTotal, interes_pagado: interesPagado, cuotas, pagos });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener préstamo' });
  }
};

// POST /prestamos
// Si se indica cuota_mensual y/o más de 1 cuota, genera de una vez el cronograma
// de cuotas (igual que reprogramar), para que el préstamo aparezca desde el
// inicio en mora/alertas/próximas a vencer. Un préstamo "simple" (1 cuota,
// sin cuota_mensual) se deja sin cronograma, como un saldo informal que se
// abona sin plan fijo — igual que hasta ahora.
const create = async (req, res) => {
  const {
    deudor_id, tipo, descripcion, monto_original, tasa_interes,
    total_cuotas, cuota_mensual, fecha_inicio, fecha_fin,
    banco, numero_operacion, notas
  } = req.body;

  if (!deudor_id || !tipo || !monto_original || !fecha_inicio)
    return res.status(400).json({ error: 'Faltan campos requeridos' });

  const montoOriginalNum = parseFloat(monto_original);
  const totalCuotasNum = parseInt(total_cuotas, 10) || 1;
  const cuotaMensualNum = cuota_mensual ? parseFloat(cuota_mensual) : null;
  const generarCronograma = totalCuotasNum > 1 || !!cuotaMensualNum;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows: [row] } = await client.query(`
      INSERT INTO prestamos
        (deudor_id, tipo, descripcion, monto_original, tasa_interes,
         total_cuotas, cuota_mensual, fecha_inicio, fecha_fin,
         banco, numero_operacion, notas)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *
    `, [deudor_id, tipo, descripcion, montoOriginalNum, tasa_interes||0,
        totalCuotasNum, cuotaMensualNum, fecha_inicio, fecha_fin||null,
        banco||null, numero_operacion||null, notas||null]);

    let cuotas = [];
    if (generarCronograma) {
      const cuotaMensualFinal = cuotaMensualNum || Math.round((montoOriginalNum / totalCuotasNum) * 100) / 100;
      const nuevasCuotas = [];
      for (let i = 0; i < totalCuotasNum; i++) {
        const esUltima = i === totalCuotasNum - 1;
        const monto = esUltima
          ? Math.max(0, montoOriginalNum - cuotaMensualFinal * (totalCuotasNum - 1))
          : cuotaMensualFinal;
        nuevasCuotas.push({
          numero_cuota: i + 1,
          fecha_vencimiento: addMonthsIso(fecha_inicio, i),
          monto_esperado: Math.round(monto * 100) / 100
        });
      }

      const cuotasConSplit = calcularCronograma(nuevasCuotas, montoOriginalNum, tasa_interes || 0);
      for (const c of cuotasConSplit) {
        await client.query(
          `INSERT INTO cuotas (prestamo_id, numero_cuota, fecha_vencimiento, monto_esperado, monto_pagado, estado, monto_capital, monto_interes)
           VALUES ($1, $2, $3, $4, 0, 'pendiente', $5, $6)`,
          [row.id, c.numero_cuota, c.fecha_vencimiento, c.monto_esperado, c.monto_capital, c.monto_interes]
        );
      }
      cuotas = cuotasConSplit;
    }

    await client.query('COMMIT');
    res.status(201).json({ ...row, cuotas });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err });
    res.status(500).json({ error: 'Error al crear préstamo' });
  } finally {
    client.release();
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
    // Si el préstamo ya tiene un cronograma de cuotas, cambiar monto_original aquí
    // dejaría el total de las cuotas (y por lo tanto saldo_pendiente/saldo_capital)
    // desincronizado del nuevo monto. Para ese caso, el camino correcto es
    // "Reprogramar cronograma", que sí recalcula las cuotas pendientes.
    if (req.body.monto_original !== undefined && req.body.monto_original !== null) {
      const { rows: [{ count }] } = await query(
        'SELECT COUNT(*) FROM cuotas WHERE prestamo_id = $1', [id]
      );
      if (parseInt(count, 10) > 0) {
        return res.status(400).json({
          error: 'Este préstamo ya tiene un cronograma de cuotas. Para cambiar el monto usa "Reprogramar cronograma" en vez de editar el monto directamente.'
        });
      }
    }

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

    let fechaBaseIso;
    if (fecha_inicio) {
      fechaBaseIso = fecha_inicio;
    } else if (cuotasPagadas.length) {
      fechaBaseIso = addMonthsIso(cuotasPagadas[cuotasPagadas.length - 1].fecha_vencimiento, 1);
    } else if (cuotasPendientes.length) {
      fechaBaseIso = cuotasPendientes[0].fecha_vencimiento;
    } else {
      fechaBaseIso = prestamo.fecha_inicio;
    }

    const n = parseInt(total_cuotas, 10);
    const cuotaMensual = parseFloat(cuota_mensual);
    const numeroInicial = cuotasPagadas.length + 1;

    const nuevasCuotas = [];
    for (let i = 0; i < n; i++) {
      const esUltima = i === n - 1;
      const monto = esUltima ? Math.max(0, saldoPendiente - cuotaMensual * (n - 1)) : cuotaMensual;
      nuevasCuotas.push({
        numero_cuota: numeroInicial + i,
        fecha_vencimiento: addMonthsIso(fechaBaseIso, i),
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
