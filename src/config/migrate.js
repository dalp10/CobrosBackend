// src/config/migrate.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const createTables = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── USUARIOS (acceso al sistema) ──────────────────────────────
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

    // ── DEUDORES ─────────────────────────────────────────────────
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

    // ── CUOTAS (cronograma de pagos esperados) ───────────────────
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

    // ── PAGOS (registros reales de dinero recibido) ──────────────
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

    // ── ÍNDICES para performance ──────────────────────────────────
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pagos_deudor    ON pagos(deudor_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pagos_prestamo  ON pagos(prestamo_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pagos_fecha     ON pagos(fecha_pago);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_cuotas_prestamo ON cuotas(prestamo_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_prestamos_deudor ON prestamos(deudor_id);`);

    // ── FUNCIÓN auto-update updated_at ───────────────────────────
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
    console.log('✅ Tablas creadas correctamente');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error en migración:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
};

createTables().catch(() => process.exit(1));
