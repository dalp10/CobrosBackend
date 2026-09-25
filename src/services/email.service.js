// src/services/email.service.js
// Envío de correo vía SMTP (nodemailer). Sirve para cualquier proveedor que
// hable SMTP: Gmail (con App Password), SendGrid, Mailgun, Mailtrap, etc.
// Variables de entorno: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.
const logger = require('../config/logger');

let cachedTransporter = null;

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !port || !user || !pass) return null;
  if (cachedTransporter) return cachedTransporter;
  const nodemailer = require('nodemailer');
  cachedTransporter = nodemailer.createTransport({
    host,
    port: parseInt(port, 10),
    secure: parseInt(port, 10) === 465,
    auth: { user, pass },
  });
  return cachedTransporter;
}

/**
 * Envía un correo. Devuelve { ok: true } o { ok: false, error }; nunca lanza.
 * @param {string} to
 * @param {string} subject
 * @param {string} html
 */
async function sendEmail(to, subject, html) {
  const transporter = getTransporter();
  if (!transporter) {
    return { ok: false, error: 'Envío de email no configurado. Definir SMTP_HOST, SMTP_PORT, SMTP_USER y SMTP_PASS.', code: 'NOT_CONFIGURED' };
  }
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  try {
    const info = await transporter.sendMail({ from, to, subject, html });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    logger.error({ err }, 'Error al enviar email');
    return { ok: false, error: err.message || 'Error al enviar el correo' };
  }
}

module.exports = { sendEmail, getTransporter };
