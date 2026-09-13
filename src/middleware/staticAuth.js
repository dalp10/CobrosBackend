// src/middleware/staticAuth.js
// Autenticación para /uploads: un <img src="..."> o <a href="..." download> no
// puede mandar el header Authorization, así que aquí se acepta también el
// token por query string (?token=...). Se usa solo para servir archivos
// estáticos — el resto de la API sigue exigiendo el token por header.
const jwt = require('jsonwebtoken');

const staticAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const headerToken = authHeader && authHeader.split(' ')[1];
  const token = headerToken || (typeof req.query.token === 'string' ? req.query.token : null);

  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

module.exports = staticAuth;
