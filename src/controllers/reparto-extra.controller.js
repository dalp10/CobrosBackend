// src/controllers/reparto-extra.controller.js — Categorías, pendientes, presupuestos, Excel, repetir gasto, adjuntos, grupos
const path = require('path');
const fs = require('fs');
const { query } = require('../config/db');
const ExcelJS = require('exceljs');

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'reparto');
const UPLOAD_DIR_REEMBOLSOS = path.join(process.cwd(), 'uploads', 'reparto', 'reembolsos');
const MAX_ADJUNTO_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIMETYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

/** GET /api/reparto/categorias — reparto_id default 1 */
const getCategorias = async (req, res) => {
  try {
    const repartoId = req.query.reparto_id ? parseInt(req.query.reparto_id, 10) : 1;
    const { rows } = await query(
      'SELECT id, nombre, color FROM reparto_categorias WHERE COALESCE(reparto_id, 1) = $1 ORDER BY nombre',
      [repartoId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al listar categorías' });
  }
};

/** POST /api/reparto/categorias — body: nombre, color?, reparto_id? */
const createCategoria = async (req, res) => {
  const { nombre, color, reparto_id } = req.body;
  if (!nombre || !String(nombre).trim())
    return res.status(400).json({ error: 'El nombre es obligatorio' });
  const nombreTrim = String(nombre).trim();
  if (nombreTrim.length > 80)
    return res.status(400).json({ error: 'El nombre no puede superar 80 caracteres' });
  if (color != null && color !== '') {
    const hex = /^#([A-Fa-f0-9]{3}|[A-Fa-f0-9]{6})$/.test(String(color).trim());
    if (!hex)
      return res.status(400).json({ error: 'El color debe ser un valor hex (ej. #abc o #aabbcc)' });
  }
  const repartoId = reparto_id != null ? parseInt(reparto_id, 10) : 1;
  try {
    const { rows: existente } = await query(
      'SELECT id FROM reparto_categorias WHERE COALESCE(reparto_id, 1) = $1 AND LOWER(TRIM(nombre)) = LOWER($2)',
      [repartoId, nombreTrim]
    );
    if (existente.length > 0)
      return res.status(400).json({ error: 'Ya existe una categoría con ese nombre en el reparto' });
    const { rows: [row] } = await query(
      `INSERT INTO reparto_categorias (nombre, color, reparto_id) VALUES ($1, $2, $3)
       RETURNING id, nombre, color`,
      [nombreTrim, (color != null && String(color).trim()) ? String(color).trim() : '#6b7280', repartoId]
    );
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear categoría' });
  }
};

/** PUT /api/reparto/categorias/:id — body: nombre?, color? */
const updateCategoria = async (req, res) => {
  const { id } = req.params;
  const { nombre, color } = req.body;
  const updates = [];
  const values = [];
  let i = 1;
  if (nombre !== undefined) {
    const nombreTrim = String(nombre).trim();
    if (nombreTrim.length > 80)
      return res.status(400).json({ error: 'El nombre no puede superar 80 caracteres' });
    updates.push(`nombre = $${i++}`); values.push(nombreTrim);
  }
  if (color !== undefined) {
    if (color != null && color !== '') {
      const hex = /^#([A-Fa-f0-9]{3}|[A-Fa-f0-9]{6})$/.test(String(color).trim());
      if (!hex)
        return res.status(400).json({ error: 'El color debe ser un valor hex (ej. #abc o #aabbcc)' });
    }
    values.push(color === '' ? null : color);
    updates.push(`color = $${i++}`);
  }
  if (updates.length === 0)
    return res.status(400).json({ error: 'Indica nombre o color' });
  values.push(id);
  try {
    if (nombre !== undefined) {
      const { rows: [cat] } = await query(
        'SELECT reparto_id FROM reparto_categorias WHERE id = $1',
        [id]
      );
      if (cat) {
        const repartoId = cat.reparto_id != null ? cat.reparto_id : 1;
        const { rows: duplicado } = await query(
          'SELECT id FROM reparto_categorias WHERE COALESCE(reparto_id, 1) = $1 AND LOWER(TRIM(nombre)) = LOWER($2) AND id != $3',
          [repartoId, String(nombre).trim(), id]
        );
        if (duplicado.length > 0)
          return res.status(400).json({ error: 'Ya existe otra categoría con ese nombre en el reparto' });
      }
    }
    const { rows: [row] } = await query(
      `UPDATE reparto_categorias SET ${updates.join(', ')} WHERE id = $${i} RETURNING id, nombre, color`,
      values
    );
    if (!row) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar categoría' });
  }
};

/** DELETE /api/reparto/categorias/:id */
const deleteCategoria = async (req, res) => {
  try {
    const { rowCount } = await query('DELETE FROM reparto_categorias WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json({ message: 'Categoría eliminada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar categoría' });
  }
};

/** GET /api/reparto/pendientes — reparto_id default 1 */
const getPendientes = async (req, res) => {
  try {
    const repartoId = req.query.reparto_id ? parseInt(req.query.reparto_id, 10) : 1;
    const { getResumenData } = require('./reparto.controller');
    const data = await getResumenData(null, null, repartoId);
    const miembrosQueDeben = data.miembros.filter(m => m.saldo < -0.01).map(m => ({ id: m.id, nombre: m.nombre, saldo: m.saldo }));
    const gastosSinReembolso = [];
    for (const g of data.gastos) {
      const tieneReembolso = data.reembolsos.some(r => r.gasto_id === g.id || r.para_miembro_id === g.pagado_por_id);
      if (!tieneReembolso && g.pagado_por_id)
        gastosSinReembolso.push({ id: g.id, concepto: g.concepto, monto_total: g.monto_total, fecha: g.fecha, pagado_por_nombre: g.pagado_por_nombre });
    }
    res.json({ miembros_que_deben: miembrosQueDeben, gastos_sin_reembolso: gastosSinReembolso });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener pendientes' });
  }
};

/** GET /api/reparto/presupuestos — reparto_id?, anno?, mes? */
const getPresupuestos = async (req, res) => {
  try {
    const repartoId = req.query.reparto_id ? parseInt(req.query.reparto_id, 10) : 1;
    let sql = 'SELECT id, reparto_id, anno, mes, monto_techo FROM reparto_presupuestos WHERE COALESCE(reparto_id, 1) = $1';
    const params = [repartoId];
    if (req.query.anno) { params.push(parseInt(req.query.anno, 10)); sql += ' AND anno = $' + params.length; }
    if (req.query.mes) { params.push(parseInt(req.query.mes, 10)); sql += ' AND mes = $' + params.length; }
    sql += ' ORDER BY anno DESC, mes DESC';
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al listar presupuestos' });
  }
};

/** POST /api/reparto/presupuestos — body: anno, mes, monto_techo, reparto_id? */
const createPresupuesto = async (req, res) => {
  const { anno, mes, monto_techo, reparto_id } = req.body;
  if (anno == null || mes == null || monto_techo == null)
    return res.status(400).json({ error: 'Faltan anno, mes o monto_techo' });
  const annoNum = parseInt(anno, 10);
  const mesNum = parseInt(mes, 10);
  if (isNaN(mesNum) || mesNum < 1 || mesNum > 12)
    return res.status(400).json({ error: 'mes debe estar entre 1 y 12' });
  if (isNaN(annoNum) || annoNum < 2020 || annoNum > 2035)
    return res.status(400).json({ error: 'anno debe estar entre 2020 y 2035' });
  const repartoId = reparto_id != null ? parseInt(reparto_id, 10) : 1;
  const monto = parseFloat(monto_techo);
  if (isNaN(monto) || monto < 0)
    return res.status(400).json({ error: 'monto_techo debe ser >= 0' });
  try {
    const { rows: [existing] } = await query(
      'SELECT id FROM reparto_presupuestos WHERE COALESCE(reparto_id, 1) = $1 AND anno = $2 AND mes = $3',
      [repartoId, annoNum, mesNum]
    );
    if (existing) {
      await query('UPDATE reparto_presupuestos SET monto_techo = $1 WHERE id = $2', [monto, existing.id]);
      const { rows: [row] } = await query('SELECT id, reparto_id, anno, mes, monto_techo FROM reparto_presupuestos WHERE id = $1', [existing.id]);
      return res.status(200).json(row);
    }
    const { rows: [row] } = await query(
      `INSERT INTO reparto_presupuestos (reparto_id, anno, mes, monto_techo)
       VALUES ($1, $2, $3, $4)
       RETURNING id, reparto_id, anno, mes, monto_techo`,
      [repartoId, annoNum, mesNum, monto]
    );
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar presupuesto' });
  }
};

/** PUT /api/reparto/presupuestos/:id — body: monto_techo */
const updatePresupuesto = async (req, res) => {
  const { id } = req.params;
  const { monto_techo } = req.body;
  if (monto_techo == null) return res.status(400).json({ error: 'Indica monto_techo' });
  const monto = parseFloat(monto_techo);
  if (isNaN(monto) || monto < 0) return res.status(400).json({ error: 'monto_techo debe ser >= 0' });
  try {
    const { rows: [row] } = await query(
      'UPDATE reparto_presupuestos SET monto_techo = $1 WHERE id = $2 RETURNING id, reparto_id, anno, mes, monto_techo',
      [monto, id]
    );
    if (!row) return res.status(404).json({ error: 'Presupuesto no encontrado' });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar presupuesto' });
  }
};

/** DELETE /api/reparto/presupuestos/:id */
const deletePresupuesto = async (req, res) => {
  try {
    const { rowCount } = await query('DELETE FROM reparto_presupuestos WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Presupuesto no encontrado' });
    res.json({ message: 'Presupuesto eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar presupuesto' });
  }
};

/** GET /api/reparto/reportes/exportar?formato=xlsx */
const exportarReporteExcel = async (req, res) => {
  try {
    const { desde, hasta, reparto_id } = req.query;
    const repartoId = reparto_id ? parseInt(reparto_id, 10) : 1;
    const { getResumenData } = require('./reparto.controller');
    const data = await getResumenData(desde || null, hasta || null, repartoId);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Reparto');
    sheet.columns = [
      { header: 'Sección', key: 'seccion', width: 30 },
      { header: 'Dato 1', key: 'd1', width: 20 },
      { header: 'Dato 2', key: 'd2', width: 20 },
      { header: 'Dato 3', key: 'd3', width: 20 },
    ];
    sheet.addRow({ seccion: 'REPARTO', d1: `Período: ${data.desde || 'Todo'} - ${data.hasta || 'Todo'}` });
    sheet.addRow({});
    sheet.addRow({ seccion: 'Resumen', d1: 'Total gastos', d2: data.total_gastos });
    sheet.addRow({ seccion: '', d1: 'Cuota por persona', d2: data.cuota_por_persona });
    sheet.addRow({});
    sheet.addRow({ seccion: 'Miembros', d1: 'Nombre', d2: 'Pagó', d3: 'Saldo' });
    data.miembros.forEach(m => sheet.addRow({ seccion: '', d1: m.nombre, d2: m.total_pagado_servicios, d3: m.saldo }));
    sheet.addRow({});
    sheet.addRow({ seccion: 'Gastos', d1: 'Fecha', d2: 'Concepto', d3: 'Monto' });
    data.gastos.forEach(g => sheet.addRow({ seccion: '', d1: g.fecha, d2: g.concepto, d3: g.monto_total }));
    sheet.addRow({});
    sheet.addRow({ seccion: 'Reembolsos', d1: 'De → Para', d2: 'Monto', d3: 'Fecha' });
    data.reembolsos.forEach(r => sheet.addRow({ seccion: '', d1: `${r.de_nombre} → ${r.para_nombre}`, d2: r.monto, d3: r.fecha }));

    const buf = await workbook.xlsx.writeBuffer();
    const filename = `reparto-${data.desde || 'todo'}-${data.hasta || 'todo'}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar Excel' });
  }
};

/** POST /api/reparto/gastos/:id/repetir-mes */
const repetirGastoMes = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows: [gasto] } = await query(
      'SELECT id, concepto, monto_total, pagado_por_id, notas, categoria_id, reparto_id FROM reparto_gastos WHERE id = $1 AND (anulado IS NOT TRUE)',
      [id]
    );
    if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado' });
    const d = new Date();
    const nextMonth = d.getMonth() + 2 > 12 ? new Date(d.getFullYear() + 1, 0, 1) : new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const fechaStr = nextMonth.toISOString().split('T')[0];
    const { rows: [row] } = await query(`
      INSERT INTO reparto_gastos (concepto, monto_total, fecha, pagado_por_id, notas, categoria_id, reparto_id, recurrente, recurrente_origen_id)
      VALUES ($1, $2, $3::date, $4, $5, $6, $7, true, $8)
      RETURNING *
    `, [gasto.concepto, gasto.monto_total, fechaStr, gasto.pagado_por_id, gasto.notas, gasto.categoria_id, gasto.reparto_id || 1, id]);
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al repetir gasto' });
  }
};

/** GET /api/reparto/gastos/:id/adjuntos */
const getAdjuntos = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows: [gasto] } = await query(
      'SELECT id FROM reparto_gastos WHERE id = $1 AND (anulado IS NOT TRUE)',
      [id]
    );
    if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado o está anulado' });
    const { rows } = await query(
      'SELECT id, gasto_id, nombre_archivo, ruta, content_type, created_at FROM reparto_adjuntos WHERE gasto_id = $1 ORDER BY created_at',
      [id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al listar adjuntos' });
  }
};

/** POST /api/reparto/gastos/:id/adjuntos — multer sube archivo */
const uploadAdjunto = async (req, res) => {
  const { id } = req.params;
  if (!req.file)
    return res.status(400).json({ error: 'No se envió ningún archivo' });
  try {
    const { rows: [gasto] } = await query(
      'SELECT id FROM reparto_gastos WHERE id = $1 AND (anulado IS NOT TRUE)',
      [id]
    );
    if (!gasto) {
      if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Gasto no encontrado o está anulado' });
    }
    if (req.file.size > MAX_ADJUNTO_BYTES) {
      if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: `El archivo no puede superar ${MAX_ADJUNTO_BYTES / (1024 * 1024)} MB` });
    }
    const mimetype = (req.file.mimetype || '').toLowerCase();
    if (!ALLOWED_MIMETYPES.includes(mimetype)) {
      if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Tipo de archivo no permitido. Use imagen (jpg, png, gif, webp), PDF o documento Word/Excel.' });
    }
    const dir = path.join(UPLOAD_DIR, String(id));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let nombreArchivo = (req.file.originalname || req.file.filename || `file-${Date.now()}`).replace(/[/\\]/g, '').replace(/\.\./g, '') || `file-${Date.now()}`;
    if (!nombreArchivo.trim()) nombreArchivo = `file-${Date.now()}`;
    const ruta = path.join(dir, nombreArchivo);
    fs.renameSync(req.file.path, ruta);
    // Guardar ruta relativa con / para que sea consistente en cualquier SO
    const rutaRel = ['reparto', String(id), nombreArchivo].join('/');
    const { rows: [row] } = await query(
      `INSERT INTO reparto_adjuntos (gasto_id, nombre_archivo, ruta, content_type)
       VALUES ($1, $2, $3, $4)
       RETURNING id, gasto_id, nombre_archivo, content_type, created_at`,
      [id, nombreArchivo, rutaRel, req.file.mimetype || 'application/octet-stream']
    );
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al subir adjunto' });
  }
};

/** DELETE /api/reparto/adjuntos/:id */
const deleteAdjunto = async (req, res) => {
  try {
    const { rows: [adj] } = await query('SELECT id, ruta FROM reparto_adjuntos WHERE id = $1', [req.params.id]);
    if (!adj) return res.status(404).json({ error: 'Adjunto no encontrado' });
    const rutaNorm = adj.ruta.split(/[/\\]/).filter(Boolean).join(path.sep);
    const fullPath = path.join(process.cwd(), 'uploads', rutaNorm);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    await query('DELETE FROM reparto_adjuntos WHERE id = $1', [req.params.id]);
    res.json({ message: 'Adjunto eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar adjunto' });
  }
};

/** GET /api/reparto/adjuntos/:id/descargar — envía el archivo */
const descargarAdjunto = async (req, res) => {
  try {
    const { rows: [adj] } = await query(
      'SELECT id, nombre_archivo, ruta, content_type FROM reparto_adjuntos WHERE id = $1',
      [req.params.id]
    );
    if (!adj) return res.status(404).json({ error: 'Adjunto no encontrado' });
    // Normalizar ruta: en BD puede estar con / o \ según sistema; unificar para existsSync/sendFile
    const rutaNorm = adj.ruta.split(/[/\\]/).filter(Boolean).join(path.sep);
    const fullPath = path.join(process.cwd(), 'uploads', rutaNorm);
    if (!fs.existsSync(fullPath)) {
      console.error('[descargarAdjunto] Archivo no encontrado:', fullPath, '(ruta en BD:', adj.ruta, ')');
      return res.status(404).json({ error: 'Archivo no encontrado en el servidor' });
    }
    res.setHeader('Content-Type', adj.content_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(adj.nombre_archivo)}"`);
    res.sendFile(fullPath);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al descargar' });
  }
};

/** GET /api/reparto/reembolsos/:id/adjuntos */
const getAdjuntosReembolso = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows: [reembolso] } = await query(
      'SELECT id FROM reparto_reembolsos WHERE id = $1 AND (anulado IS NOT TRUE)',
      [id]
    );
    if (!reembolso) return res.status(404).json({ error: 'Reembolso no encontrado o está anulado' });
    const { rows } = await query(
      'SELECT id, reembolso_id, nombre_archivo, ruta, content_type, created_at FROM reparto_reembolso_adjuntos WHERE reembolso_id = $1 ORDER BY created_at',
      [id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al listar adjuntos' });
  }
};

