// src/config/health.js
const { pool } = require('./db');

async function checkDb() {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    return true;
  } finally {
    client.release();
  }
}

module.exports = { checkDb };
