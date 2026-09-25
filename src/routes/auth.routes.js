// src/routes/auth.routes.js
const router = require('express').Router();
const { login, refresh, logout, me, forgotPassword, resetPassword } = require('../controllers/auth.controller');
const auth = require('../middleware/auth');
const { loginLimiter, forgotPasswordLimiter } = require('../middleware/rateLimit');
const validate = require('../middleware/validate');
const { loginValidations, forgotPasswordValidations, resetPasswordValidations } = require('../validators/auth.validator');

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Iniciar sesión
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login exitoso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                 user:
 *                   type: object
 *                   properties:
 *                     id: { type: integer }
 *                     nombre: { type: string }
 *                     email: { type: string }
 *                     rol: { type: string }
 *       400:
 *         description: Datos inválidos
 *       401:
 *         description: Credenciales incorrectas
 *       429:
 *         description: Demasiados intentos de inicio de sesión
 */
router.post('/login', loginLimiter, loginValidations, validate(loginValidations), login);

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Renovar el access token usando el refresh token (cookie httpOnly)
 *     security: []
 *     responses:
 *       200:
 *         description: Nuevo access token
 *       401:
 *         description: Refresh token ausente, inválido o expirado
 */
router.post('/refresh', refresh);

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Cerrar sesión (elimina la cookie de refresh token)
 *     security: []
 *     responses:
 *       204:
 *         description: Sesión cerrada
 */
router.post('/logout', logout);

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Obtener el usuario autenticado
 *     responses:
 *       200:
 *         description: Usuario actual
 *       401:
 *         description: Token inválido o ausente
 */
router.get('/me', auth, me);

/**
 * @openapi
 * /auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Solicitar recuperación de contraseña por email
 *     description: >
 *       Siempre responde 200 con un mensaje genérico, exista o no el email,
 *       para no permitir enumerar cuentas registradas. Si el email existe,
 *       se envía un enlace de recuperación válido por 1 hora.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Mensaje genérico de confirmación
 *       400:
 *         description: Email inválido
 *       429:
 *         description: Demasiadas solicitudes
 */
router.post('/forgot-password', forgotPasswordLimiter, forgotPasswordValidations, validate(forgotPasswordValidations), forgotPassword);

/**
 * @openapi
 * /auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Restablecer la contraseña con el token recibido por email
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, password_nuevo]
 *             properties:
 *               token:
 *                 type: string
 *               password_nuevo:
 *                 type: string
 *                 minLength: 6
 *     responses:
 *       200:
 *         description: Contraseña actualizada
 *       400:
 *         description: Token inválido, expirado o contraseña inválida
 */
router.post('/reset-password', resetPasswordValidations, validate(resetPasswordValidations), resetPassword);

module.exports = router;
