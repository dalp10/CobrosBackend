// src/config/db.js
const { Pool } = require('pg');
const logger = require('./logger');
require('dotenv').config();

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'cobros_db',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
  max: 10,                  // max conexiones en el pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
    // ✅ SSL solo en producción
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  logger.error({ err }, '❌ Error inesperado en el pool de PostgreSQL');
});

// Helper para queries más limpias
const query = (text, params) => pool.query(text, params);
const getClient = () => pool.connect();

module.exports = { pool, query, getClient };
