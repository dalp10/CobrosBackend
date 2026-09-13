// src/controllers/pagos.controller.js
const { query, getClient } = require('../config/db');
const logger = require('../config/logger');
const { tryDeleteUpload } = require('../utils/uploads');

// Reparte `monto` sobre el cronograma de cuotas pendientes de un préstamo:
// cubre primero el saldo de la cuota más antigua pendiente/parcial/vencida
// y, si sobra, abona a las siguientes en orden. Devuelve el detalle de
// cuotas afectadas (con el desglose capital/interés de cada abono).
const aplicarPagoACuotas = async (client, prestamoId, monto) => {
  const { rows: cuotasPendientes } = await client.query(
    `SELECT * FROM cuotas WHERE prestamo_id = $1 AND estado != 'pagado' ORDER BY numero_cuota`,
    [prestamoId]
  );

  const cuotasAplicadas = [];
  let restante = parseFloat(monto);
  for (const cuota of cuotasPendientes) {
    if (restante <= 0) break;

    const faltante = parseFloat(cuota.monto_esperado) - parseFloat(cuota.monto_pagado);
    const aplicado = Math.min(restante, faltante);
    const nuevoPagado = parseFloat(cuota.monto_pagado) + aplicado;
    const nuevoEstado = nuevoPagado >= parseFloat(cuota.monto_esperado) ? 'pagado' : 'parcial';

    await client.query(
      'UPDATE cuotas SET monto_pagado = $1, estado = $2 WHERE id = $3',
      [nuevoPagado, nuevoEstado, cuota.id]
    );

    // Reparte el monto aplicado a esta cuota entre capital e interés
    // compensatorio, en la misma proporción que tiene la cuota.
    const montoEsperadoCuota = parseFloat(cuota.monto_esperado);
    const proporcionInteres = montoEsperadoCuota > 0 ? parseFloat(cuota.monto_interes || 0) / montoEsperadoCuota : 0;
    const interesAplicado = Math.round(aplicado * proporcionInteres * 100) / 100;
    const capitalAplicado = Math.round((aplicado - interesAplicado) * 100) / 100;

    cuotasAplicadas.push({
      numero_cuota: cuota.numero_cuota,
      monto_aplicado: aplicado,
      monto_pagado: nuevoPagado,
      monto_esperado: montoEsperadoCuota,
      estado: nuevoEstado,
      saldo_restante: parseFloat(cuota.monto_esperado) - nuevoPagado,
      capital_aplicado: capitalAplicado,
      interes_aplicado: interesAplicado
    });

    restante -= aplicado;
  }

  return cuotasAplicadas;
};

