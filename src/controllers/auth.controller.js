// src/controllers/auth.controller.js
const bcrypt = require('bcryptjs');
const logger = require('../config/logger');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');

const REFRESH_COOKIE = 'refreshToken';
const isProduction = process.env.NODE_ENV === 'production';

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

module.exports = { login, refresh, logout, me };
