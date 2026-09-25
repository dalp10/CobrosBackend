// src/controllers/auth.controller.js
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const logger = require('../config/logger');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { sendEmail } = require('../services/email.service');

const REFRESH_COOKIE = 'refreshToken';
const isProduction = process.env.NODE_ENV === 'production';
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const refreshCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  path: '/api/auth',
};

function signAccessToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, nombre: user.nombre, rol: user.rol },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
}

function signRefreshToken(user) {
  return jwt.sign(
    { id: user.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
}

const login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email y contraseña requeridos' });

  try {
    const { rows } = await query(
      'SELECT * FROM usuarios WHERE email = $1', [email]
    );
    if (!rows.length)
      return res.status(401).json({ error: 'Credenciales inválidas' });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid)
      return res.status(401).json({ error: 'Credenciales inválidas' });

    // Verificar contraseña antes que activo: así no se revela el estado de la
    // cuenta a quien no conoce la contraseña correcta.
    if (user.activo === false)
      return res.status(403).json({ error: 'Esta cuenta está desactivada', code: 'USER_INACTIVE' });

    const token = signAccessToken(user);
    res.cookie(REFRESH_COOKIE, signRefreshToken(user), refreshCookieOptions);

    res.json({
      token,
      user: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol }
    });
  } catch (err) {
    logger.error({ err });
    res.status(500).json({ error: 'Error del servidor' });
  }
};

const refresh = async (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE];
  if (!refreshToken)
    return res.status(401).json({ error: 'Refresh token requerido', code: 'REFRESH_TOKEN_MISSING' });

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const { rows } = await query(
      'SELECT id, nombre, email, rol, activo FROM usuarios WHERE id = $1', [decoded.id]
    );
    if (!rows.length || !rows[0].activo) {
      res.clearCookie(REFRESH_COOKIE, refreshCookieOptions);
      return res.status(401).json({ error: 'Usuario no válido', code: 'REFRESH_TOKEN_INVALID' });
    }

    const user = rows[0];
    const token = signAccessToken(user);
    res.cookie(REFRESH_COOKIE, signRefreshToken(user), refreshCookieOptions);

    res.json({
      token,
      user: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol }
    });
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions);
    const isExpired = err.name === 'TokenExpiredError';
    return res.status(401).json({
      error: isExpired ? 'Sesión expirada' : 'Refresh token inválido',
      code: isExpired ? 'REFRESH_TOKEN_EXPIRED' : 'REFRESH_TOKEN_INVALID',
    });
  }
};

const logout = async (req, res) => {
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions);
  res.status(204).end();
};

const me = async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id, nombre, email, rol, created_at FROM usuarios WHERE id = $1',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
};

// POST /auth/forgot-password — body: { email }
// Siempre responde el mismo mensaje genérico, exista o no ese email, para no
// permitir enumerar qué correos están registrados en el sistema.
const GENERIC_FORGOT_MESSAGE = 'Si el email está registrado, se enviaron instrucciones para restablecer la contraseña.';

const forgotPassword = async (req, res) => {
  const { email } = req.body;
  try {
    const { rows } = await query('SELECT id, nombre, email, activo FROM usuarios WHERE email = $1', [email]);
    const user = rows[0];
    if (user && user.activo !== false) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashToken(token);
      const expira = new Date(Date.now() + RESET_TOKEN_TTL_MS);
      await query(
        'UPDATE usuarios SET reset_token_hash = $1, reset_token_expira = $2 WHERE id = $3',
        [tokenHash, expira, user.id]
      );
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
      const resetUrl = `${frontendUrl.replace(/\/$/, '')}/reset-password?token=${token}`;
      const result = await sendEmail(
        user.email,
        'Restablecer tu contraseña — Cobros App',
        `<p>Hola ${user.nombre},</p>
         <p>Recibimos una solicitud para restablecer tu contraseña. Este enlace es válido por 1 hora:</p>
         <p><a href="${resetUrl}">${resetUrl}</a></p>
         <p>Si no solicitaste esto, puedes ignorar este correo.</p>`
      );
      if (!result.ok) logger.error({ error: result.error, code: result.code }, 'No se pudo enviar el email de recuperación');
    }
    res.json({ message: GENERIC_FORGOT_MESSAGE });
  } catch (err) {
    logger.error({ err });
    // Ante un error inesperado, igual se responde el mensaje genérico: no hay
    // forma de distinguir "email no existe" de "fallo interno" sin filtrar info.
    res.json({ message: GENERIC_FORGOT_MESSAGE });
  }
};

// POST /auth/reset-password — body: { token, password_nuevo }
const resetPassword = async (req, res) => {
  const { token, password_nuevo } = req.body;
  try {
    const tokenHash = hashToken(token);
    const { rows } = await query(
      'SELECT id FROM usuarios WHERE reset_token_hash = $1 AND reset_token_expira > NOW()',
      [tokenHash]
    );
    if (!rows.length)
      return res.status(400).json({ error: 'El enlace de recuperación es inválido o expiró', code: 'RESET_TOKEN_INVALID' });

    const hash = await bcrypt.hash(password_nuevo, 10);
    await query(
      'UPDATE usuarios SET password = $1, reset_token_hash = NULL, reset_token_expira = NULL WHERE id = $2',
      [hash, rows[0].id]
    );
    res.json({ message: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
  } catch (err) {
    logger.error({ err });
    res.status(500).json({ error: 'Error del servidor' });
  }
};

module.exports = { login, refresh, logout, me, forgotPassword, resetPassword };