// GET /pagos?deudor_id=&prestamo_id=&metodo=&desde=&hasta=
const getAll = async (req, res) => {
  const { deudor_id, prestamo_id, metodo, desde, hasta, page = 1, limit = 50 } = req.query;
  const conditions = [];
  const params = [];
  let i = 1;

  if (deudor_id)   { conditions.push(`p.deudor_id = $${i++}`);    params.push(deudor_id); }
  if (prestamo_id) { conditions.push(`p.prestamo_id = $${i++}`);  params.push(prestamo_id); }
  if (metodo)      { conditions.push(`p.metodo_pago = $${i++}`);  params.push(metodo); }
  if (desde)       { conditions.push(`p.fecha_pago >= $${i++}`);  params.push(desde); }
  if (hasta)       { conditions.push(`p.fecha_pago <= $${i++}`);  params.push(hasta); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    const { rows } = await query(`
      SELECT
        p.*,
        d.nombre || ' ' || d.apellidos AS deudor_nombre,
        pr.descripcion                  AS prestamo_desc
      FROM pagos p
      JOIN deudores d   ON d.id = p.deudor_id
      LEFT JOIN prestamos pr ON pr.id = p.prestamo_id
      ${where}
      ORDER BY p.fecha_pago DESC, p.created_at DESC
      LIMIT $${i} OFFSET $${i+1}
    `, [...params, parseInt(limit), offset]);

    // Total count
    const { rows: [{ count }] } = await query(
      `SELECT COUNT(*) FROM pagos p ${where}`, params
    );

    res.json({ data: rows, total: parseInt(count), page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    logger.error({ err });
    res.status(500).json({ error: 'Error al obtener pagos' });
  }
};

// POST /pagos — registrar pago (con imagen opcional vía multer)
const create = async (req, res) => {
  const {
    deudor_id, prestamo_id, cuota_id,
    fecha_pago, monto, metodo_pago,
    numero_operacion, banco_origen, concepto, notas, force
  } = req.body;

  if (!deudor_id || !fecha_pago || !monto || !metodo_pago)
    return res.status(400).json({ error: 'deudor_id, fecha_pago, monto y metodo_pago son requeridos' });

  const imagen_url    = req.file ? `/uploads/${req.file.filename}` : null;
  const imagen_nombre = req.file ? req.file.originalname : null;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Detectar posible pago duplicado: mismo deudor + mismo nro. de operación,
    // o mismo deudor + misma fecha + mismo monto + mismo método.
    if (force !== 'true' && force !== true) {
      const dupQuery = numero_operacion
        ? `SELECT id, fecha_pago, monto, metodo_pago, numero_operacion FROM pagos
           WHERE deudor_id = $1 AND numero_operacion = $2`
        : `SELECT id, fecha_pago, monto, metodo_pago, numero_operacion FROM pagos
           WHERE deudor_id = $1 AND fecha_pago = $2 AND monto = $3 AND metodo_pago = $4`;
      const dupParams = numero_operacion
        ? [deudor_id, numero_operacion]
        : [deudor_id, fecha_pago, parseFloat(monto), metodo_pago];

      const { rows: duplicados } = await client.query(dupQuery, dupParams);
      if (duplicados.length > 0) {
        await client.query('ROLLBACK');
        if (imagen_url) tryDeleteUpload(imagen_url);
        return res.status(409).json({
          error: 'Ya existe un pago similar registrado para este deudor',
          duplicado: true,
          pago_existente: duplicados[0]
        });
      }
    }

    // El pago no puede exceder el saldo pendiente del préstamo.
    if (prestamo_id) {
      // Bloquea la fila del préstamo hasta el commit/rollback de esta transacción:
      // si dos pagos al mismo préstamo llegan en paralelo, el segundo espera a que
      // el primero termine y así ve su saldo ya actualizado (evita sobre-pago por
      // condición de carrera entre el SELECT de saldo y el INSERT del pago).
      await client.query('SELECT id FROM prestamos WHERE id = $1 FOR UPDATE', [prestamo_id]);

      const { rows: [{ monto_original, total_pagado }] } = await client.query(`
        SELECT pr.monto_original, COALESCE(SUM(p.monto), 0) AS total_pagado
        FROM prestamos pr
        LEFT JOIN pagos p ON p.prestamo_id = pr.id
        WHERE pr.id = $1
        GROUP BY pr.monto_original
      `, [prestamo_id]);

      const saldoPendiente = parseFloat(monto_original) - parseFloat(total_pagado);
      if (parseFloat(monto) > saldoPendiente + 0.01) {
        await client.query('ROLLBACK');
        if (imagen_url) tryDeleteUpload(imagen_url);
        return res.status(400).json({
          error: `El monto excede el saldo pendiente del préstamo (S/ ${saldoPendiente.toFixed(2)})`
        });
      }
    }

    // Si el pago está asociado a un préstamo, repartir el monto sobre el cronograma de cuotas.
    const cuotasAplicadas = prestamo_id ? await aplicarPagoACuotas(client, prestamo_id, monto) : [];

    const { rows: [pago] } = await client.query(`
      INSERT INTO pagos
        (deudor_id, prestamo_id, cuota_id, fecha_pago, monto, metodo_pago,
         numero_operacion, banco_origen, concepto, notas,
         imagen_url, imagen_nombre, registrado_por, cuotas_aplicadas)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *
    `, [
      deudor_id, prestamo_id||null, cuota_id||null,
      fecha_pago, parseFloat(monto), metodo_pago,
      numero_operacion||null, banco_origen||null,
      concepto||null, notas||null,
      imagen_url, imagen_nombre,
      req.user?.id || null,
      cuotasAplicadas.length ? JSON.stringify(cuotasAplicadas) : null
    ]);

    await client.query('COMMIT');
    res.status(201).json(pago);
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err });
    res.status(500).json({ error: 'Error al registrar pago' });
  } finally {
    client.release();
  }
};

