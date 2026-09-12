// src/index.js
const express  = require('express');
const cors     = require('cors');
const cookieParser = require('cookie-parser');
const path     = require('path');
const helmet   = require('helmet');
require('dotenv').config();

const pinoHttp = require('pino-http');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');

const { ensureEnv } = require('./config/env');
const { checkDb } = require('./config/health');
const { pgErrorToHttp } = require('./utils/pgErrors');
const logger = require('./config/logger');

ensureEnv();

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

// ── CORS: normalizar origins (trim, filtrar vacíos) ──────────────
// En producción DEBES definir ALLOWED_ORIGINS con la URL de tu frontend (ej. https://tu-app.vercel.app).
// No uses localhost en producción.
const rawOrigins = process.env.ALLOWED_ORIGINS;
const allowedOrigins = rawOrigins
  ? rawOrigins.split(',').map(o => o.trim()).filter(Boolean)
  : (isProduction ? [] : ['http://localhost:4200']);

if (isProduction && allowedOrigins.length === 0) {
  logger.warn('ALLOWED_ORIGINS no está definido. Define en Railway la URL de tu frontend (ej. https://tu-app.vercel.app).');
}

// ── Middlewares globales ───────────────────────────────────────
app.use(pinoHttp({
  logger,
  autoLogging: { ignore: (req) => req.url === '/api/health' },
}));
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Rate limit general para /api (excluir health para que el orchestrator no falle)
const { apiLimiter } = require('./middleware/rateLimit');
app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();
  // Normalizar barra final: /reparto/miembros/3/ → /reparto/miembros/3 (req.url es relativo a /api)
  if (req.url.endsWith('/') && req.url !== '/') {
    const [pathOnly, query] = req.url.split('?');
    const trimmed = pathOnly.replace(/\/+$/, '') || '/';
    req.url = query ? trimmed + '?' + query : trimmed;
  }
  return apiLimiter(req, res, next);
});

// Servir archivos subidos (vouchers/imágenes)
const uploadsDir = process.env.UPLOADS_DIR || './uploads';
app.use('/uploads', express.static(path.resolve(uploadsDir)));

// ── Documentación API (Swagger) ─────────────────────────────────
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ── Rutas ──────────────────────────────────────────────────────
app.use('/api/auth',      require('./routes/auth.routes'));
app.use('/api/deudores',  require('./routes/deudores.routes'));
app.use('/api/prestamos', require('./routes/prestamos.routes'));
app.use('/api/usuarios',  require('./routes/usuarios.routes'));
app.use('/api/pagos',     require('./routes/pagos.routes'));
app.use('/api/alertas',   require('./routes/alertas.routes'));
app.use('/api/reparto',   require('./routes/reparto.routes'));
app.use('/api/analitica', require('./routes/analitica.routes'));

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Estado del servidor y conexión a la base de datos
 *     security: []
 *     responses:
 *       200:
 *         description: Servidor operativo
 *       503:
 *         description: Base de datos no disponible
 */
// ── Health check ───────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await checkDb();
    res.json({ status: 'ok', timestamp: new Date().toISOString(), db: 'connected' });
  } catch (err) {
    logger.error({ err }, 'Health check DB');
    res.status(503).json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      db: 'disconnected',
      error: isProduction ? undefined : err.message,
    });
  }
});

// ── 404 para rutas no definidas ─────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api'))
    return res.status(404).json({ error: 'Ruta no encontrada' });
  res.status(404).send('Not Found');
});

// ── Error handler global ───────────────────────────────────────
app.use((err, req, res, next) => {
  (req.log || logger).error({ err }, 'Error no manejado');
  if (err.code === 'LIMIT_FILE_SIZE')
    return res.status(413).json({ error: 'Archivo demasiado grande' });
  const pg = pgErrorToHttp(err);
  if (pg)
    return res.status(pg.status).json({ error: pg.error, ...(isProduction ? {} : pg.detail && { detail: pg.detail }) });
  const message = isProduction ? 'Error interno del servidor' : (err.message || 'Error interno del servidor');
  res.status(500).json({ error: message });
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    logger.info(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    logger.info(`📂 Uploads en: ${path.resolve(uploadsDir)}`);
  });
}

module.exports = app;
