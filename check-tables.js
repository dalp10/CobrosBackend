const { Pool } = require('pg');
const p = new Pool({
  connectionString: 'postgresql://postgres:dVAaydoCnmBjuneoNbFVdnlcmdJgOkqh@interchange.proxy.rlwy.net:11600/railway',
  ssl: { rejectUnauthorized: false }
});
p.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")
  .then(r => { console.log('Tablas:', r.rows); p.end(); })
  .catch(e => { console.error('Error:', e.message); p.end(); });
