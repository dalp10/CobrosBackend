// src/utils/pgErrors.js
/**
 * Mapea errores de PostgreSQL a respuesta HTTP (status + mensaje).
 * Ver: https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
function pgErrorToHttp(err) {
  if (!err || !err.code) return null;
  const code = err.code;
  const detail = err.detail || '';

  switch (code) {
    case '23505': // unique_violation
      return { status: 409, error: 'El registro ya existe', detail: detail || err.message };
    case '23503': // foreign_key_violation
      return { status: 400, error: 'Referencia inválida (registro relacionado no existe o en uso)', detail: detail || err.message };
    case '23502': // not_null_violation
      return { status: 400, error: 'Falta un campo obligatorio', detail: detail || err.message };
    case '22P02': // invalid_text_representation (ej. UUID o número inválido)
      return { status: 400, error: 'Valor inválido en un campo', detail: detail || err.message };
    case '23514': // check_violation
      return { status: 400, error: 'El valor no cumple las restricciones', detail: detail || err.message };
    default:
      return null;
  }
}

module.exports = { pgErrorToHttp };
