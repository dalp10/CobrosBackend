// scripts/set-telefonos-deudores.js
// Actualiza teléfono de deudores por nombre+apellidos.
// Uso: node scripts/set-telefonos-deudores.js
require('dotenv').config();
const { query } = require('../src/config/db');

const TELEFONOS = [
  { nombre: 'Maritza', apellidos: 'Paredes Piña', telefono: '981844013' },
  { nombre: 'Annie', apellidos: 'Muñoz', telefono: '992088181' },
  { nombre: 'Pedro', apellidos: 'Reátegui Carpi', telefono: '953154506' },
  { nombre: 'Miguel', apellidos: 'Ríos', telefono: '974254761' },
];

async function run() {
  for (const { nombre, apellidos, telefono } of TELEFONOS) {
    const { rowCount } = await query(
      'UPDATE deudores SET telefono = $1 WHERE nombre = $2 AND apellidos = $3',
      [telefono, nombre, apellidos]
    );
    console.log(`${nombre} ${apellidos}: ${rowCount ? 'OK → ' + telefono : 'no encontrado'}`);
  }
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