// PUT /pagos/:id — actualizar pago (con imagen opcional vía multer)
const update = async (req, res) => {
  const { id } = req.params;
  const { fecha_pago, monto, metodo_pago, numero_operacion, banco_origen, concepto, notas, remove_imagen, prestamo_id } = req.body;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Obtener pago actual para manejar imagen vieja
    const { rows: [pagoActual] } = await client.query('SELECT * FROM pagos WHERE id = $1', [id]);
    if (!pagoActual) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pago no encontrado' });
    }

    let imagen_url    = pagoActual.imagen_url;
    let imagen_nombre = pagoActual.imagen_nombre;

    if (req.file) {
      tryDeleteUpload(pagoActual.imagen_url);
      imagen_url    = `/uploads/${req.file.filename}`;
      imagen_nombre = req.file.originalname;
    } else if (remove_imagen === 'true') {
      tryDeleteUpload(pagoActual.imagen_url);
      imagen_url    = null;
      imagen_nombre = null;
    }

    // Asociar el pago a un préstamo (solo si todavía no tenía uno): reparte
    // el monto sobre el cronograma de cuotas, igual que al crear el pago.
    let nuevoPrestamoId = pagoActual.prestamo_id;
    let cuotasAplicadas = pagoActual.cuotas_aplicadas;
    if (prestamo_id && !pagoActual.prestamo_id) {
      const montoFinal = monto != null ? parseFloat(monto) : parseFloat(pagoActual.monto);

      await client.query('SELECT id FROM prestamos WHERE id = $1 FOR UPDATE', [prestamo_id]);

      const { rows: [{ monto_original, total_pagado }] } = await client.query(`
        SELECT pr.monto_original, COALESCE(SUM(p.monto), 0) AS total_pagado
        FROM prestamos pr
        LEFT JOIN pagos p ON p.prestamo_id = pr.id
        WHERE pr.id = $1
        GROUP BY pr.monto_original
      `, [prestamo_id]);

      const saldoPendiente = parseFloat(monto_original) - parseFloat(total_pagado);
      if (montoFinal > saldoPendiente + 0.01) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `El monto excede el saldo pendiente del préstamo (S/ ${saldoPendiente.toFixed(2)})`
        });
      }

      const aplicadas = await aplicarPagoACuotas(client, prestamo_id, montoFinal);
      nuevoPrestamoId = prestamo_id;
      cuotasAplicadas = aplicadas.length ? JSON.stringify(aplicadas) : null;
    } else if (prestamo_id && pagoActual.prestamo_id && parseInt(prestamo_id, 10) !== pagoActual.prestamo_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Este pago ya está asociado a un préstamo y no se puede cambiar.' });
    }

    const { rows: [row] } = await client.query(`
      UPDATE pagos SET
        fecha_pago=$1, monto=$2, metodo_pago=$3,
        numero_operacion=$4, banco_origen=$5,
        concepto=$6, notas=$7,
        imagen_url=$8, imagen_nombre=$9,
        prestamo_id=$10, cuotas_aplicadas=$11
      WHERE id=$12 RETURNING *
    `, [
      fecha_pago, parseFloat(monto), metodo_pago,
      numero_operacion || null, banco_origen || null,
      concepto || null, notas || null,
      imagen_url, imagen_nombre,
      nuevoPrestamoId || null, cuotasAplicadas,
      id
    ]);

    if (!row) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pago no encontrado' });
    }
    await client.query('COMMIT');
    res.json(row);
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'Error en PUT /pagos/:id');
    const isProd = process.env.NODE_ENV === 'production';
    res.status(500).json({
      error: 'Error al actualizar pago',
      ...(isProd ? {} : { detalle: err.message }),
    });
  } finally {
    client.release();
  }
};

