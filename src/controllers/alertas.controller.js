// src/controllers/alertas.controller.js
const { query } = require('../config/db');
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
      console.error(err);
      return res.status(500).json({ error: 'Error al obtener deudor' });
    }
  }

  if (!numero) return res.status(400).json({ error: 'Indica telefono o deudor_id' });
  const TITULO = '📋 *Recordatorio de cobro*\n\n';
  const cuerpo = (mensaje && String(mensaje).trim()) || 'Le recordamos que tiene un saldo pendiente. ¿Podría regularizar? Gracias.';
  const texto = cuerpo.startsWith('*') || cuerpo.startsWith('📋') ? cuerpo : TITULO + cuerpo;
  const result = await sendWhatsApp(numero, texto);
  if (!result.ok) {
    const status = result.code === 21608 || result.code === 21211 ? 400 : 502;
    return res.status(status).json({ error: result.error, code: result.code });
  }
  res.json({ ok: true, sid: result.sid, mensaje: 'Mensaje enviado' });
};

module.exports = { enviarWhatsApp };
