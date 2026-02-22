// src/index.js
const express  = require('express');
const cors     = require('cors');
const path     = require('path');
require('dotenv').config();

const app = express();

// ── Middlewares globales ───────────────────────────────────────
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || 'http://localhost:4200',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
);

// ── Error handler global ───────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  if (err.code === 'LIMIT_FILE_SIZE')
    return res.status(413).json({ error: 'Archivo demasiado grande' });
  res.status(500).json({ error: err.message || 'Error interno del servidor' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📂 Uploads en: ${path.resolve(uploadsDir)}`);
});
