// src/routes/auth.routes.js
const router = require('express').Router();
const { login, refresh, logout, me } = require('../controllers/auth.controller');
const auth = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimit');
const validate = require('../middleware/validate');
const { loginValidations } = require('../validators/auth.validator');

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

module.exports = router;
