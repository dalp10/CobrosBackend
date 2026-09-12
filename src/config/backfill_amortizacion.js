// src/config/backfill_amortizacion.js
// Calcula y guarda monto_capital/monto_interes para las cuotas existentes
// que aún no tienen ese desglose, usando el saldo de capital decreciente
// a partir de monto_original y tasa_interes de cada préstamo.
const { Pool } = require('pg');
require('dotenv').config();
const { calcularCronograma } = require('../utils/amortizacion');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const run = async () => {
  const client = await pool.connect();
  try {
    const { rows: prestamos } = await client.query('SELECT id, monto_original, tasa_interes FROM prestamos');
    for (const pr of prestamos) {
      const { rows: cuotas } = await client.query(
        'SELECT id, numero_cuota, monto_esperado FROM cuotas WHERE prestamo_id = $1 ORDER BY numero_cuota',
        [pr.id]
      );
      if (!cuotas.length) continue;

      const conSplit = calcularCronograma(cuotas, parseFloat(pr.monto_original), pr.tasa_interes);
      for (const c of conSplit) {
        await client.query(
          'UPDATE cuotas SET monto_capital = $1, monto_interes = $2 WHERE id = $3',
          [c.monto_capital, c.monto_interes, c.id]
        );
      }
    }
    console.log(`✅ Desglose capital/interés calculado para ${prestamos.length} préstamos`);
  } finally {
    client.release();
    await pool.end();
  }
};

run().catch(err => { console.error(err); process.exit(1); });
