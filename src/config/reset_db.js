// src/config/reset_db.js
// ⚠️  CUIDADO: Elimina TODA la base de datos y la recrea desde cero
// Uso: node src/config/reset_db.js

const { Pool } = require('pg');
require('dotenv').config();

// Conectamos a la base 'postgres' (default) para poder DROP/CREATE la DB
const adminPool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: 'postgres',                          // ← base admin, no cobros_db
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

const DB_NAME = process.env.DB_NAME || 'cobros_db';

async function resetDatabase() {
  const client = await adminPool.connect();
  try {
    console.log(`🗑️  Eliminando base de datos "${DB_NAME}"...`);

    // Terminar conexiones activas antes de DROP
    await client.query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid();
    `, [DB_NAME]);

    await client.query(`DROP DATABASE IF EXISTS "${DB_NAME}";`);
    console.log(`✅ Base de datos "${DB_NAME}" eliminada.`);

    await client.query(`CREATE DATABASE "${DB_NAME}";`);
    console.log(`✅ Base de datos "${DB_NAME}" creada.`);

  } catch (err) {
    console.error('❌ Error al resetear la base de datos:', err.message);
    throw err;
  } finally {
    client.release();
    await adminPool.end();
  }
}

// ── MIGRATE ──────────────────────────────────────────────────────────────────
async function migrate() {
  const pool = new Pool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 5432,
    database: DB_NAME,
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || '',
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('\n📦 Creando tablas...');

    // ── USUARIOS ──────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id          SERIAL PRIMARY KEY,
        nombre      VARCHAR(100) NOT NULL,
        email       VARCHAR(150) UNIQUE NOT NULL,
        password    VARCHAR(255) NOT NULL,
        rol         VARCHAR(20) DEFAULT 'admin',
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── DEUDORES ──────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS deudores (
        id              SERIAL PRIMARY KEY,
        nombre          VARCHAR(150) NOT NULL,
        apellidos       VARCHAR(150) NOT NULL,
        dni             VARCHAR(20),
        telefono        VARCHAR(20),
        email           VARCHAR(150),
        direccion       TEXT,
        notas           TEXT,
        activo          BOOLEAN DEFAULT true,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── PRÉSTAMOS ─────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS prestamos (
        id              SERIAL PRIMARY KEY,
        deudor_id       INTEGER NOT NULL REFERENCES deudores(id) ON DELETE CASCADE,
        tipo            VARCHAR(30) NOT NULL CHECK (tipo IN ('prestamo_personal','prestamo_bancario','pandero','otro')),
        descripcion     VARCHAR(255),
        monto_original  NUMERIC(12,2) NOT NULL,
        tasa_interes    NUMERIC(6,4) DEFAULT 0,
        total_cuotas    INTEGER DEFAULT 1,
        cuota_mensual   NUMERIC(12,2),
        fecha_inicio    DATE NOT NULL,
        fecha_fin       DATE,
        estado          VARCHAR(20) DEFAULT 'activo' CHECK (estado IN ('activo','pagado','vencido','cancelado')),
        banco           VARCHAR(100),
        numero_operacion VARCHAR(100),
        notas           TEXT,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── CUOTAS ────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS cuotas (
        id              SERIAL PRIMARY KEY,
        prestamo_id     INTEGER NOT NULL REFERENCES prestamos(id) ON DELETE CASCADE,
        numero_cuota    INTEGER NOT NULL,
        fecha_vencimiento DATE NOT NULL,
        monto_esperado  NUMERIC(12,2) NOT NULL,
        monto_pagado    NUMERIC(12,2) DEFAULT 0,
        estado          VARCHAR(20) DEFAULT 'pendiente' CHECK (estado IN ('pendiente','pagado','parcial','vencido')),
        es_premio_pandero BOOLEAN DEFAULT false,
        monto_premio    NUMERIC(12,2),
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(prestamo_id, numero_cuota)
      );
    `);

    // ── PAGOS ─────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS pagos (
        id              SERIAL PRIMARY KEY,
        deudor_id       INTEGER NOT NULL REFERENCES deudores(id) ON DELETE CASCADE,
        prestamo_id     INTEGER REFERENCES prestamos(id) ON DELETE SET NULL,
        cuota_id        INTEGER REFERENCES cuotas(id) ON DELETE SET NULL,
        fecha_pago      DATE NOT NULL,
        monto           NUMERIC(12,2) NOT NULL CHECK (monto > 0),
        metodo_pago     VARCHAR(30) NOT NULL CHECK (metodo_pago IN ('efectivo','yape','plin','transferencia','pandero','otro')),
        numero_operacion VARCHAR(100),
        banco_origen    VARCHAR(100),
        concepto        VARCHAR(255),
        notas           TEXT,
        imagen_url      VARCHAR(500),
        imagen_nombre   VARCHAR(255),
        registrado_por  INTEGER REFERENCES usuarios(id),
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── ÍNDICES ───────────────────────────────────────────────────
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pagos_deudor     ON pagos(deudor_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pagos_prestamo   ON pagos(prestamo_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pagos_fecha      ON pagos(fecha_pago);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_cuotas_prestamo  ON cuotas(prestamo_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_prestamos_deudor ON prestamos(deudor_id);`);

    // ── TRIGGER updated_at ────────────────────────────────────────
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
      $$ language 'plpgsql';
    `);
    for (const tbl of ['deudores', 'prestamos', 'pagos']) {
      await client.query(`
        DROP TRIGGER IF EXISTS trg_${tbl}_updated ON ${tbl};
        CREATE TRIGGER trg_${tbl}_updated
          BEFORE UPDATE ON ${tbl}
          FOR EACH ROW EXECUTE FUNCTION update_updated_at();
      `);
    }

    await client.query('COMMIT');
    console.log('✅ Tablas creadas correctamente.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error en migración:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// ── SEED ─────────────────────────────────────────────────────────────────────
async function seed() {
  const pool = new Pool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 5432,
    database: DB_NAME,
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || '',
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('\n🌱 Insertando datos iniciales...');

    // ── USUARIO ADMIN ─────────────────────────────────────────────
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('admin123', 10);
    await client.query(`
      INSERT INTO usuarios (nombre, email, password, rol)
      VALUES ('Administrador', 'admin@cobros.com', $1, 'admin')
      ON CONFLICT (email) DO NOTHING;
    `, [hash]);

    // ── DEUDORES ──────────────────────────────────────────────────
    const { rows: [maritza] } = await client.query(`
      INSERT INTO deudores (nombre, apellidos, notas)
      VALUES ('Maritza', 'Paredes Piña', 'Préstamo BanBif + Pandero activo')
      RETURNING id;
    `);
    const { rows: [pedro] } = await client.query(`
      INSERT INTO deudores (nombre, apellidos, notas)
      VALUES ('Pedro', 'Reátegui Carpi', 'Préstamo personal')
      RETURNING id;
    `);
    const { rows: [miguel] } = await client.query(`
      INSERT INTO deudores (nombre, apellidos, notas)
      VALUES ('Miguel', 'Ríos', 'Cuotas variables registradas en cuaderno')
      RETURNING id;
    `);
    const { rows: [annie] } = await client.query(`
      INSERT INTO deudores (nombre, apellidos, notas)
      VALUES ('Annie', 'Muñoz', 'Pagos vía Interbank')
      RETURNING id;
    `);

    const mid = maritza.id, pid = pedro.id, mgid = miguel.id, aid = annie.id;

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
      {mes:1, fecha:'2025-10-15', pagado:true},
      {mes:2, fecha:'2025-11-15', pagado:true},
      {mes:3, fecha:'2025-12-15', pagado:true},
      {mes:4, fecha:'2026-01-15', pagado:true},
      {mes:5, fecha:'2026-02-15', pagado:true},
      {mes:6, fecha:'2026-03-15', pagado:false},
      {mes:7, fecha:'2026-04-15', pagado:false},
      {mes:8, fecha:'2026-05-15', pagado:false},
      {mes:9, fecha:'2026-06-15', pagado:false, premio:true},
      {mes:10,fecha:'2026-07-15', pagado:false},
      {mes:11,fecha:'2026-08-15', pagado:false},
      {mes:12,fecha:'2026-09-15', pagado:false},
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

    // ── PAGOS MARITZA ─────────────────────────────────────────────
    const pagosMaritza = [
      { fecha:'2025-12-07', monto:500,  metodo:'yape',    op:'08189990', concepto:'Abono cuota BanBif' },
      { fecha:'2026-01-14', monto:300,  metodo:'yape',    op:'18135629', concepto:'Abono cuota BanBif' },
      { fecha:'2026-02-05', monto:200,  metodo:'yape',    op:'22467785', concepto:'Abono cuota BanBif' },
      { fecha:'2025-10-15', monto:500,  metodo:'pandero', op:'-',        concepto:'Pandero Oct 2025' },
      { fecha:'2025-11-15', monto:500,  metodo:'pandero', op:'-',        concepto:'Pandero Nov 2025' },
      { fecha:'2025-12-15', monto:500,  metodo:'pandero', op:'-',        concepto:'Pandero Dic 2025' },
      { fecha:'2026-01-15', monto:500,  metodo:'pandero', op:'-',        concepto:'Pandero Ene 2026' },
      { fecha:'2026-02-15', monto:500,  metodo:'pandero', op:'-',        concepto:'Pandero Feb 2026' },
    ];
    for (const p of pagosMaritza) {
      await client.query(
        `INSERT INTO pagos (deudor_id,prestamo_id,fecha_pago,monto,metodo_pago,numero_operacion,concepto)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [mid, p.metodo==='pandero' ? loanPandero.id : loanMaritza.id,
         p.fecha, p.monto, p.metodo, p.op, p.concepto]
      );
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
      { fecha:'2025-12-14', monto:150,  metodo:'yape',     op:'10499925', concepto:'Abono Yape' }, // ✅ agregado
      { fecha:'2026-01-11', monto:200,  metodo:'yape',     op:'19714059', concepto:'Abono Yape' },
      { fecha:'2026-02-01', monto:200,  metodo:'yape',     op:'14869100', concepto:'Abono Yape' },
    ];
    for (const p of pagosPedro) {
      await client.query(
        `INSERT INTO pagos (deudor_id,prestamo_id,fecha_pago,monto,metodo_pago,numero_operacion,concepto)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [pid, loanPedro.id, p.fecha, p.monto, p.metodo, p.op, p.concepto]
      );
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
      { fecha:'2025-12-19', monto:300, metodo:'yape',          op:'21363725', concepto:'Pago Yape' }, // ✅ agregado
      { fecha:'2025-12-19', monto:200, metodo:'yape',          op:'25872899', concepto:'Pago Yape' }, // ✅ agregado (era de Pedro, corregido)
      { fecha:'2026-02-05', monto:500, metodo:'efectivo',      op:'-',        concepto:'Pago #11 efectivo' },
    ];
    for (const p of pagosMiguel) {
      await client.query(
        `INSERT INTO pagos (deudor_id,prestamo_id,fecha_pago,monto,metodo_pago,numero_operacion,concepto,banco_origen)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [mgid, loanMiguel.id, p.fecha, p.monto, p.metodo, p.op, p.concepto, p.banco||null]
      );
    }

    // ── PAGOS ANNIE ───────────────────────────────────────────────
    const pagosAnnie = [
      { fecha:'2026-01-13', monto:1052.26, metodo:'transferencia', op:'0133370', concepto:'Transferencia Interbank', banco:'Interbank' },
      { fecha:'2026-02-11', monto:1000.00, metodo:'transferencia', op:'1030664', concepto:'Transferencia Interbank', banco:'Interbank' },
    ];
    for (const p of pagosAnnie) {
      await client.query(
        `INSERT INTO pagos (deudor_id,prestamo_id,fecha_pago,monto,metodo_pago,numero_operacion,concepto,banco_origen)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [aid, loanAnnie.id, p.fecha, p.monto, p.metodo, p.op, p.concepto, p.banco]
      );
    }

    await client.query('COMMIT');
    console.log('✅ Datos iniciales cargados correctamente.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error en seed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
(async () => {
  try {
    await resetDatabase();
    await migrate();
    await seed();
    console.log('\n🎉 Base de datos lista para usar.');
  } catch (err) {
    console.error('\n💥 Proceso abortado:', err.message);
    process.exit(1);
  }
})();
