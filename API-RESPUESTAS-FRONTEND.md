# Respuestas API para el frontend

## GET /api/deudores

**Respuesta:** objeto con paginación (no un array directo).

```json
{
  "data": [ { "id": 1, "nombre": "...", "apellidos": "...", ... } ],
  "total": 25,
  "page": 1,
  "limit": 200
}
```

**En el frontend (Angular):**

- La lista de deudores está en `response.data`.
- Usa `data` para cualquier `.filter()`, `*ngFor`, etc.

Ejemplo:

```typescript
// Antes (rompía porque la respuesta dejó de ser un array)
this.deudores = response;  // ❌ response es { data, total, page, limit }
this.deudores.filter(...)  // ❌ .filter is not a function

// Ahora
this.deudores = response.data ?? [];  // ✅ siempre un array
this.totalDeudores = response.total ?? 0;
this.page = response.page ?? 1;
this.limit = response.limit ?? 200;
```

Paginación opcional: `GET /api/deudores?page=1&limit=50`.

---

## GET /api/usuarios

**Respuesta:** array de usuarios (sin cambio).

```json
[
  { "id": 1, "nombre": "...", "email": "...", "rol": "admin", "created_at": "..." }
]
```

El 500 por la columna `activo` quedó corregido en el backend (ya no se usa esa columna en esta ruta).