/** POST /api/reparto/reembolsos/:id/adjuntos — multer sube archivo */
const uploadAdjuntoReembolso = async (req, res) => {
  const { id } = req.params;
  if (!req.file)
    return res.status(400).json({ error: 'No se envió ningún archivo' });
  try {
    const { rows: [reembolso] } = await query(
      'SELECT id FROM reparto_reembolsos WHERE id = $1 AND (anulado IS NOT TRUE)',
      [id]
    );
    if (!reembolso) {
      if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Reembolso no encontrado o está anulado' });
    }
    if (req.file.size > MAX_ADJUNTO_BYTES) {
      if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: `El archivo no puede superar ${MAX_ADJUNTO_BYTES / (1024 * 1024)} MB` });
    }
    const mimetype = (req.file.mimetype || '').toLowerCase();
    if (!ALLOWED_MIMETYPES.includes(mimetype)) {
      if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Tipo de archivo no permitido. Use imagen (jpg, png, gif, webp), PDF o documento Word/Excel.' });
    }
    const dir = path.join(UPLOAD_DIR_REEMBOLSOS, String(id));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let nombreArchivo = (req.file.originalname || req.file.filename || `file-${Date.now()}`).replace(/[/\\]/g, '').replace(/\.\./g, '') || `file-${Date.now()}`;
    if (!nombreArchivo.trim()) nombreArchivo = `file-${Date.now()}`;
    const ruta = path.join(dir, nombreArchivo);
    fs.renameSync(req.file.path, ruta);
    const rutaRel = ['reparto', 'reembolsos', String(id), nombreArchivo].join('/');
    const { rows: [row] } = await query(
      `INSERT INTO reparto_reembolso_adjuntos (reembolso_id, nombre_archivo, ruta, content_type)
       VALUES ($1, $2, $3, $4)
       RETURNING id, reembolso_id, nombre_archivo, content_type, created_at`,
      [id, nombreArchivo, rutaRel, req.file.mimetype || 'application/octet-stream']
    );
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al subir adjunto' });
  }
};

