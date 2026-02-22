const fs = require('fs');
const path = require('path');

// 1. BACKEND - usuarios controller
const usuariosController = `const bcrypt = require('bcryptjs');
const { query } = require('../config/db');

// GET /usuarios - solo admin
const getAll = async (req, res) => {
  if (req.user.rol !== 'admin')
    return res.status(403).json({ error: 'Solo administradores' });
  try {
    const { rows } = await query(
      'SELECT id, nombre, email, rol, activo, created_at FROM usuarios ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
};

// POST /usuarios - crear usuario
const create = async (req, res) => {
  if (req.user.rol !== 'admin')
    return res.status(403).json({ error: 'Solo administradores' });
  const { nombre, email, password, rol } = req.body;
  if (!nombre || !email || !password)
    return res.status(400).json({ error: 'Nombre, email y password son requeridos' });
  try {
    const existe = await query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (existe.rows.length)
      return res.status(400).json({ error: 'El email ya está registrado' });
    const hash = await bcrypt.hash(password, 10);
    const { rows: [user] } = await query(
      'INSERT INTO usuarios (nombre, email, password, rol) VALUES ($1,$2,$3,$4) RETURNING id, nombre, email, rol',
      [nombre, email, hash, rol || 'admin']
    );
    res.status(201).json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear usuario' });
  }
};

// PUT /usuarios/:id - editar
const update = async (req, res) => {
  if (req.user.rol !== 'admin')
    return res.status(403).json({ error: 'Solo administradores' });
  const { id } = req.params;
  const { nombre, email, rol, activo } = req.body;
  try {
    const { rows: [user] } = await query(
      'UPDATE usuarios SET nombre=$1, email=$2, rol=$3, activo=$4 WHERE id=$5 RETURNING id, nombre, email, rol, activo',
      [nombre, email, rol, activo !== undefined ? activo : true, id]
    );
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar' });
  }
};

// PUT /usuarios/:id/password - cambiar contraseña
const changePassword = async (req, res) => {
  const { id } = req.params;
  const { password_actual, password_nuevo } = req.body;
  // Solo puede cambiarse a sí mismo o admin puede cambiar cualquiera
  if (req.user.id !== parseInt(id) && req.user.rol !== 'admin')
    return res.status(403).json({ error: 'Sin permisos' });
  if (!password_nuevo || password_nuevo.length < 6)
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  try {
    const { rows } = await query('SELECT password FROM usuarios WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    // Si no es admin, verificar contraseña actual
    if (req.user.rol !== 'admin') {
      const valid = await require('bcryptjs').compare(password_actual, rows[0].password);
      if (!valid) return res.status(400).json({ error: 'Contraseña actual incorrecta' });
    }
    const hash = await require('bcryptjs').hash(password_nuevo, 10);
    await query('UPDATE usuarios SET password=$1 WHERE id=$2', [hash, id]);
    res.json({ message: 'Contraseña actualizada' });
  } catch (err) {
    res.status(500).json({ error: 'Error al cambiar contraseña' });
  }
};

module.exports = { getAll, create, update, changePassword };
`;

fs.writeFileSync(
  path.join('src', 'controllers', 'usuarios.controller.js'),
  usuariosController, 'utf8'
);
console.log('Backend: usuarios.controller.js OK');

// 2. BACKEND - usuarios routes
const usuariosRoutes = `const router = require('express').Router();
const auth = require('../middleware/auth');
const { getAll, create, update, changePassword } = require('../controllers/usuarios.controller');

router.get('/',          auth, getAll);
router.post('/',         auth, create);
router.put('/:id',       auth, update);
router.put('/:id/password', auth, changePassword);

module.exports = router;
`;

fs.writeFileSync(
  path.join('src', 'routes', 'usuarios.routes.js'),
  usuariosRoutes, 'utf8'
);
console.log('Backend: usuarios.routes.js OK');

// 3. BACKEND - register route in index.js
let index = fs.readFileSync(path.join('src', 'index.js'), 'utf8');
if (!index.includes('usuarios.routes')) {
  index = index.replace(
    `app.use('/api/pagos',`,
    `app.use('/api/usuarios',  require('./routes/usuarios.routes'));\napp.use('/api/pagos',`
  );
  fs.writeFileSync(path.join('src', 'index.js'), index, 'utf8');
  console.log('Backend: index.js actualizado con /api/usuarios');
} else {
  console.log('Backend: /api/usuarios ya registrado');
}
