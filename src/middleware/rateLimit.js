// src/middleware/rateLimit.js
const rateLimit = require('express-rate-limit');

const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutos
const LOGIN_MAX = 5;

const loginLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  max: LOGIN_MAX,
  message: {
    error: 'Demasiados intentos de inicio de sesión. Intenta de nuevo en 15 minutos.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Recuperación de contraseña: límite estricto para no permitir usarlo para
// enumerar emails registrados ni para saturar el buzón de un usuario.
const FORGOT_PASSWORD_WINDOW_MS = 15 * 60 * 1000; // 15 minutos
const FORGOT_PASSWORD_MAX = 3;

const forgotPasswordLimiter = rateLimit({
  windowMs: FORGOT_PASSWORD_WINDOW_MS,
  max: FORGOT_PASSWORD_MAX,
  message: {
    error: 'Demasiadas solicitudes. Intenta de nuevo en 15 minutos.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Límite general para toda la API (por IP)
const API_WINDOW_MS = 60 * 1000; // 1 minuto
const API_MAX = parseInt(process.env.RATE_LIMIT_API_MAX || '100', 10);

const apiLimiter = rateLimit({
  windowMs: API_WINDOW_MS,
  max: API_MAX,
  message: {
    error: 'Demasiadas peticiones. Intenta de nuevo en un momento.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { loginLimiter, forgotPasswordLimiter, apiLimiter };