/** DELETE /api/reparto/reembolso-adjuntos/:id */
const deleteAdjuntoReembolso = async (req, res) => {
  try {
    const { rows: [adj] } = await query('SELECT id, ruta FROM reparto_reembolso_adjuntos WHERE id = $1', [req.params.id]);
    if (!adj) return res.status(404).json({ error: 'Adjunto no encontrado' });
    const rutaNorm = adj.ruta.split(/[/\\]/).filter(Boolean).join(path.sep);
    const fullPath = path.join(process.cwd(), 'uploads', rutaNorm);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    await query('DELETE FROM reparto_reembolso_adjuntos WHERE id = $1', [req.params.id]);
    res.json({ message: 'Adjunto eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar adjunto' });
  }
};

/** GET /api/reparto/reembolso-adjuntos/:id/descargar */
const descargarAdjuntoReembolso = async (req, res) => {
  try {
    const { rows: [adj] } = await query(
      'SELECT id, nombre_archivo, ruta, content_type FROM reparto_reembolso_adjuntos WHERE id = $1',
      [req.params.id]
    );
    if (!adj) return res.status(404).json({ error: 'Adjunto no encontrado' });
    const rutaNorm = adj.ruta.split(/[/\\]/).filter(Boolean).join(path.sep);
    const fullPath = path.join(process.cwd(), 'uploads', rutaNorm);
    if (!fs.existsSync(fullPath))
      return res.status(404).json({ error: 'Archivo no encontrado en el servidor' });
    res.setHeader('Content-Type', adj.content_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(adj.nombre_archivo)}"`);
    res.sendFile(fullPath);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al descargar' });
  }
};

