// src/config/env.js
function requireEnv(keys) {
  const missing = keys.filter((k) => !process.env[k] || String(process.env[k]).trim() === '');
  if (missing.length) {
    console.error('❌ Faltan variables de entorno requeridas:', missing.join(', '));
    console.error('   Revisa tu archivo .env o la configuración del servidor.');
    process.exit(1);
  }
}

function ensureEnv() {
  requireEnv(['JWT_SECRET']);
  if (process.env.NODE_ENV === 'production') {
    requireEnv(['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']);
  }
}

module.exports = { requireEnv, ensureEnv };
