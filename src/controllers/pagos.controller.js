// src/controllers/pagos.controller.js
const { query, getClient } = require('../config/db');
const path = require('path');
const fs = require('fs');

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
    console.error(err);
    res.status(500).json({ error: 'Error al obtener pagos' });
  }
};

// POST /pagos — registrar pago (con imagen opcional vía multer)
const create = async (req, res) => {
  const {
    deudor_id, prestamo_id, cuota_id,
    fecha_pago, monto, metodo_pago,
    numero_operacion, banco_origen, concepto, notas
  } = req.body;

  if (!deudor_id || !fecha_pago || !monto || !metodo_pago)
    return res.status(400).json({ error: 'deudor_id, fecha_pago, monto y metodo_pago son requeridos' });

  const imagen_url    = req.file ? `/uploads/${req.file.filename}` : null;
  const imagen_nombre = req.file ? req.file.originalname : null;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows: [pago] } = await client.query(`
      INSERT INTO pagos
        (deudor_id, prestamo_id, cuota_id, fecha_pago, monto, metodo_pago,
         numero_operacion, banco_origen, concepto, notas,
         imagen_url, imagen_nombre, registrado_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *
    `, [
      deudor_id, prestamo_id||null, cuota_id||null,
      fecha_pago, parseFloat(monto), metodo_pago,
      numero_operacion||null, banco_origen||null,
      concepto||null, notas||null,
      imagen_url, imagen_nombre,
      req.user?.id || null
    ]);

    // Si se especificó cuota, actualizar su estado
    if (cuota_id) {
      const { rows: [cuota] } = await client.query(
        'SELECT * FROM cuotas WHERE id = $1', [cuota_id]
      );
      if (cuota) {
        const nuevoPagado = parseFloat(cuota.monto_pagado) + parseFloat(monto);
        const nuevoEstado = nuevoPagado >= parseFloat(cuota.monto_esperado)
          ? 'pagado' : 'parcial';
        await client.query(
          'UPDATE cuotas SET monto_pagado = $1, estado = $2 WHERE id = $3',
          [nuevoPagado, nuevoEstado, cuota_id]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json(pago);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al registrar pago' });
  } finally {
    client.release();
  }
};

// PUT /pagos/:id — actualizar pago (con imagen opcional vía multer)
const update = async (req, res) => {
  const { id } = req.params;
  const { fecha_pago, monto, metodo_pago, numero_operacion, banco_origen, concepto, notas, remove_imagen } = req.body;

  try {
    // Obtener pago actual para manejar imagen vieja
    const { rows: [pagoActual] } = await query('SELECT * FROM pagos WHERE id = $1', [id]);
    if (!pagoActual) return res.status(404).json({ error: 'Pago no encontrado' });

    let imagen_url    = pagoActual.imagen_url;
    let imagen_nombre = pagoActual.imagen_nombre;

    // Helper: intentar borrar archivo viejo sin lanzar error si no existe
    const tryDeleteOld = (oldUrl) => {
      if (!oldUrl) return;
      try {
        // Intentar rutas comunes donde puede estar la carpeta uploads
        const candidates = [
          path.join(__dirname, '../../public', oldUrl),
          path.join(__dirname, '../public', oldUrl),
          path.join(__dirname, '../../', oldUrl),
          path.join(__dirname, '../', oldUrl),
          path.join(process.cwd(), 'public', oldUrl),
          path.join(process.cwd(), oldUrl.replace(/^\//, '')),
        ];
        for (const p of candidates) {
          if (fs.existsSync(p)) { fs.unlinkSync(p); break; }
        }
      } catch (e) {
        console.warn('No se pudo eliminar imagen vieja:', e.message);
      }
    };

    // Si se sube nueva imagen, reemplazar
    if (req.file) {
      tryDeleteOld(pagoActual.imagen_url);
      imagen_url    = `/uploads/${req.file.filename}`;
      imagen_nombre = req.file.originalname;
    }
    // Si se pidió eliminar la imagen sin subir una nueva
    else if (remove_imagen === 'true') {
      tryDeleteOld(pagoActual.imagen_url);
      imagen_url    = null;
      imagen_nombre = null;
    }

    const { rows: [row] } = await query(`
      UPDATE pagos SET
        fecha_pago=$1, monto=$2, metodo_pago=$3,
        numero_operacion=$4, banco_origen=$5,
        concepto=$6, notas=$7,
        imagen_url=$8, imagen_nombre=$9
      WHERE id=$10 RETURNING *
    `, [
      fecha_pago, parseFloat(monto), metodo_pago,
      numero_operacion || null, banco_origen || null,
      concepto || null, notas || null,
      imagen_url, imagen_nombre,
      id
    ]);

    if (!row) return res.status(404).json({ error: 'Pago no encontrado' });
    res.json(row);
  } catch (err) {
    console.error('Error en PUT /pagos/:id →', err);
    res.status(500).json({ error: 'Error al actualizar pago', detalle: err.message });
  }
};

// DELETE /pagos/:id
const remove = async (req, res) => {
  const { id } = req.params;
  try {
    // Eliminar imagen del disco si existe
    const { rows: [pago] } = await query('SELECT imagen_url FROM pagos WHERE id = $1', [id]);
    if (pago?.imagen_url) {
      const filePath = path.join(__dirname, '../../public', pago.imagen_url);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    await query('DELETE FROM pagos WHERE id = $1', [id]);
    res.json({ message: 'Pago eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar pago' });
  }
};

// GET /pagos/resumen — dashboard stats
const resumen = async (req, res) => {
  try {
    const { rows: porDeudor } = await query(`
      SELECT
        d.id, d.nombre || ' ' || d.apellidos AS nombre,
        COALESCE(SUM(p.monto), 0)            AS total_pagado,
        COALESCE(SUM(pr.monto_original), 0)  AS total_prestado,
        MAX(p.fecha_pago)                    AS ultimo_pago,
        COUNT(p.id)                          AS num_pagos
      FROM deudores d
      LEFT JOIN prestamos pr ON pr.deudor_id = d.id
      LEFT JOIN pagos p      ON p.deudor_id  = d.id
      WHERE d.activo = true
      GROUP BY d.id ORDER BY d.apellidos
    `);

    const { rows: porMetodo } = await query(`
      SELECT metodo_pago, COUNT(*) AS cantidad, SUM(monto) AS total
      FROM pagos GROUP BY metodo_pago ORDER BY total DESC
    `);

    const { rows: porMes } = await query(`
      SELECT
        TO_CHAR(fecha_pago, 'YYYY-MM') AS mes,
        SUM(monto) AS total, COUNT(*) AS pagos
      FROM pagos
      GROUP BY mes ORDER BY mes DESC LIMIT 12
    `);

    const { rows: [totales] } = await query(`
      SELECT
        COALESCE(SUM(p.monto), 0)           AS total_cobrado,
        COALESCE(SUM(pr.monto_original), 0) AS total_prestado
      FROM pagos p
      FULL OUTER JOIN prestamos pr ON true
    `);

    res.json({ porDeudor, porMetodo, porMes, totales });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener resumen' });
  }
};

module.exports = { getAll, create, update, remove, resumen };
