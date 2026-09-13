// src/config/env.js
function requireEnv(keys) {
  const missing = keys.filter((k) => !process.env[k] || String(process.env[k]).trim() === '');
  if (missing.length) {
    console.error('❌ Faltan variables de entorno requeridas:', missing.join(', '));
    console.error('   Revisa tu archivo .env o la configuración del servidor.');
    process.exit(1);
  }
}

const MIN_SECRET_LENGTH = 32;

// El .env.example (y por un tiempo el .env real del repo) trae estos valores
// de ejemplo, que quedaron públicos en el historial de git. Si algún deploy
// arranca con uno de ellos sin cambiarlo, cualquiera podría forjar JWTs
// válidos — por eso se rechaza explícitamente, además del chequeo de largo
// mínimo genérico.
function isWeakSecret(value) {
  const v = String(value || '');
  return v.length < MIN_SECRET_LENGTH || v.toLowerCase().startsWith('cambia_esto_por');
}

function ensureEnv() {
  requireEnv(['JWT_SECRET', 'JWT_REFRESH_SECRET']);
  if (process.env.NODE_ENV === 'production') {
    requireEnv(['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']);

    const weak = ['JWT_SECRET', 'JWT_REFRESH_SECRET'].filter((k) => isWeakSecret(process.env[k]));
    if (weak.length) {
      console.error(`❌ ${weak.join(', ')} usa un valor de ejemplo o demasiado corto (mínimo ${MIN_SECRET_LENGTH} caracteres).`);
      console.error('   Genera un secreto aleatorio y largo antes de desplegar a producción.');
      process.exit(1);
    }
  }
}

module.exports = { requireEnv, ensureEnv };