/** GET /api/reparto/grupos */
const getGrupos = async (req, res) => {
  try {
    const { rows } = await query('SELECT id, nombre FROM reparto_grupos ORDER BY id');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al listar grupos' });
  }
};

/** POST /api/reparto/grupos — body: nombre */
const createGrupo = async (req, res) => {
  const { nombre } = req.body;
  if (!nombre || !String(nombre).trim())
    return res.status(400).json({ error: 'El nombre es obligatorio' });
  try {
    const { rows: [row] } = await query(
      'INSERT INTO reparto_grupos (nombre) VALUES ($1) RETURNING id, nombre',
      [nombre.trim()]
    );
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear grupo' });
  }
};

module.exports = {
  getCategorias,
  createCategoria,
  updateCategoria,
  deleteCategoria,
  getPendientes,
  getPresupuestos,
  createPresupuesto,
  updatePresupuesto,
  deletePresupuesto,
  exportarReporteExcel,
  repetirGastoMes,
  getAdjuntos,
  uploadAdjunto,
  deleteAdjunto,
  descargarAdjunto,
  getAdjuntosReembolso,
  uploadAdjuntoReembolso,
  deleteAdjuntoReembolso,
  descargarAdjuntoReembolso,
  getGrupos,
  createGrupo,
};
