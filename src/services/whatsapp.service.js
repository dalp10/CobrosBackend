// src/services/whatsapp.service.js
// Envío de mensajes por WhatsApp vía Twilio.
// Variables de entorno: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM (ej. whatsapp:+14155238886 para sandbox).

function getClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  const twilio = require('twilio');
  return twilio(sid, token);
}

/**
 * Normaliza número a E.164 para Perú.
 * Ej: "981844013" o "0981844013" -> "+51981844013"
 */
function toE164(telefono, defaultCountryCode = '51') {
  const digits = String(telefono || '').replace(/\D/g, '');
  if (digits.length === 0) return null;
  let num = digits;
  if (num.startsWith('0')) num = num.slice(1);
  if (num.length === 9 && num.startsWith('9')) num = defaultCountryCode + num;
  else if (num.length === 10 && num.startsWith(defaultCountryCode)) num = num;
  else if (num.length < 9) return null;
  return '+' + num.replace(/^0+/, '');
}

/**
 * Envía un mensaje por WhatsApp.
 * @param {string} to - Número destino (ej. 981844013 o +51981844013)
 * @param {string} body - Texto del mensaje
 * @returns {{ ok: boolean, sid?: string, error?: string }}
 */
async function sendWhatsApp(to, body) {
  const client = getClient();
  if (!client) {
    return { ok: false, error: 'WhatsApp no configurado. Definir TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN y TWILIO_WHATSAPP_FROM.' };
  }
  const from = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
  const toE164Num = toE164(to);
  if (!toE164Num) {
    return { ok: false, error: 'Número de teléfono inválido' };
  }
  const toWhatsApp = toE164Num.startsWith('whatsapp:') ? toE164Num : `whatsapp:${toE164Num}`;
  try {
    const message = await client.messages.create({
      body: String(body || '').trim() || 'Recordatorio de cobro',
      from,
      to: toWhatsApp,
    });
    return { ok: true, sid: message.sid };
  } catch (err) {
    console.error('Twilio WhatsApp error:', err.message);
    const code = err.code || err.status;
    const msg = err.message || 'Error al enviar el mensaje';
    return { ok: false, error: msg, code };
  }
}

module.exports = { sendWhatsApp, toE164, getClient };
