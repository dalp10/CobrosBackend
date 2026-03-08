// src/index.js
const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const helmet   = require('helmet');
require('dotenv').config();

const { ensureEnv } = require('./config/env');
const { checkDb } = require('./config/health');
const { pgErrorToHttp } = require('./utils/pgErrors');

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
  console.warn('⚠️  ALLOWED_ORIGINS no está definido. Define en Railway la URL de tu frontend (ej. https://tu-app.vercel.app).');
}

// ── Middlewares globales ───────────────────────────────────────
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

// Rate limit general para /api (excluir health para que el orchestrator no falle)
const { apiLimiter } = require('./middleware/rateLimit');
app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();
  return apiLimiter(req, res, next);
});

// Servir archivos subidos (vouchers/imágenes)
const uploadsDir = process.env.UPLOADS_DIR || './uploads';
app.use('/uploads', express.static(path.resolve(uploadsDir)));

// ── Rutas ──────────────────────────────────────────────────────
app.use('/api/auth',      require('./routes/auth.routes'));
app.use('/api/deudores',  require('./routes/deudores.routes'));
app.use('/api/prestamos', require('./routes/prestamos.routes'));
app.use('/api/usuarios',  require('./routes/usuarios.routes'));
app.use('/api/pagos',     require('./routes/pagos.routes'));

// ── Health check ───────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await checkDb();
    res.json({ status: 'ok', timestamp: new Date().toISOString(), db: 'connected' });
  } catch (err) {
    console.error('Health check DB:', err.message);
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
  console.error('Error no manejado:', err);
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
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📂 Uploads en: ${path.resolve(uploadsDir)}`);
  });
}

module.exports = app;
