// src/utils/fechas.js
// Suma `n` meses a una fecha y devuelve 'YYYY-MM-DD'. Evita el bug clásico de
// `new Date(iso).setMonth()`: un string 'YYYY-MM-DD' se parsea como medianoche
// UTC, pero getMonth/setMonth operan en hora local — con zonas horarias
// negativas (ej. Perú, UTC-5) eso corre la fecha un día hacia atrás y hace que
// el "día 1" se lea como "día 31 del mes anterior", desbordando meses cortos
// (feb/abr/jun/sep/nov). Aquí se trabaja siempre con componentes UTC.
const addMonthsIso = (fecha, n) => {
  const iso = fecha instanceof Date ? fecha.toISOString().split('T')[0] : fecha;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, d)).toISOString().split('T')[0];
};

module.exports = { addMonthsIso };
