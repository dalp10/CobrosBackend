# Cobros API (Backend)

API REST para el sistema de cobros (deudores, préstamos, pagos, usuarios).

## Requisitos

- Node.js 18+
- PostgreSQL 14+

## Instalación

```bash
npm install
cp .env.example .env
# Editar .env con tu DB y JWT_SECRET
```

## Variables de entorno

| Variable | Requerido | Descripción |
|----------|-----------|-------------|
| `JWT_SECRET` | Sí | Clave para firmar tokens (usa un string largo y aleatorio). |
| `DB_HOST` | Sí (prod) | Host de PostgreSQL. |
| `DB_NAME` | Sí (prod) | Nombre de la base. |
| `DB_USER` | Sí (prod) | Usuario de la base. |
| `DB_PASSWORD` | Sí (prod) | Contraseña. |
| `PORT` | No | Puerto del servidor (default 3000). |
| `NODE_ENV` | No | `development` \| `production`. |
| `ALLOWED_ORIGINS` | No | Orígenes CORS separados por coma. En producción usa la URL del frontend. |
| `UPLOADS_DIR` | No | Carpeta de archivos subidos (default `./uploads`). |
| `RATE_LIMIT_API_MAX` | No | Límite de peticiones por minuto (default 100). |

## Comandos

```bash
# Desarrollo (recarga automática)
npm run dev

# Producción
npm start

# Tests
npm test
npm run test:watch

# Crear tablas (primera vez)
npm run db:migrate

# Datos de prueba
npm run db:seed
```

## Endpoints principales

- `POST /api/auth/login` — Login (email, password).
- `GET /api/auth/me` — Usuario actual (requiere token).
- `GET /api/health` — Estado del servidor y conexión a DB.
- `GET/POST/PUT/DELETE /api/deudores` — CRUD deudores (paginado).
- `GET/POST/PATCH /api/prestamos` — Préstamos.
- `GET/POST/PUT/DELETE /api/pagos` — Pagos (resumen en `GET /api/pagos/resumen`).
- `GET/POST/PUT /api/usuarios` — Usuarios (admin).

## Despliegue (Railway)

1. Conectar el repo y configurar variables: `JWT_SECRET`, `DB_*`, `ALLOWED_ORIGINS` (URL del frontend), `NODE_ENV=production`.
2. Comando de inicio: `npm start` (ejecuta `node src/index.js`; el servidor escucha solo cuando se ejecuta como script principal).
3. Health check: `GET /api/health` (debe devolver 200 y `db: "connected"`).

El módulo exporta la app Express (`module.exports = app`) para poder probarla con supertest sin levantar el servidor.
