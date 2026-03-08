// src/utils/uploads.js
const path = require('path');
const fs = require('fs');

const uploadsDir = path.resolve(process.env.UPLOADS_DIR || './uploads');

/**
 * Resuelve la ruta absoluta de un archivo subido a partir de su URL (ej: /uploads/voucher-123.jpg).
 * Usa UPLOADS_DIR para ser consistente con multer y el servidor estático.
 */
function resolveUploadPath(relativeUrl) {
  if (!relativeUrl || typeof relativeUrl !== 'string') return null;
  const filename = relativeUrl.replace(/^\/uploads\/?/, '').replace(/^.*[\\/]/, '');
  if (!filename) return null;
  return path.join(uploadsDir, filename);
}

/**
 * Intenta borrar un archivo de uploads por su URL. No lanza si el archivo no existe.
 */
function tryDeleteUpload(relativeUrl) {
  const filePath = resolveUploadPath(relativeUrl);
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    console.warn('No se pudo eliminar archivo de uploads:', e.message);
  }
}

module.exports = { uploadsDir, resolveUploadPath, tryDeleteUpload };
