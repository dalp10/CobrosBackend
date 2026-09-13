// src/controllers/alertas.controller.js
const { query } = require('../config/db');
const logger = require('../config/logger');
const { sendWhatsApp } = require('../services/whatsapp.service');

/**
 * POST /api/alertas/whatsapp
 * Body: { telefono?, deudor_id?, mensaje }
 * Si se envía deudor_id, se usa el teléfono del deudor (y mensaje es obligatorio).
 * Si se envía telefono, se usa ese número (y mensaje es obligatorio).
 */
const enviarWhatsApp = async (req, res) => {
  const { telefono, deudor_id, mensaje } = req.body;
  let numero = telefono ? String(telefono).trim() : null;

  if (telefono && deudor_id)
    return res.status(400).json({ error: 'Indica solo uno: telefono o deudor_id' });

  if (deudor_id && !numero) {
    try {
      const { rows: [d] } = await query(
        'SELECT telefono FROM deudores WHERE id = $1 AND activo = true',
        [deudor_id]
      );
      if (!d) return res.status(404).json({ error: 'Deudor no encontrado' });
      numero = d.telefono || null;
      if (!numero) return res.status(400).json({ error: 'El deudor no tiene teléfono registrado' });
    } catch (err) {
      logger.error({ err });
      return res.status(500).json({ error: 'Error al obtener deudor' });
    }
  }

  if (!numero) return res.status(400).json({ error: 'Indica telefono o deudor_id' });
  const TITULO = '📋 *Recordatorio de cobro*\n\n';
  const cuerpo = (mensaje && String(mensaje).trim()) || 'Le recordamos que tiene un saldo pendiente. ¿Podría regularizar? Gracias.';
  const texto = cuerpo.startsWith('*') || cuerpo.startsWith('📋') ? cuerpo : TITULO + cuerpo;
  const result = await sendWhatsApp(numero, texto);
  if (!result.ok) {
    const isNotConfigured = result.code === 'NOT_CONFIGURED' || (result.error && result.error.includes('WhatsApp no configurado'));
    const isClientError = result.code === 21608 || result.code === 21211;
    const status = isNotConfigured ? 503 : (isClientError ? 400 : 502);
    return res.status(status).json({ error: result.error, code: result.code });
  }
  res.json({ ok: true, sid: result.sid, mensaje: 'Mensaje enviado' });
};

// GET /api/alertas/mora
// Cuotas pendientes/parciales con fecha de vencimiento ya pasada, agrupadas por deudor.
const getMora = async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        d.id   AS deudor_id,
        d.nombre, d.apellidos, d.telefono,
        c.id   AS cuota_id,
        c.prestamo_id,
        c.numero_cuota,
        c.fecha_vencimiento,
        c.monto_esperado,
        c.monto_pagado,
        pr.descripcion AS prestamo_desc,
        (CURRENT_DATE - c.fecha_vencimiento) AS dias_vencido
      FROM cuotas c
      JOIN prestamos pr ON pr.id = c.prestamo_id
      JOIN deudores d   ON d.id = pr.deudor_id
      WHERE c.estado IN ('pendiente', 'parcial', 'vencido')
        AND c.fecha_vencimiento < CURRENT_DATE
        AND d.activo = true
      ORDER BY d.apellidos, d.nombre, c.fecha_vencimiento
    `);

    const porDeudor = new Map();
    for (const r of rows) {
      if (!porDeudor.has(r.deudor_id)) {
        porDeudor.set(r.deudor_id, {
          deudor_id: r.deudor_id,
          nombre: r.nombre,
          apellidos: r.apellidos,
          telefono: r.telefono,
          total_mora: 0,
          cuotas: []
        });
      }
      const grupo = porDeudor.get(r.deudor_id);
      const saldo = parseFloat(r.monto_esperado) - parseFloat(r.monto_pagado);
      grupo.total_mora += saldo;
      grupo.cuotas.push({
        cuota_id: r.cuota_id,
        prestamo_id: r.prestamo_id,
        prestamo_desc: r.prestamo_desc,
        numero_cuota: r.numero_cuota,
        fecha_vencimiento: r.fecha_vencimiento,
        monto_esperado: parseFloat(r.monto_esperado),
        monto_pagado: parseFloat(r.monto_pagado),
        saldo,
        dias_vencido: parseInt(r.dias_vencido, 10)
      });
    }

    res.json(Array.from(porDeudor.values()));
  } catch (err) {
    logger.error({ err });
    res.status(500).json({ error: 'Error al obtener mora' });
  }
};

// GET /api/alertas/proximas?dias=3
// Cuotas pendientes/parciales que vencen dentro de los próximos `dias` días (incluye hoy), agrupadas por deudor.
const getProximas = async (req, res) => {
  const dias = parseInt(req.query.dias, 10) || 3;
  try {
    const { rows } = await query(`
      SELECT
        d.id   AS deudor_id,
        d.nombre, d.apellidos, d.telefono,
        c.id   AS cuota_id,
        c.prestamo_id,
        c.numero_cuota,
        c.fecha_vencimiento,
        c.monto_esperado,
        c.monto_pagado,
        pr.descripcion AS prestamo_desc,
        (c.fecha_vencimiento - CURRENT_DATE) AS dias_para_vencer
      FROM cuotas c
      JOIN prestamos pr ON pr.id = c.prestamo_id
      JOIN deudores d   ON d.id = pr.deudor_id
      WHERE c.estado IN ('pendiente', 'parcial')
        AND c.fecha_vencimiento >= CURRENT_DATE
        AND c.fecha_vencimiento <= CURRENT_DATE + $1::int
        AND d.activo = true
      ORDER BY d.apellidos, d.nombre, c.fecha_vencimiento
    `, [dias]);

    const porDeudor = new Map();
    for (const r of rows) {
      if (!porDeudor.has(r.deudor_id)) {
        porDeudor.set(r.deudor_id, {
          deudor_id: r.deudor_id,
          nombre: r.nombre,
          apellidos: r.apellidos,
          telefono: r.telefono,
          total: 0,
          cuotas: []
        });
      }
      const grupo = porDeudor.get(r.deudor_id);
      const saldo = parseFloat(r.monto_esperado) - parseFloat(r.monto_pagado);
      grupo.total += saldo;
      grupo.cuotas.push({
        cuota_id: r.cuota_id,
        prestamo_id: r.prestamo_id,
        prestamo_desc: r.prestamo_desc,
        numero_cuota: r.numero_cuota,
        fecha_vencimiento: r.fecha_vencimiento,
        monto_esperado: parseFloat(r.monto_esperado),
        monto_pagado: parseFloat(r.monto_pagado),
        saldo,
        dias_para_vencer: parseInt(r.dias_para_vencer, 10)
      });
    }

    res.json(Array.from(porDeudor.values()));
  } catch (err) {
    logger.error({ err });
    res.status(500).json({ error: 'Error al obtener cuotas próximas a vencer' });
  }
};

module.exports = { enviarWhatsApp, getMora, getProximas };
