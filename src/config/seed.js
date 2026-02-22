// src/config/seed.js
// Carga los datos iniciales extraídos de los documentos
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT,
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── USUARIO ADMIN ─────────────────────────────────────────────
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('admin123', 10);
    await client.query(`
      INSERT INTO usuarios (nombre, email, password, rol)
      VALUES ('Administrador', 'admin@cobros.com', $1, 'admin')
      ON CONFLICT (email) DO NOTHING;
    `, [hash]);

    // ── DEUDORES ─────────────────────────────────────────────────
    const { rows: [maritza] } = await client.query(`
      INSERT INTO deudores (nombre, apellidos, notas)
      VALUES ('Maritza', 'Paredes Piña', 'Préstamo BanBif + Pandero activo')
      ON CONFLICT DO NOTHING RETURNING id;
    `);
    const { rows: [pedro] } = await client.query(`
      INSERT INTO deudores (nombre, apellidos, notas)
      VALUES ('Pedro', 'Reátegui Carpi', 'Préstamo personal')
      ON CONFLICT DO NOTHING RETURNING id;
    `);
    const { rows: [miguel] } = await client.query(`
      INSERT INTO deudores (nombre, apellidos, notas)
      VALUES ('Miguel', 'Ríos', 'Cuotas variables registradas en cuaderno')
      ON CONFLICT DO NOTHING RETURNING id;
    `);
    const { rows: [annie] } = await client.query(`
      INSERT INTO deudores (nombre, apellidos, notas)
      VALUES ('Annie', 'Muñoz', 'Pagos vía Interbank')
      ON CONFLICT DO NOTHING RETURNING id;
    `);

    const mid = maritza?.id, pid = pedro?.id, mgid = miguel?.id, aid = annie?.id;
    if (!mid) { console.log('⚠️  Seed ya ejecutado anteriormente.'); await client.query('ROLLBACK'); return; }

    // ── PRÉSTAMO MARITZA - BanBif ─────────────────────────────────
    const { rows: [loanMaritza] } = await client.query(`
      INSERT INTO prestamos (deudor_id, tipo, descripcion, monto_original, tasa_interes,
        total_cuotas, cuota_mensual, fecha_inicio, fecha_fin, estado, banco, numero_operacion)
      VALUES ($1, 'prestamo_bancario', 'Préstamo Personal BanBif', 40000.00, 0.3737,
        48, 1506.13, '2023-04-01', '2027-04-01', 'activo', 'BanBif', '241101778500')
      RETURNING id;
    `, [mid]);

    // Cuotas BanBif (48 cuotas desde abr 2023)
    for (let i = 1; i <= 48; i++) {
      const d = new Date('2023-04-01');
      d.setMonth(d.getMonth() + (i - 1));
      const fechaVenc = d.toISOString().split('T')[0];
      const estado = i <= 23 ? 'pagado' : 'pendiente';
      const montoPagado = i <= 23 ? 1506.13 : 0;
      await client.query(`
        INSERT INTO cuotas (prestamo_id, numero_cuota, fecha_vencimiento, monto_esperado, monto_pagado, estado)
        VALUES ($1, $2, $3, 1506.13, $4, $5)
      `, [loanMaritza.id, i, fechaVenc, montoPagado, estado]);
    }

    // ── PRÉSTAMO MARITZA - Pandero ────────────────────────────────
    const { rows: [loanPandero] } = await client.query(`
      INSERT INTO prestamos (deudor_id, tipo, descripcion, monto_original,
        total_cuotas, cuota_mensual, fecha_inicio, fecha_fin, estado, notas)
      VALUES ($1, 'pandero', 'Pandero 12 meses', 6000.00,
        12, 500.00, '2025-10-15', '2026-09-15', 'activo',
        'Premio de S/6,000 en junio 2026 (mes 9)')
      RETURNING id;
    `, [mid]);

    const panderoMeses = [
      {mes:1,fecha:'2025-10-15',pagado:true}, {mes:2,fecha:'2025-11-15',pagado:true},
      {mes:3,fecha:'2025-12-15',pagado:true}, {mes:4,fecha:'2026-01-15',pagado:true},
      {mes:5,fecha:'2026-02-15',pagado:true}, {mes:6,fecha:'2026-03-15',pagado:false},
      {mes:7,fecha:'2026-04-15',pagado:false},{mes:8,fecha:'2026-05-15',pagado:false},
      {mes:9,fecha:'2026-06-15',pagado:false,premio:true},
      {mes:10,fecha:'2026-07-15',pagado:false},{mes:11,fecha:'2026-08-15',pagado:false},
      {mes:12,fecha:'2026-09-15',pagado:false},
    ];
    for (const pm of panderoMeses) {
      await client.query(`
        INSERT INTO cuotas (prestamo_id, numero_cuota, fecha_vencimiento,
          monto_esperado, monto_pagado, estado, es_premio_pandero, monto_premio)
        VALUES ($1,$2,$3,500,$4,$5,$6,$7)
      `, [loanPandero.id, pm.mes, pm.fecha,
          pm.pagado ? 500 : 0,
          pm.pagado ? 'pagado' : 'pendiente',
          !!pm.premio, pm.premio ? 6000 : null]);
    }

    // ── PRÉSTAMO PEDRO ────────────────────────────────────────────
    const { rows: [loanPedro] } = await client.query(`
      INSERT INTO prestamos (deudor_id, tipo, descripcion, monto_original, fecha_inicio, estado)
      VALUES ($1, 'prestamo_personal', 'Préstamo personal (1000+2000+300)', 3300.00, '2021-03-28', 'activo')
      RETURNING id;
    `, [pid]);

    // ── PRÉSTAMO MIGUEL ───────────────────────────────────────────
    const { rows: [loanMiguel] } = await client.query(`
      INSERT INTO prestamos (deudor_id, tipo, descripcion, monto_original, fecha_inicio, estado)
      VALUES ($1, 'prestamo_personal', 'Préstamo personal Lena Mayan', 3600.00, '2024-01-01', 'activo')
      RETURNING id;
    `, [mgid]);

    // ── PRÉSTAMO ANNIE ────────────────────────────────────────────
    const { rows: [loanAnnie] } = await client.query(`
      INSERT INTO prestamos (deudor_id, tipo, descripcion, monto_original, fecha_inicio, estado)
      VALUES ($1, 'prestamo_personal', 'Préstamo personal', 4052.26, '2026-01-13', 'activo')
      RETURNING id;
    `, [aid]);

    // ── PAGOS MARITZA (Yape desde documentos) ─────────────────────
    const pagosMaritza = [
      { fecha:'2025-12-07', monto:500,  metodo:'yape', op:'08189990', concepto:'Abono cuota BanBif' },
      { fecha:'2026-01-14', monto:300,  metodo:'yape', op:'18135629', concepto:'Abono cuota BanBif' },
      { fecha:'2026-02-05', monto:200,  metodo:'yape', op:'22467785', concepto:'Abono cuota BanBif' },
      { fecha:'2025-10-15', monto:500,  metodo:'pandero', op:'-', concepto:'Pandero Oct 2025' },
      { fecha:'2025-11-15', monto:500,  metodo:'pandero', op:'-', concepto:'Pandero Nov 2025' },
      { fecha:'2025-12-15', monto:500,  metodo:'pandero', op:'-', concepto:'Pandero Dic 2025' },
      { fecha:'2026-01-15', monto:500,  metodo:'pandero', op:'-', concepto:'Pandero Ene 2026' },
      { fecha:'2026-02-15', monto:500,  metodo:'pandero', op:'-', concepto:'Pandero Feb 2026' },
    ];
    for (const p of pagosMaritza) {
      await client.query(`INSERT INTO pagos (deudor_id,prestamo_id,fecha_pago,monto,metodo_pago,numero_operacion,concepto)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [mid, p.metodo==='pandero'?loanPandero.id:loanMaritza.id, p.fecha, p.monto, p.metodo, p.op, p.concepto]);
    }

    // ── PAGOS PEDRO ───────────────────────────────────────────────
    const pagosPedro = [
      { fecha:'2024-07-06', monto:300,  metodo:'efectivo', op:'-',        concepto:'Abono #3' },
      { fecha:'2024-08-12', monto:200,  metodo:'efectivo', op:'-',        concepto:'Abono #4' },
      { fecha:'2024-08-24', monto:200,  metodo:'efectivo', op:'-',        concepto:'Abono #5' },
      { fecha:'2024-09-17', monto:200,  metodo:'efectivo', op:'-',        concepto:'Abono #6' },
      { fecha:'2024-10-23', monto:100,  metodo:'efectivo', op:'-',        concepto:'Abono #7' },
      { fecha:'2024-10-31', monto:200,  metodo:'efectivo', op:'-',        concepto:'Abono #8' },
      { fecha:'2024-11-11', monto:100,  metodo:'efectivo', op:'-',        concepto:'Abono #9' },
      { fecha:'2024-11-19', monto:150,  metodo:'efectivo', op:'-',        concepto:'Abono #10' },
      { fecha:'2024-12-10', monto:150,  metodo:'efectivo', op:'-',        concepto:'Abono #11' },
      { fecha:'2024-12-22', monto:200,  metodo:'efectivo', op:'-',        concepto:'Abono #12' },
      { fecha:'2025-01-02', monto:150,  metodo:'efectivo', op:'-',        concepto:'Abono #13' },
      { fecha:'2025-01-19', monto:200,  metodo:'yape',     op:'15704251', concepto:'Abono Yape' },
      { fecha:'2025-02-02', monto:200,  metodo:'yape',     op:'17914939', concepto:'Abono Yape' },
      { fecha:'2025-02-09', monto:200,  metodo:'yape',     op:'13736653', concepto:'Abono Yape' },
      { fecha:'2025-03-09', monto:200,  metodo:'yape',     op:'11294692', concepto:'Abono Yape' },
      { fecha:'2025-03-24', monto:150,  metodo:'yape',     op:'05116599', concepto:'Abono Yape' },
      { fecha:'2025-04-20', monto:200,  metodo:'yape',     op:'12903445', concepto:'Abono Yape' },
      { fecha:'2025-05-11', monto:150,  metodo:'yape',     op:'16329360', concepto:'Abono Yape' },
      { fecha:'2025-05-27', monto:100,  metodo:'yape',     op:'01673408', concepto:'Abono Yape' },
      { fecha:'2025-06-26', monto:150,  metodo:'yape',     op:'18431474', concepto:'Abono Yape' },
      { fecha:'2025-07-24', monto:100,  metodo:'yape',     op:'08395950', concepto:'Abono Yape' },
      { fecha:'2025-08-18', monto:150,  metodo:'yape',     op:'04046922', concepto:'Abono Yape' },
      { fecha:'2025-09-21', monto:150,  metodo:'yape',     op:'18619440', concepto:'Abono Yape' },
      { fecha:'2025-10-06', monto:100,  metodo:'yape',     op:'10497510', concepto:'Abono Yape' },
      { fecha:'2025-10-26', monto:15,   metodo:'yape',     op:'24832056', concepto:'Abono Yape' },
      { fecha:'2025-10-26', monto:135,  metodo:'yape',     op:'24949372', concepto:'Abono Yape' },
      { fecha:'2025-11-24', monto:150,  metodo:'yape',     op:'19321300', concepto:'Abono Yape' },
      { fecha:'2025-12-14', monto:150,  metodo:'yape',     op:'10499925', concepto:'Abono Yape' },
      { fecha:'2025-12-19', monto:300,  metodo:'yape',     op:'21363725', concepto:'Abono Yape' },
      { fecha:'2025-12-19', monto:200,  metodo:'yape',     op:'25872899', concepto:'Abono Yape' },
      { fecha:'2026-01-11', monto:200,  metodo:'yape',     op:'19714059', concepto:'Abono Yape' },
      { fecha:'2026-02-01', monto:200,  metodo:'yape',     op:'14869100', concepto:'Abono Yape' },
    ];
    for (const p of pagosPedro) {
      await client.query(`INSERT INTO pagos (deudor_id,prestamo_id,fecha_pago,monto,metodo_pago,numero_operacion,concepto)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [pid, loanPedro.id, p.fecha, p.monto, p.metodo, p.op, p.concepto]);
    }

    // ── PAGOS MIGUEL ──────────────────────────────────────────────
    const pagosMiguel = [
      { fecha:'2024-01-01', monto:600, metodo:'efectivo',      op:'-',        concepto:'Pago #1' },
      { fecha:'2024-02-01', monto:650, metodo:'efectivo',      op:'-',        concepto:'Pago #2' },
      { fecha:'2024-03-01', monto:650, metodo:'efectivo',      op:'-',        concepto:'Pago #3' },
      { fecha:'2024-08-03', monto:600, metodo:'efectivo',      op:'-',        concepto:'Pago #4' },
      { fecha:'2024-09-17', monto:400, metodo:'efectivo',      op:'-',        concepto:'Pago #5' },
      { fecha:'2024-11-09', monto:600, metodo:'efectivo',      op:'-',        concepto:'Pago #6' },
      { fecha:'2025-01-08', monto:500, metodo:'yape',          op:'01892500', concepto:'Pago Yape' },
      { fecha:'2025-08-01', monto:600, metodo:'transferencia', op:'05393006', concepto:'Pago Interbank', banco:'Interbank' },
      { fecha:'2025-09-05', monto:300, metodo:'yape',          op:'18593202', concepto:'Pago Yape' },
      { fecha:'2025-10-10', monto:500, metodo:'yape',          op:'10957101', concepto:'Pago Yape' },
      { fecha:'2026-02-05', monto:500, metodo:'efectivo',      op:'-',        concepto:'Pago #11 efectivo' },
    ];
    for (const p of pagosMiguel) {
      await client.query(`INSERT INTO pagos (deudor_id,prestamo_id,fecha_pago,monto,metodo_pago,numero_operacion,concepto,banco_origen)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [mgid, loanMiguel.id, p.fecha, p.monto, p.metodo, p.op, p.concepto, p.banco||null]);
    }

    // ── PAGOS ANNIE ───────────────────────────────────────────────
    const pagosAnnie = [
      { fecha:'2026-01-13', monto:1052.26, metodo:'transferencia', op:'0133370',  concepto:'Transferencia Interbank', banco:'Interbank' },
      { fecha:'2026-02-11', monto:1000.00, metodo:'transferencia', op:'1030664',  concepto:'Transferencia Interbank', banco:'Interbank' },
    ];
    for (const p of pagosAnnie) {
      await client.query(`INSERT INTO pagos (deudor_id,prestamo_id,fecha_pago,monto,metodo_pago,numero_operacion,concepto,banco_origen)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [aid, loanAnnie.id, p.fecha, p.monto, p.metodo, p.op, p.concepto, p.banco]);
    }

    await client.query('COMMIT');
    console.log('✅ Datos iniciales cargados correctamente');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error en seed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(() => process.exit(1));