// DELETE /pagos/:id
// Deshace en `cuotas` lo que un pago había aplicado (cuotas_aplicadas guarda,
// por número de cuota, cuánto se le abonó). Sin esto, borrar un pago dejaba
// la cuota marcada como pagada aunque el pago ya no existiera.
const revertirPagoDeCuotas = async (client, prestamoId, cuotasAplicadas) => {
  for (const c of cuotasAplicadas) {
    const { rows: [cuota] } = await client.query(
      'SELECT id, monto_esperado, monto_pagado FROM cuotas WHERE prestamo_id = $1 AND numero_cuota = $2',
      [prestamoId, c.numero_cuota]
    );
    if (!cuota) continue;
    const nuevoPagado = Math.max(0, parseFloat(cuota.monto_pagado) - parseFloat(c.monto_aplicado));
    const nuevoEstado = nuevoPagado <= 0 ? 'pendiente'
      : nuevoPagado < parseFloat(cuota.monto_esperado) ? 'parcial'
      : 'pagado';
    await client.query(
      'UPDATE cuotas SET monto_pagado = $1, estado = $2 WHERE id = $3',
      [nuevoPagado, nuevoEstado, cuota.id]
    );
  }
};

const remove = async (req, res) => {
  const { id } = req.params;
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows: [pago] } = await client.query('SELECT * FROM pagos WHERE id = $1', [id]);
    if (!pago) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pago no encontrado' });
    }

    if (pago.prestamo_id && pago.cuotas_aplicadas) {
      await revertirPagoDeCuotas(client, pago.prestamo_id, pago.cuotas_aplicadas);
    }

    await client.query('DELETE FROM pagos WHERE id = $1', [id]);
    await client.query('COMMIT');

    if (pago.imagen_url) tryDeleteUpload(pago.imagen_url);
    res.json({ message: 'Pago eliminado' });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err });
    res.status(500).json({ error: 'Error al eliminar pago' });
  } finally {
    client.release();
  }
};

// GET /pagos/resumen — dashboard stats
const resumen = async (req, res) => {
  try {
    // Por deudor: usar subconsultas para evitar producto cartesiano (préstamos × pagos)
    const { rows: porDeudor } = await query(`
      SELECT
        d.id,
        d.nombre || ' ' || d.apellidos AS nombre,
        (SELECT COALESCE(SUM(p.monto), 0) FROM pagos p WHERE p.deudor_id = d.id) AS total_pagado,
        (SELECT COALESCE(SUM(pr.monto_original), 0) FROM prestamos pr WHERE pr.deudor_id = d.id) AS total_prestado,
        (SELECT MAX(p.fecha_pago) FROM pagos p WHERE p.deudor_id = d.id) AS ultimo_pago,
        (SELECT COUNT(p.id) FROM pagos p WHERE p.deudor_id = d.id) AS num_pagos
      FROM deudores d
      WHERE d.activo = true
      ORDER BY d.apellidos
    `);

    const { rows: porMetodo } = await query(`
      SELECT metodo_pago, COUNT(*) AS cantidad, SUM(monto) AS total
      FROM pagos GROUP BY metodo_pago ORDER BY total DESC
    `);

    // Sin LIMIT: el frontend recibe el historial completo y es quien recorta
    // por rango (3/6/12/todos los meses) en porMesFiltrado(). Limitar aquí a 12
    // rompía la opción "Todos" (mostraba solo los últimos 12 meses igual,
    // sin avisar, aunque hubiera más historial).
    const { rows: porMes } = await query(`
      SELECT
        TO_CHAR(fecha_pago, 'YYYY-MM') AS mes,
        SUM(monto) AS total, COUNT(*) AS pagos
      FROM pagos
      GROUP BY mes ORDER BY mes DESC
    `);

    // Totales globales: una suma por tabla, sin JOIN que multiplique filas
    const { rows: [totales] } = await query(`
      SELECT
        (SELECT COALESCE(SUM(monto), 0) FROM pagos) AS total_cobrado,
        (SELECT COALESCE(SUM(monto_original), 0) FROM prestamos) AS total_prestado
    `);

    res.json({ porDeudor, porMetodo, porMes, totales });
  } catch (err) {
    logger.error({ err });
    res.status(500).json({ error: 'Error al obtener resumen' });
  }
};

module.exports = { getAll, create, update, remove, resumen };
