// Script de diagnóstico - pegar en la carpeta backend y ejecutar con: node debug-login.js
const { Pool } = require('pg');
require('dotenv').config();

console.log('\n🔍 DIAGNÓSTICO DEL SISTEMA\n');
console.log('Variables de entorno cargadas:');
console.log('  DB_HOST    :', process.env.DB_HOST);
console.log('  DB_PORT    :', process.env.DB_PORT);
console.log('  DB_NAME    :', process.env.DB_NAME);
console.log('  DB_USER    :', process.env.DB_USER);
console.log('  DB_PASSWORD:', process.env.DB_PASSWORD ? '****** (definido)' : '❌ VACÍO - FALTA DEFINIRLO');
console.log('  JWT_SECRET :', process.env.JWT_SECRET ? '****** (definido)' : '❌ VACÍO - FALTA DEFINIRLO');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'cobros_db',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

async function run() {
  console.log('\n📡 Intentando conectar a PostgreSQL...');
  let client;
  try {
    client = await pool.connect();
    console.log('✅ Conexión exitosa a PostgreSQL\n');

    // Verificar tablas
    const { rows: tables } = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    console.log('📋 Tablas en la base de datos:');
    if (tables.length === 0) {
      console.log('  ❌ NO HAY TABLAS — Debes ejecutar: node src/config/migrate.js');
    } else {
      tables.forEach(t => console.log('  ✅', t.table_name));
    }

    // Verificar usuarios
    if (tables.find(t => t.table_name === 'usuarios')) {
      const { rows: users } = await client.query('SELECT id, nombre, email, rol FROM usuarios;');
      console.log('\n👤 Usuarios registrados:');
      if (users.length === 0) {
        console.log('  ❌ NO HAY USUARIOS — Debes ejecutar: node src/config/seed.js');
      } else {
        users.forEach(u => console.log(`  ✅ id=${u.id} | ${u.email} | ${u.rol}`));
      }
    }

    // Verificar deudores
    if (tables.find(t => t.table_name === 'deudores')) {
      const { rows: deudores } = await client.query('SELECT id, nombre, apellidos FROM deudores;');
      console.log('\n🧑 Deudores registrados:', deudores.length);
      deudores.forEach(d => console.log(`  - ${d.nombre} ${d.apellidos}`));
    }

  } catch (err) {
    console.log('❌ ERROR DE CONEXIÓN:', err.message);
    console.log('\n💡 Posibles soluciones:');
    if (err.message.includes('password authentication')) {
      console.log('  → El password en .env no coincide con el de PostgreSQL');
      console.log('  → Edita el archivo .env y corrige DB_PASSWORD');
    } else if (err.message.includes('ECONNREFUSED') || err.message.includes('connect')) {
      console.log('  → PostgreSQL no está corriendo');
      console.log('  → Windows: Abre "Servicios" y busca postgresql, dale Start');
      console.log('  → Mac:     brew services start postgresql@16');
      console.log('  → Linux:   sudo systemctl start postgresql');
    } else if (err.message.includes('database') && err.message.includes('does not exist')) {
      console.log('  → La base de datos "cobros_db" no existe');
      console.log('  → Ábrela en psql y ejecuta: CREATE DATABASE cobros_db;');
    }
  } finally {
    client?.release();
    await pool.end();
  }
}

run();
