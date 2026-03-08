// scripts/clean-duplicate-data.js
// Limpia datos duplicados en todas las tablas:
// 1. Deudores: une por (nombre, apellidos) → reasigna préstamos/pagos y borra duplicados.
// 2. Préstamos: une por (deudor_id, descripcion, monto_original, fecha_inicio) → reasigna pagos y borra préstamos duplicados.
// 3. Pagos: elimina pagos duplicados por (prestamo_id, fecha_pago, monto), dejando uno por grupo.
// Uso: npm run db:clean-duplicates
require('dotenv').config();
const { getClient } = require('../src/config/db');

async function run() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // ─── 1. DEUDORES ─────────────────────────────────────────────
    const upPrestamosDeudor = await client.query(`
      WITH canon AS (
        SELECT nombre, apellidos, MIN(id) AS canon_id
        FROM deudores
        GROUP BY nombre, apellidos
      )
      UPDATE prestamos pr
      SET deudor_id = canon.canon_id
      FROM deudores d, canon
      WHERE pr.deudor_id = d.id
        AND d.nombre = canon.nombre AND d.apellidos = canon.apellidos
        AND pr.deudor_id != canon.canon_id
    `);
    const upPagosDeudor = await client.query(`
      WITH canon AS (
        SELECT nombre, apellidos, MIN(id) AS canon_id
        FROM deudores
        GROUP BY nombre, apellidos
      )
      UPDATE pagos p
      SET deudor_id = canon.canon_id
      FROM deudores d, canon
      WHERE p.deudor_id = d.id
        AND d.nombre = canon.nombre AND d.apellidos = canon.apellidos
        AND p.deudor_id != canon.canon_id
    `);
    const delDeudores = await client.query(`
      DELETE FROM deudores
      WHERE id NOT IN (
        SELECT MIN(id) FROM deudores GROUP BY nombre, apellidos
      )
    `);

    // ─── 2. PRÉSTAMOS (mismo deudor + misma descripción/monto/fecha = mismo préstamo) ───
    const upPagosPrestamo = await client.query(`
      WITH canon AS (
        SELECT deudor_id, descripcion, monto_original, fecha_inicio,
               MIN(id) AS canon_id
        FROM prestamos
        GROUP BY deudor_id, descripcion, monto_original, fecha_inicio
      )
      UPDATE pagos p
      SET prestamo_id = canon.canon_id
      FROM prestamos pr, canon
      WHERE p.prestamo_id = pr.id
        AND pr.deudor_id = canon.deudor_id
        AND (pr.descripcion IS NOT DISTINCT FROM canon.descripcion)
        AND pr.monto_original = canon.monto_original
        AND pr.fecha_inicio = canon.fecha_inicio
        AND p.prestamo_id != canon.canon_id
    `);
    const delPrestamos = await client.query(`
      DELETE FROM prestamos
      WHERE id NOT IN (
        SELECT MIN(id) FROM prestamos
        GROUP BY deudor_id, descripcion, monto_original, fecha_inicio
      )
    `);

    // ─── 3. PAGOS duplicados (mismo préstamo, misma fecha y monto → dejar uno) ───
    const delPagosDup = await client.query(`
      DELETE FROM pagos
      WHERE id IN (
        SELECT id FROM (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY prestamo_id, fecha_pago, monto
                   ORDER BY id
                 ) AS rn
          FROM pagos
          WHERE prestamo_id IS NOT NULL
        ) t
        WHERE rn > 1
      )
    `);
    // Pagos sin prestamo_id: duplicados por (deudor_id, fecha_pago, monto)
    const delPagosSinPrestamoDup = await client.query(`
      DELETE FROM pagos
      WHERE id IN (
        SELECT id FROM (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY deudor_id, fecha_pago, monto
                   ORDER BY id
                 ) AS rn
          FROM pagos
          WHERE prestamo_id IS NULL
        ) t
        WHERE rn > 1
      )
    `);

    await client.query('COMMIT');
    console.log('Limpieza de datos duplicados OK.');
    console.log('  Deudores: préstamos reasignados:', upPrestamosDeudor.rowCount, '| pagos reasignados:', upPagosDeudor.rowCount, '| duplicados eliminados:', delDeudores.rowCount);
    console.log('  Préstamos: pagos reasignados:', upPagosPrestamo.rowCount, '| duplicados eliminados:', delPrestamos.rowCount);
    console.log('  Pagos duplicados eliminados (con prestamo):', delPagosDup.rowCount, '| (sin prestamo):', delPagosSinPrestamoDup.rowCount);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
}

run();
