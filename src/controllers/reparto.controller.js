// src/controllers/reparto.controller.js
// Reparto de gastos (agua, luz, etc.) entre miembros de la casa. Cuota = total / N. Reembolsos = quién le devuelve a quién.
const { query } = require('../config/db');
const logger = require('../config/logger');

/** Obtiene los participantes (miembro_id, peso) de cada gasto en gastoIds, agrupados por gasto_id. */
async function getParticipantesByGasto(gastoIds) {
  if (!gastoIds.length) return {};
  const placeholders = gastoIds.map((_, i) => `$${i + 1}`).join(',');
  const { rows } = await query(
    `SELECT gasto_id, miembro_id, peso FROM reparto_gasto_participantes WHERE gasto_id IN (${placeholders})`,
    gastoIds
  );
  const map = {};
  for (const p of rows) {
    if (!map[p.gasto_id]) map[p.gasto_id] = [];
    map[p.gasto_id].push({ miembro_id: p.miembro_id, peso: Number(p.peso) });
  }
  return map;
}

/** Obtiene los cargos adicionales (miembro_id -> monto) de cada gasto en gastoIds, agrupados por gasto_id. */
async function getCargosByGasto(gastoIds) {
  if (!gastoIds.length) return {};
  const placeholders = gastoIds.map((_, i) => `$${i + 1}`).join(',');
  const { rows } = await query(
    `SELECT gasto_id, miembro_id, monto FROM reparto_gasto_cargos WHERE gasto_id IN (${placeholders})`,
    gastoIds
  );
  const map = {};
  for (const c of rows) {
    if (!map[c.gasto_id]) map[c.gasto_id] = {};
    map[c.gasto_id][c.miembro_id] = Number(c.monto);
  }
  return map;
}

/**
 * Calcula la cuota que le toca a cada miembro.
 * Gastos con participantes definidos (que no equivalgan a repartir entre todos por igual)
 * se reparten solo entre ellos según su peso.
 * El resto de gastos se reparte entre todos los miembros (N), descontando primero los
 * cargos adicionales asociados a ese gasto en particular (reparto_gasto_cargos): cada
 * miembro con un cargo en ese gasto paga su cargo aparte sobre la base compartida.
 */
function calcularCuotaPorMiembro(miembros, gastosTodos, participantesByGasto, cargosByGasto) {
  const N = miembros.length;
  const cuotaPorMiembro = miembros.map(() => 0);
  const idxById = {};
  miembros.forEach((m, i) => { idxById[m.id] = i; });

  const byMonth = {};

  for (const g of gastosTodos) {
    const participantes = participantesByGasto[g.id];
    const sumPesos = participantes ? participantes.reduce((s, p) => s + p.peso, 0) : 0;
    // Si los participantes son todos los miembros con el mismo peso, equivale a repartir
    // entre todos por igual: se trata como gasto compartido para que apliquen los cargos
    // adicionales de ese gasto (si no, alguien con cargo extra no vería su cuota subir
    // ni los demás verían la suya bajar).
    const esTodosPorIgual = !!participantes && participantes.length === N
      && miembros.every(m => participantes.some(p => p.miembro_id === m.id))
      && participantes.every(p => p.peso === participantes[0].peso);

    const cuotasGasto = miembros.map(() => 0);
    if (participantes && participantes.length && sumPesos > 0 && !esTodosPorIgual) {
      for (const p of participantes) {
        const idx = idxById[p.miembro_id];
        if (idx === undefined) continue;
        cuotasGasto[idx] = Number(g.monto_total) * p.peso / sumPesos;
      }
    } else {
      const cargosGasto = cargosByGasto[g.id] || {};
      const sumCargosGasto = Object.values(cargosGasto).reduce((a, b) => a + b, 0);
      const base = N > 0 ? (Number(g.monto_total) - sumCargosGasto) / N : 0;
      miembros.forEach((m, i) => { cuotasGasto[i] = base + (cargosGasto[m.id] || 0); });
    }

    miembros.forEach((m, i) => { cuotaPorMiembro[i] += cuotasGasto[i]; });

    const d = new Date(g.fecha);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!byMonth[key]) byMonth[key] = { total: 0, cuotas: miembros.map(() => 0) };
    byMonth[key].total += Number(g.monto_total);
    miembros.forEach((m, i) => { byMonth[key].cuotas[i] += cuotasGasto[i]; });
  }

  return { cuotaPorMiembro, byMonth };
}

/** Calcula el saldo actual de un miembro (positivo = le deben, negativo = debe). Opcional: excluir reembolso por id para el cálculo de reembolsosDados (para validar update). */
async function getSaldoMiembro(miembroId, excluirReembolsoId = null) {
  const { rows: miembros } = await query(`
    SELECT id, nombre, COALESCE(cargo_adicional_mensual, 0) AS cargo_adicional_mensual
    FROM reparto_miembros WHERE activo = true
  `);
  const N = miembros.length;
  if (N === 0) return 0;

  const { rows: gastosTodos } = await query(`
    SELECT g.id, g.fecha, g.monto_total, g.meses FROM reparto_gastos g WHERE (g.anulado IS NOT TRUE)
  `);
  const participantesByGasto = await getParticipantesByGasto(gastosTodos.map(g => g.id));
  const cargosByGasto = await getCargosByGasto(gastosTodos.map(g => g.id));
  const { rows: pagadoPorMiembro } = await query(`
    SELECT g.pagado_por_id, COALESCE(SUM(g.monto_total), 0) AS total
    FROM reparto_gastos g WHERE (g.anulado IS NOT TRUE) GROUP BY g.pagado_por_id
  `);
  const { rows: recibeReembolso } = await query(`
    SELECT r.para_miembro_id, COALESCE(SUM(r.monto), 0) AS total
    FROM reparto_reembolsos r WHERE (r.anulado IS NOT TRUE) GROUP BY r.para_miembro_id
  `);
  const { rows: daReembolso } = await query(`
    SELECT r.de_miembro_id, COALESCE(SUM(r.monto), 0) AS total
    FROM reparto_reembolsos r WHERE (r.anulado IS NOT TRUE) GROUP BY r.de_miembro_id
  `);

  const mapDa = Object.fromEntries(daReembolso.map(r => [r.de_miembro_id, Number(r.total)]));
  if (excluirReembolsoId) {
    const { rows: [excl] } = await query(
      'SELECT de_miembro_id, monto FROM reparto_reembolsos WHERE id = $1',
      [excluirReembolsoId]
    );
    if (excl) {
      const id = excl.de_miembro_id;
      mapDa[id] = Math.max(0, (mapDa[id] || 0) - Number(excl.monto));
    }
  }

  const { cuotaPorMiembro } = calcularCuotaPorMiembro(miembros, gastosTodos, participantesByGasto, cargosByGasto);

  const mapPagado = Object.fromEntries(pagadoPorMiembro.map(r => [r.pagado_por_id, Number(r.total)]));
  const mapRecibe = Object.fromEntries(recibeReembolso.map(r => [r.para_miembro_id, Number(r.total)]));

  const idx = miembros.findIndex(m => m.id === miembroId);
  if (idx === -1) return 0;
  const totalPagado = mapPagado[miembroId] || 0;
  const cuotaQueLeToca = cuotaPorMiembro[idx];
  const teDeben = totalPagado - cuotaQueLeToca;
  const reembolsosRecibidos = mapRecibe[miembroId] || 0;
  const reembolsosDados = mapDa[miembroId] || 0;
  const saldo = teDeben - reembolsosRecibidos + reembolsosDados;
  return Math.round(saldo * 100) / 100;
}

/** Dado lista de miembros con saldo (positivo = le deben, negativo = debe), devuelve sugerencias de reembolsos mínimos. */
function calcularSugerenciasReembolso(miembrosConSaldo) {
  const deudores = miembrosConSaldo.filter(m => m.saldoNum < -0.01).map(m => ({ id: m.id, nombre: m.nombre, debe: -m.saldoNum }));
  const acreedores = miembrosConSaldo.filter(m => m.saldoNum > 0.01).map(m => ({ id: m.id, nombre: m.nombre, leDeben: m.saldoNum }));
  const sugerencias = [];
  let i = 0, j = 0;
  while (i < deudores.length && j < acreedores.length) {
    const de = deudores[i];
    const para = acreedores[j];
    const monto = Math.min(de.debe, para.leDeben);
    if (monto < 0.01) {
      if (de.debe < para.leDeben) i++; else j++;
      continue;
    }
    sugerencias.push({ de_id: de.id, de_nombre: de.nombre, para_id: para.id, para_nombre: para.nombre, monto: Math.round(monto * 100) / 100 });
    de.debe -= monto;
    para.leDeben -= monto;
    if (de.debe < 0.01) i++;
    if (para.leDeben < 0.01) j++;
  }
  return sugerencias;
}

/** GET /api/reparto/resumen — miembros con saldos, gastos recientes, reembolsos. Query: desde?, hasta?, reparto_id?, miembro_id? */
const getResumen = async (req, res) => {
  try {
    const repartoId = req.query.reparto_id ? parseInt(req.query.reparto_id, 10) : 1;
    const miembroId = req.query.miembro_id ? parseInt(req.query.miembro_id, 10) : null;
    const data = await getResumenData(req.query.desde, req.query.hasta, repartoId, miembroId);
    if (data.gastos.length > 0) {
      data.gastos.reverse();
      if (data.gastos.length > 100) data.gastos = data.gastos.slice(0, 100);
    }
    if (data.reembolsos.length > 0) {
      data.reembolsos.reverse();
      if (data.reembolsos.length > 100) data.reembolsos = data.reembolsos.slice(0, 100);
    }
    res.json(data);
  } catch (err) {
    logger.error({ err });
    res.status(500).json({ error: 'Error al obtener resumen de reparto' });
  }
};

/** Obtiene los datos del resumen (misma lógica que getResumen) para reutilizar en reportes. reparto_id default 1, miembro_id opcional para filtrar. */
async function getResumenData(desde, hasta, repartoId = 1, miembroId = null) {
  const conFechas = desde && hasta;
  const paramsTotales = conFechas ? [repartoId, desde, hasta] : [repartoId];

  const { rows: miembros } = await query(`
    SELECT id, nombre, COALESCE(cargo_adicional_mensual, 0) AS cargo_adicional_mensual
    FROM reparto_miembros WHERE activo = true AND COALESCE(reparto_id, 1) = $1 ORDER BY nombre
  `, [repartoId]);
  const N = miembros.length;
  if (N === 0) {
    return { miembros: [], gastos: [], reembolsos: [], total_gastos: 0, cuota_por_persona: 0, resumen_por_mes: [], desde: null, hasta: null, categorias: [], sugerencias_reembolso: [] };
  }

  const paramsGastos = [...paramsTotales];
  if (miembroId) paramsGastos.push(miembroId);
  const { rows: gastosList } = await query(`
    SELECT g.id, g.concepto, g.monto_total, g.fecha, g.pagado_por_id, g.notas, g.categoria_id, g.medio_pago, g.recurrente, g.estado, g.fecha_corte, g.fecha_vencimiento, g.meses,
           m.nombre AS pagado_por_nombre, c.nombre AS categoria_nombre, c.color AS categoria_color
    FROM reparto_gastos g
    JOIN reparto_miembros m ON m.id = g.pagado_por_id
    LEFT JOIN reparto_categorias c ON c.id = g.categoria_id
    WHERE (g.anulado IS NOT TRUE) AND COALESCE(g.reparto_id, 1) = $1
    ${conFechas ? 'AND g.fecha >= $2::date AND g.fecha <= $3::date' : ''}
    ${miembroId ? 'AND (g.pagado_por_id = $' + paramsGastos.length + ' OR EXISTS (SELECT 1 FROM reparto_gasto_participantes p WHERE p.gasto_id = g.id AND p.miembro_id = $' + paramsGastos.length + '))' : ''}
    ORDER BY g.fecha ASC, g.id ASC
  `, paramsGastos);

  const participantesByGasto = {};
  if (gastosList.length > 0) {
    const gastoIds = gastosList.map(g => g.id);
    const placeholders = gastoIds.map((_, i) => `$${i + 1}`).join(',');
    const { rows: partRows } = await query(
      `SELECT gasto_id, miembro_id, peso FROM reparto_gasto_participantes WHERE gasto_id IN (${placeholders}) ORDER BY gasto_id, miembro_id`,
      gastoIds
    );
    for (const p of partRows) {
      if (!participantesByGasto[p.gasto_id]) participantesByGasto[p.gasto_id] = [];
      participantesByGasto[p.gasto_id].push({ miembro_id: p.miembro_id, peso: Math.round(Number(p.peso) * 100) / 100 });
    }
    gastosList.forEach(g => { g.participantes = participantesByGasto[g.id] || []; });

    const cargosByGastoList = await getCargosByGasto(gastoIds);
    gastosList.forEach(g => {
      const cargosGasto = cargosByGastoList[g.id] || {};
      g.cargos = Object.entries(cargosGasto).map(([miembro_id, monto]) => ({ miembro_id: Number(miembro_id), monto }));
    });
  }

  const { rows: gastosTodos } = await query(`
    SELECT g.id, g.fecha, g.monto_total, g.meses FROM reparto_gastos g
    WHERE (g.anulado IS NOT TRUE) AND COALESCE(g.reparto_id, 1) = $1
    ${conFechas ? 'AND g.fecha >= $2::date AND g.fecha <= $3::date' : ''}
  `, paramsTotales);
  const participantesByGastoTodos = await getParticipantesByGasto(gastosTodos.map(g => g.id));
  const cargosByGastoTodos = await getCargosByGasto(gastosTodos.map(g => g.id));

  const paramsReemb = [...paramsTotales];
  if (miembroId) paramsReemb.push(miembroId);
  const { rows: reembolsos } = await query(`
    SELECT r.id, r.de_miembro_id, r.para_miembro_id, r.monto, r.fecha, r.concepto, r.gasto_id, r.medio_pago,
           de.nombre AS de_nombre, para.nombre AS para_nombre
    FROM reparto_reembolsos r
    JOIN reparto_miembros de ON de.id = r.de_miembro_id
    JOIN reparto_miembros para ON para.id = r.para_miembro_id
    WHERE (r.anulado IS NOT TRUE) AND COALESCE(r.reparto_id, 1) = $1
    ${conFechas ? 'AND r.fecha >= $2::date AND r.fecha <= $3::date' : ''}
    ${miembroId ? 'AND (r.de_miembro_id = $' + paramsReemb.length + ' OR r.para_miembro_id = $' + paramsReemb.length + ')' : ''}
    ORDER BY r.fecha ASC, r.id ASC
  `, paramsReemb);

  const { rows: categorias } = await query(`
    SELECT id, nombre, color FROM reparto_categorias WHERE COALESCE(reparto_id, 1) = $1 ORDER BY nombre
  `, [repartoId]);

  const { rows: pagadoPorMiembro } = await query(`
    SELECT g.pagado_por_id, COALESCE(SUM(g.monto_total), 0) AS total
    FROM reparto_gastos g
    WHERE (g.anulado IS NOT TRUE) AND COALESCE(g.reparto_id, 1) = $1
    ${conFechas ? 'AND g.fecha >= $2::date AND g.fecha <= $3::date' : ''}
    GROUP BY g.pagado_por_id
  `, paramsTotales);
  const { rows: recibeReembolso } = await query(`
    SELECT r.para_miembro_id, COALESCE(SUM(r.monto), 0) AS total
    FROM reparto_reembolsos r
    WHERE (r.anulado IS NOT TRUE) AND COALESCE(r.reparto_id, 1) = $1
    ${conFechas ? 'AND r.fecha >= $2::date AND r.fecha <= $3::date' : ''}
    GROUP BY r.para_miembro_id
  `, paramsTotales);
  const { rows: daReembolso } = await query(`
    SELECT r.de_miembro_id, COALESCE(SUM(r.monto), 0) AS total
    FROM reparto_reembolsos r
    WHERE (r.anulado IS NOT TRUE) AND COALESCE(r.reparto_id, 1) = $1
    ${conFechas ? 'AND r.fecha >= $2::date AND r.fecha <= $3::date' : ''}
    GROUP BY r.de_miembro_id
  `, paramsTotales);

  const totalGastos = gastosTodos.reduce((s, g) => s + Number(g.monto_total), 0);
  const { cuotaPorMiembro, byMonth } = calcularCuotaPorMiembro(miembros, gastosTodos, participantesByGastoTodos, cargosByGastoTodos);
  const cuotaPorPersonaPromedio = N > 0 ? totalGastos / N : 0;
  const mapPagado = Object.fromEntries(pagadoPorMiembro.map(r => [r.pagado_por_id, Number(r.total)]));
  const mapRecibe = Object.fromEntries(recibeReembolso.map(r => [r.para_miembro_id, Number(r.total)]));
  const mapDa = Object.fromEntries(daReembolso.map(r => [r.de_miembro_id, Number(r.total)]));

  const miembrosConSaldo = miembros.map((m, i) => {
    const id = m.id;
    const totalPagado = mapPagado[id] || 0;
    const cuotaQueLeToca = Math.round(cuotaPorMiembro[i] * 100) / 100;
    const teDeben = totalPagado - cuotaQueLeToca;
    const reembolsosRecibidos = mapRecibe[id] || 0;
    const reembolsosDados = mapDa[id] || 0;
    const saldo = teDeben - reembolsosRecibidos + reembolsosDados;
    return {
      id: m.id,
      nombre: m.nombre,
      cargo_adicional_mensual: Math.round(Number(m.cargo_adicional_mensual || 0) * 100) / 100,
      total_pagado_servicios: totalPagado,
      cuota_que_le_toca: cuotaQueLeToca,
      te_deben: Math.round(teDeben * 100) / 100,
      reembolsos_recibidos: reembolsosRecibidos,
      reembolsos_dados: reembolsosDados,
      saldo: Math.round(saldo * 100) / 100,
      al_dia: saldo <= 0,
    };
  });

  const resumenPorMes = Object.keys(byMonth).sort().map(key => {
    const { total: totalMes, cuotas } = byMonth[key];
    return {
      mes: key,
      total: Math.round(totalMes * 100) / 100,
      cuota_por_persona: N > 0 ? Math.round((totalMes / N) * 100) / 100 : 0,
      cuotas: miembros.map((m, i) => ({ id: m.id, nombre: m.nombre, cuota: Math.round(cuotas[i] * 100) / 100 })),
    };
  });

  const saldos = miembrosConSaldo.map(m => ({ ...m, saldoNum: m.saldo }));
  const sugerencias_reembolso = calcularSugerenciasReembolso(saldos);

  const byCat = {};
  for (const g of gastosList) {
    const key = g.categoria_id || 0;
    const name = g.categoria_nombre || 'Sin categoría';
    if (!byCat[key]) byCat[key] = { nombre: name, total: 0 };
    byCat[key].total += Number(g.monto_total);
  }
  const desglose_por_categoria = Object.keys(byCat).map(k => ({
    nombre: byCat[k].nombre,
    total: Math.round(byCat[k].total * 100) / 100,
  })).sort((a, b) => b.total - a.total);

  return {
    miembros: miembrosConSaldo,
    gastos: gastosList,
    reembolsos,
    total_gastos: Math.round(totalGastos * 100) / 100,
    cuota_por_persona: Math.round(cuotaPorPersonaPromedio * 100) / 100,
    resumen_por_mes: resumenPorMes,
    desde: desde || null,
    hasta: hasta || null,
    categorias,
    sugerencias_reembolso,
    desglose_por_categoria,
  };
}

function escapeCsv(val) {
  const s = String(val ?? '');
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** GET /api/reparto/reportes/exportar?desde=&hasta=&formato=csv — descarga reporte en CSV */
const exportarReporte = async (req, res) => {
  try {
    const { desde, hasta, formato } = req.query;
    const repartoId = req.query.reparto_id ? parseInt(req.query.reparto_id, 10) : 1;
    const data = await getResumenData(desde || null, hasta || null, repartoId);

    if ((formato || 'csv').toLowerCase() !== 'csv') {
      return res.status(400).json({ error: 'Formato no soportado. Use formato=csv' });
    }

    const lines = [];
    const enc = (v) => escapeCsv(v);

    lines.push('REPARTO DE GASTOS — REPORTE');
    lines.push(`Período;${enc(data.desde || 'Todo')};${enc(data.hasta || 'Todo')}`);
    lines.push('');
    lines.push('RESUMEN POR MIEMBRO');
    lines.push('Nombre;Cargo adicional/mes;Pagó servicios;Cuota que le toca;Te deben;Reembolsos recibidos;Reembolsos dados;Saldo;Al día');
    for (const m of data.miembros) {
      lines.push([enc(m.nombre), enc(m.cargo_adicional_mensual), enc(m.total_pagado_servicios), enc(m.cuota_que_le_toca), enc(m.te_deben), enc(m.reembolsos_recibidos), enc(m.reembolsos_dados), enc(m.saldo), m.al_dia ? 'Sí' : 'No'].join(';'));
    }
    lines.push('');
    lines.push('GASTOS (servicios)');
    lines.push('Fecha;Concepto;Monto total;Pagado por;Notas');
    for (const g of data.gastos) {
      lines.push([enc(g.fecha), enc(g.concepto), enc(g.monto_total), enc(g.pagado_por_nombre), enc(g.notas)].join(';'));
    }
    lines.push('');
    lines.push('REEMBOLSOS');
    lines.push('Fecha;De;Para;Monto;Concepto');
    for (const r of data.reembolsos) {
      lines.push([enc(r.fecha), enc(r.de_nombre), enc(r.para_nombre), enc(r.monto), enc(r.concepto)].join(';'));
    }
    lines.push('');
    lines.push('TOTAL GASTOS;' + enc(data.total_gastos));
    lines.push('CUOTA POR PERSONA (promedio);' + enc(data.cuota_por_persona));

    const csv = lines.join('\r\n');
    const filename = `reparto-reporte-${data.desde || 'todo'}-${data.hasta || 'todo'}.csv`.replace(/\s/g, '-');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv);
  } catch (err) {
    logger.error({ err });
    res.status(500).json({ error: 'Error al generar reporte' });
  }
};

/** GET /api/reparto/miembros — query reparto_id (default 1) */
const getMiembros = async (req, res) => {
  try {
    const repartoId = req.query.reparto_id ? parseInt(req.query.reparto_id, 10) : 1;
    const { rows } = await query(`
      SELECT id, nombre, COALESCE(cargo_adicional_mensual, 0) AS cargo_adicional_mensual
      FROM reparto_miembros WHERE activo = true AND COALESCE(reparto_id, 1) = $1 ORDER BY nombre
    `, [repartoId]);
    res.json(rows);
  } catch (err) {
    logger.error({ err });
    res.status(500).json({ error: 'Error al listar miembros' });
  }
};

/** POST /api/reparto/miembros — agrega una persona al reparto. body: nombre, cargo_adicional_mensual?, reparto_id? (default 1) */
const createMiembro = async (req, res) => {
  const { nombre, cargo_adicional_mensual, reparto_id } = req.body;
  if (!nombre || typeof nombre !== 'string' || !nombre.trim())
    return res.status(400).json({ error: 'El nombre es obligatorio' });
  const nombreTrim = nombre.trim();
  if (nombreTrim.length > 100)
    return res.status(400).json({ error: 'El nombre no puede superar 100 caracteres' });
  const cargo = cargo_adicional_mensual != null ? parseFloat(cargo_adicional_mensual) : 0;
  if (isNaN(cargo) || cargo < 0)
    return res.status(400).json({ error: 'cargo_adicional_mensual debe ser un número >= 0' });
  const repartoId = reparto_id != null ? parseInt(reparto_id, 10) : 1;
  try {
    const { rows: existente } = await query(
      'SELECT id FROM reparto_miembros WHERE activo = true AND COALESCE(reparto_id, 1) = $1 AND LOWER(TRIM(nombre)) = LOWER($2)',
      [repartoId, nombreTrim]
    );
    if (existente.length > 0)
      return res.status(400).json({ error: 'Ya existe un miembro activo con ese nombre en el reparto' });
    const { rows: [row] } = await query(`
      INSERT INTO reparto_miembros (nombre, cargo_adicional_mensual, reparto_id)
      VALUES ($1, $2, $3)
      RETURNING id, nombre, COALESCE(cargo_adicional_mensual, 0) AS cargo_adicional_mensual
    `, [nombreTrim, cargo, repartoId]);
    res.status(201).json(row);
  } catch (err) {
    logger.error({ err });
    res.status(500).json({ error: 'Error al agregar miembro' });
  }
};

/** PUT /api/reparto/miembros/:id — actualiza cargo_adicional_mensual (ej. 150 por aire acondicionado) */
const updateMiembro = async (req, res) => {
  const { id } = req.params;
  const { cargo_adicional_mensual } = req.body;
  if (cargo_adicional_mensual == null)
    return res.status(400).json({ error: 'Indica cargo_adicional_mensual (puede ser 0)' });
  const val = parseFloat(cargo_adicional_mensual);
  if (isNaN(val) || val < 0)
    return res.status(400).json({ error: 'cargo_adicional_mensual debe ser un número >= 0' });
  try {
    const { rows: [row] } = await query(`
      UPDATE reparto_miembros SET cargo_adicional_mensual = $1 WHERE id = $2 RETURNING id, nombre, cargo_adicional_mensual
    `, [val, id]);
    if (!row) return res.status(404).json({ error: 'Miembro no encontrado' });
    res.json(row);
  } catch (err) {
    logger.error({ err });
    res.status(500).json({ error: 'Error al actualizar miembro' });
  }
};

/** DELETE /api/reparto/miembros/:id — quita a la persona del reparto (desactiva; no borra gastos/reembolsos pasados) */
const deleteMiembro = async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await query(
      'UPDATE reparto_miembros SET activo = false WHERE id = $1',
      [id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Miembro no encontrado' });
    res.json({ message: 'Persona eliminada del reparto' });
  } catch (err) {
    logger.error({ err });
    res.status(500).json({ error: 'Error al eliminar miembro' });
  }
};

/** GET /api/reparto/gastos — solo no anulados. Query: desde?, hasta?, reparto_id?, miembro_id? */
const getGastos = async (req, res) => {
  try {
    const { desde, hasta, reparto_id, miembro_id } = req.query;
    const repartoId = reparto_id ? parseInt(reparto_id, 10) : 1;
    const conFechas = desde && hasta;
    const params = [repartoId];
    if (conFechas) { params.push(desde, hasta); }
    if (miembro_id) params.push(parseInt(miembro_id, 10));
    const { rows } = await query(`
      SELECT g.id, g.concepto, g.monto_total, g.fecha, g.pagado_por_id, g.notas, g.categoria_id, g.recurrente, g.estado, g.fecha_corte, g.fecha_vencimiento, g.meses,
             m.nombre AS pagado_por_nombre, c.nombre AS categoria_nombre, c.color AS categoria_color
      FROM reparto_gastos g
      JOIN reparto_miembros m ON m.id = g.pagado_por_id
      LEFT JOIN reparto_categorias c ON c.id = g.categoria_id
      WHERE (g.anulado IS NOT TRUE) AND COALESCE(g.reparto_id, 1) = $1
      ${conFechas ? 'AND g.fecha >= $2::date AND g.fecha <= $3::date' : ''}
      ${miembro_id ? 'AND (g.pagado_por_id = $' + params.length + ' OR EXISTS (SELECT 1 FROM reparto_gasto_participantes p WHERE p.gasto_id = g.id AND p.miembro_id = $' + params.length + '))' : ''}
      ORDER BY g.fecha DESC, g.id DESC
    `, params);
    res.json(rows);
  } catch (err) {
    logger.error({ err });
    res.status(500).json({ error: 'Error al listar gastos' });
  }
};

/** PUT /api/reparto/gastos/:id — actualiza concepto, monto_total, fecha, pagado_por_id, notas, categoria_id, participantes? */
const updateGasto = async (req, res) => {
  const { id } = req.params;
  const { concepto, monto_total, fecha, pagado_por_id, notas, categoria_id, participantes, cargos } = req.body;
  const updates = [];
  const values = [];
  let i = 1;
  if (concepto !== undefined) { updates.push(`concepto = $${i++}`); values.push(typeof concepto === 'string' ? concepto.trim() : concepto); }
  if (concepto !== undefined && typeof concepto === 'string' && concepto.trim().length > 500)
    return res.status(400).json({ error: 'El concepto no puede superar 500 caracteres' });
  if (monto_total != null) {
    const m = parseFloat(monto_total);
    if (isNaN(m) || m <= 0) return res.status(400).json({ error: 'monto_total debe ser mayor a 0' });
    updates.push(`monto_total = $${i++}`); values.push(m);
  }
  if (fecha !== undefined) { updates.push(`fecha = $${i++}::date`); values.push(fecha); }
  if (pagado_por_id !== undefined) { updates.push(`pagado_por_id = $${i++}`); values.push(pagado_por_id); }
  if (notas !== undefined) { updates.push(`notas = $${i++}`); values.push(notas === '' ? null : notas); }
  if (categoria_id !== undefined) { updates.push(`categoria_id = $${i++}`); values.push(categoria_id === '' || categoria_id == null ? null : categoria_id); }
  if (req.body.medio_pago !== undefined) { updates.push(`medio_pago = $${i++}`); values.push(req.body.medio_pago === '' || req.body.medio_pago == null ? null : req.body.medio_pago); }
  if (req.body.fecha_corte !== undefined) { updates.push(`fecha_corte = $${i++}::date`); values.push(req.body.fecha_corte || null); }
  if (req.body.fecha_vencimiento !== undefined) { updates.push(`fecha_vencimiento = $${i++}::date`); values.push(req.body.fecha_vencimiento || null); }
  if (req.body.meses !== undefined) {
    const numMeses = parseInt(req.body.meses, 10);
    if (isNaN(numMeses) || numMeses < 1 || numMeses > 12)
      return res.status(400).json({ error: 'meses debe ser un número entre 1 y 12' });
    updates.push(`meses = $${i++}`); values.push(numMeses);
  }
  if (req.body.estado !== undefined) {
    if (!['borrador', 'confirmado'].includes(req.body.estado))
      return res.status(400).json({ error: "estado debe ser 'borrador' o 'confirmado'" });
    updates.push(`estado = $${i++}`); values.push(req.body.estado);
  }
  if (updates.length === 0 && !participantes)
    return res.status(400).json({ error: 'Indica al menos un campo a actualizar (concepto, monto_total, fecha, pagado_por_id, notas, categoria_id, participantes)' });
  values.push(id);
  try {
    const { rows: [gastoActual] } = await query(
      'SELECT id, reparto_id FROM reparto_gastos WHERE id = $1',
      [id]
    );
    if (!gastoActual) return res.status(404).json({ error: 'Gasto no encontrado' });
    const repartoId = gastoActual.reparto_id != null ? gastoActual.reparto_id : 1;
    const { rows: miembrosReparto } = await query(
      'SELECT id FROM reparto_miembros WHERE activo = true AND COALESCE(reparto_id, 1) = $1',
      [repartoId]
    );
    const idsMiembros = new Set(miembrosReparto.map(m => m.id));
    if (pagado_por_id !== undefined && !idsMiembros.has(Number(pagado_por_id)))
      return res.status(400).json({ error: 'pagado_por_id debe ser un miembro activo del reparto' });
    if (categoria_id !== undefined && categoria_id != null && categoria_id !== '') {
      const { rows: [cat] } = await query(
        'SELECT id FROM reparto_categorias WHERE id = $1 AND COALESCE(reparto_id, 1) = $2',
        [categoria_id, repartoId]
      );
      if (!cat)
        return res.status(400).json({ error: 'categoria_id no existe o no pertenece a este reparto' });
    }
    if (Array.isArray(participantes)) {
      const idsVistos = new Set();
      let algunPesoValido = false;
      for (const p of participantes) {
        if (p.miembro_id != null && p.peso != null && Number(p.peso) > 0) {
          if (!idsMiembros.has(Number(p.miembro_id)))
            return res.status(400).json({ error: `El miembro_id ${p.miembro_id} no pertenece al reparto` });
          if (idsVistos.has(Number(p.miembro_id)))
            return res.status(400).json({ error: `El miembro_id ${p.miembro_id} está duplicado en participantes` });
          idsVistos.add(Number(p.miembro_id));
          const peso = parseFloat(p.peso);
          if (isNaN(peso) || peso > 1000)
            return res.status(400).json({ error: 'Cada peso en participantes debe ser un número entre 0.01 y 1000' });
          algunPesoValido = true;
        }
      }
      if (participantes.length > 0 && !algunPesoValido)
        return res.status(400).json({ error: 'Si indicas participantes, al menos uno debe tener un peso mayor a 0' });
    }
    if (Array.isArray(cargos)) {
      const idsVistos = new Set();
      for (const c of cargos) {
        if (c.miembro_id != null && c.monto != null && Number(c.monto) > 0) {
          if (!idsMiembros.has(Number(c.miembro_id)))
            return res.status(400).json({ error: `El miembro_id ${c.miembro_id} no pertenece al reparto` });
          if (idsVistos.has(Number(c.miembro_id)))
            return res.status(400).json({ error: `El miembro_id ${c.miembro_id} está duplicado en cargos` });
          idsVistos.add(Number(c.miembro_id));
          const monto = parseFloat(c.monto);
          if (isNaN(monto) || monto > 100000)
            return res.status(400).json({ error: 'Cada monto en cargos debe ser un número entre 0.01 y 100000' });
        }
      }
    }
    if (updates.length > 0) {
      const { rows: [row] } = await query(`
        UPDATE reparto_gastos SET ${updates.join(', ')} WHERE id = $${i} RETURNING *
      `, values);
      if (!row) return res.status(404).json({ error: 'Gasto no encontrado' });
    }
    if (Array.isArray(participantes)) {
      await query('DELETE FROM reparto_gasto_participantes WHERE gasto_id = $1', [id]);
      for (const p of participantes) {
        if (p.miembro_id != null && p.peso != null && Number(p.peso) > 0)
          await query(
            'INSERT INTO reparto_gasto_participantes (gasto_id, miembro_id, peso) VALUES ($1, $2, $3) ON CONFLICT (gasto_id, miembro_id) DO UPDATE SET peso = $3',
            [id, p.miembro_id, parseFloat(p.peso)]
          );
      }
    }
    if (Array.isArray(cargos)) {
      await query('DELETE FROM reparto_gasto_cargos WHERE gasto_id = $1', [id]);
      for (const c of cargos) {
        if (c.miembro_id != null && c.monto != null && Number(c.monto) > 0)
          await query(
            'INSERT INTO reparto_gasto_cargos (gasto_id, miembro_id, monto) VALUES ($1, $2, $3) ON CONFLICT (gasto_id, miembro_id) DO UPDATE SET monto = $3',
            [id, c.miembro_id, parseFloat(c.monto)]
          );
      }
    }
    const { rows: [row] } = await query(`
      SELECT g.*, m.nombre AS pagado_por_nombre, c.nombre AS categoria_nombre
      FROM reparto_gastos g
      JOIN reparto_miembros m ON m.id = g.pagado_por_id
      LEFT JOIN reparto_categorias c ON c.id = g.categoria_id
      WHERE g.id = $1
    `, [id]);
    if (!row) return res.status(404).json({ error: 'Gasto no encontrado' });
    res.json(row);
  } catch (err) {
    logger.error({ err });
    res.status(500).json({ error: 'Error al actualizar gasto' });
  }
};

/** PUT /api/reparto/gastos/:id/confirmar — pasa un gasto en borrador a confirmado. body: medio_pago? */
const confirmarGasto = async (req, res) => {
  const { id } = req.params;
  const { medio_pago } = req.body;
  try {
    const { rows: [row] } = await query(`
      UPDATE reparto_gastos SET estado = 'confirmado', medio_pago = COALESCE($2, medio_pago)
      WHERE id = $1 AND (anulado IS NOT TRUE)
      RETURNING *
    `, [id, medio_pago || null]);
    if (!row) return res.status(404).json({ error: 'Gasto no encontrado' });
    res.json(row);
  } catch (err) {
    logger.error({ err });
    res.status(500).json({ error: 'Error al confirmar gasto' });
  }
};

/** DELETE /api/reparto/gastos/:id — marca como anulado. No permite si tiene reembolsos activos asociados (gasto_id = id) O si quien pagó el gasto ya recibió reembolsos activos (para_miembro_id = pagado_por_id). */
const deleteGasto = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows: [gasto] } = await query(
      'SELECT pagado_por_id FROM reparto_gastos WHERE id = $1',
      [id]
    );
    if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado' });

    const { rows: reembolsosAsociados } = await query(
      `SELECT id FROM reparto_reembolsos
       WHERE (anulado IS NOT TRUE)
         AND (gasto_id = $1 OR para_miembro_id = $2)
       LIMIT 1`,
      [id, gasto.pagado_por_id]
    );
    if (reembolsosAsociados.length > 0) {
      return res.status(400).json({
        error: 'No se puede anular el gasto porque hay reembolsos activos asociados o porque quien pagó este gasto ya recibió reembolsos. Anula primero esos reembolsos.',
        code: 'REEMBOLSOS_ASOCIADOS',
      });
    }
    const { rowCount } = await query(
      'UPDATE reparto_gastos SET anulado = true WHERE id = $1',
      [id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Gasto no encontrado' });
    res.json({ message: 'Gasto anulado' });
  } catch (err) {
    logger.error({ err });
    res.status(500).json({ error: 'Error al anular gasto' });
  }
};
/** POST /api/reparto/gastos — body: concepto, monto_total, fecha?, pagado_por_id, notas?, categoria_id?, reparto_id?, medio_pago?, participantes? */
const createGasto = async (req, res) => {
  const { concepto, monto_total, fecha, pagado_por_id, notas, categoria_id, reparto_id, participantes, estado, fecha_corte, fecha_vencimiento, meses, cargos } = req.body;
  if (!concepto || monto_total == null || !pagado_por_id)
    return res.status(400).json({ error: 'Faltan concepto, monto_total o pagado_por_id' });
  if (typeof concepto === 'string' && concepto.trim().length > 500)
    return res.status(400).json({ error: 'El concepto no puede superar 500 caracteres' });
  const monto = parseFloat(monto_total);
  if (isNaN(monto) || monto <= 0)
    return res.status(400).json({ error: 'monto_total debe ser mayor a 0' });
  if (estado != null && !['borrador', 'confirmado'].includes(estado))
    return res.status(400).json({ error: "estado debe ser 'borrador' o 'confirmado'" });
  const numMeses = meses != null ? parseInt(meses, 10) : 1;
  if (isNaN(numMeses) || numMeses < 1 || numMeses > 12)
    return res.status(400).json({ error: 'meses debe ser un número entre 1 y 12' });
  const repartoId = reparto_id != null ? parseInt(reparto_id, 10) : 1;
  try {
    const { rows: miembrosReparto } = await query(
      'SELECT id FROM reparto_miembros WHERE activo = true AND COALESCE(reparto_id, 1) = $1',
      [repartoId]
    );
    const idsMiembros = new Set(miembrosReparto.map(m => m.id));
    if (!idsMiembros.has(Number(pagado_por_id)))
      return res.status(400).json({ error: 'pagado_por_id debe ser un miembro activo del reparto' });
    if (categoria_id != null && categoria_id !== '') {
      const { rows: [cat] } = await query(
        'SELECT id FROM reparto_categorias WHERE id = $1 AND COALESCE(reparto_id, 1) = $2',
        [categoria_id, repartoId]
      );
      if (!cat)
        return res.status(400).json({ error: 'categoria_id no existe o no pertenece a este reparto' });
    }
    if (Array.isArray(participantes)) {
      const idsVistos = new Set();
      let algunPesoValido = false;
      for (const p of participantes) {
        if (p.miembro_id != null && p.peso != null && Number(p.peso) > 0) {
          if (!idsMiembros.has(Number(p.miembro_id)))
            return res.status(400).json({ error: `El miembro_id ${p.miembro_id} no pertenece al reparto` });
          if (idsVistos.has(Number(p.miembro_id)))
            return res.status(400).json({ error: `El miembro_id ${p.miembro_id} está duplicado en participantes` });
          idsVistos.add(Number(p.miembro_id));
          const peso = parseFloat(p.peso);
          if (isNaN(peso) || peso > 1000)
            return res.status(400).json({ error: 'Cada peso en participantes debe ser un número entre 0.01 y 1000' });
          algunPesoValido = true;
        }
      }
      if (participantes.length > 0 && !algunPesoValido)
        return res.status(400).json({ error: 'Si indicas participantes, al menos uno debe tener un peso mayor a 0' });
    }
    if (Array.isArray(cargos)) {
      const idsVistos = new Set();
      for (const c of cargos) {
        if (c.miembro_id != null && c.monto != null && Number(c.monto) > 0) {
          if (!idsMiembros.has(Number(c.miembro_id)))
            return res.status(400).json({ error: `El miembro_id ${c.miembro_id} no pertenece al reparto` });
          if (idsVistos.has(Number(c.miembro_id)))
            return res.status(400).json({ error: `El miembro_id ${c.miembro_id} está duplicado en cargos` });
          idsVistos.add(Number(c.miembro_id));
          const monto2 = parseFloat(c.monto);
          if (isNaN(monto2) || monto2 > 100000)
            return res.status(400).json({ error: 'Cada monto en cargos debe ser un número entre 0.01 y 100000' });
        }
      }
    }
    const { rows: [row] } = await query(`
      INSERT INTO reparto_gastos (concepto, monto_total, fecha, pagado_por_id, notas, categoria_id, reparto_id, medio_pago, estado, fecha_corte, fecha_vencimiento, meses)
      VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10::date, $11::date, $12)
      RETURNING *
    `, [concepto.trim(), monto, fecha || new Date().toISOString().split('T')[0], pagado_por_id, notas || null, categoria_id || null, repartoId, req.body.medio_pago || null, estado === 'borrador' ? 'borrador' : 'confirmado', fecha_corte || null, fecha_vencimiento || null, numMeses]);
    if (Array.isArray(participantes) && row) {
      for (const p of participantes) {
        if (p.miembro_id != null && p.peso != null && Number(p.peso) > 0)
          await query(
            'INSERT INTO reparto_gasto_participantes (gasto_id, miembro_id, peso) VALUES ($1, $2, $3)',
            [row.id, p.miembro_id, parseFloat(p.peso)]
          );
      }
    }
    if (Array.isArray(cargos) && row) {
      for (const c of cargos) {
        if (c.miembro_id != null && c.monto != null && Number(c.monto) > 0)
          await query(
            'INSERT INTO reparto_gasto_cargos (gasto_id, miembro_id, monto) VALUES ($1, $2, $3)',
            [row.id, c.miembro_id, parseFloat(c.monto)]
          );
      }
    }
    res.status(201).json(row);
  } catch (err) {
    logger.error({ err });
    res.status(500).json({ error: 'Error al registrar gasto' });
  }
};

/** GET /api/reparto/reembolsos — solo no anulados. Query: desde?, hasta?, reparto_id?, miembro_id? */
const getReembolsos = async (req, res) => {
  try {
    const { desde, hasta, reparto_id, miembro_id } = req.query;
    const repartoId = reparto_id ? parseInt(reparto_id, 10) : 1;
    const conFechas = desde && hasta;
    const params = [repartoId];
    if (conFechas) { params.push(desde, hasta); }
    if (miembro_id) params.push(parseInt(miembro_id, 10));
    const { rows } = await query(`
      SELECT r.id, r.de_miembro_id, r.para_miembro_id, r.monto, r.fecha, r.concepto, r.notas, r.gasto_id, r.medio_pago,
             de.nombre AS de_nombre, para.nombre AS para_nombre
      FROM reparto_reembolsos r
      JOIN reparto_miembros de ON de.id = r.de_miembro_id
      JOIN reparto_miembros para ON para.id = r.para_miembro_id
      WHERE (r.anulado IS NOT TRUE) AND COALESCE(r.reparto_id, 1) = $1
      ${conFechas ? 'AND r.fecha >= $2::date AND r.fecha <= $3::date' : ''}
      ${miembro_id ? 'AND (r.de_miembro_id = $' + params.length + ' OR r.para_miembro_id = $' + params.length + ')' : ''}
      ORDER BY r.fecha DESC, r.id DESC
    `, params);
    res.json(rows);
  } catch (err) {
    logger.error({ err });
    res.status(500).json({ error: 'Error al listar reembolsos' });
  }
};

/** POST /api/reparto/reembolsos — body: de_miembro_id, para_miembro_id, monto, fecha?, concepto?, notas?, gasto_id?, reparto_id? */
const createReembolso = async (req, res) => {
  const { de_miembro_id, para_miembro_id, monto, fecha, concepto, notas, gasto_id, reparto_id } = req.body;
  if (!de_miembro_id || !para_miembro_id || monto == null)
    return res.status(400).json({ error: 'Faltan de_miembro_id, para_miembro_id o monto' });
  if (de_miembro_id === para_miembro_id)
    return res.status(400).json({ error: 'de_miembro_id y para_miembro_id no pueden ser iguales' });
  const num = parseFloat(monto);
  if (isNaN(num) || num <= 0)
    return res.status(400).json({ error: 'monto debe ser mayor a 0' });
  const repartoId = reparto_id != null ? parseInt(reparto_id, 10) : 1;
  try {
    const { rows: miembrosReparto } = await query(
      'SELECT id FROM reparto_miembros WHERE activo = true AND COALESCE(reparto_id, 1) = $1',
      [repartoId]
    );
    const idsMiembros = new Set(miembrosReparto.map(m => m.id));
    if (!idsMiembros.has(Number(de_miembro_id)))
      return res.status(400).json({ error: 'de_miembro_id debe ser un miembro activo del reparto' });
    if (!idsMiembros.has(Number(para_miembro_id)))
      return res.status(400).json({ error: 'para_miembro_id debe ser un miembro activo del reparto' });
    if (gasto_id != null && gasto_id !== '') {
      const { rows: [gasto] } = await query(
        'SELECT id FROM reparto_gastos WHERE id = $1 AND (anulado IS NOT TRUE) AND COALESCE(reparto_id, 1) = $2',
        [gasto_id, repartoId]
      );
      if (!gasto)
        return res.status(400).json({ error: 'gasto_id no existe, está anulado o no pertenece a este reparto' });
    }
    const saldoQuienPaga = await getSaldoMiembro(Number(de_miembro_id));
    const debe = saldoQuienPaga < 0 ? -saldoQuienPaga : 0;
    if (num > debe) {
      return res.status(400).json({
        error: debe === 0
          ? 'Esta persona no debe nada. No puede registrar un reembolso a su nombre.'
          : `No se puede pagar más de lo que se debe. Máximo permitido: S/ ${debe.toFixed(2)}`,
        max_permitido: debe,
      });
    }
    const { rows: [row] } = await query(`
      INSERT INTO reparto_reembolsos (de_miembro_id, para_miembro_id, monto, fecha, concepto, notas, gasto_id, reparto_id, medio_pago)
      VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9)
      RETURNING *
    `, [de_miembro_id, para_miembro_id, num, fecha || new Date().toISOString().split('T')[0], concepto || null, notas || null, gasto_id || null, repartoId, req.body.medio_pago || null]);
    res.status(201).json(row);
  } catch (err) {
    logger.error({ err });
    res.status(500).json({ error: 'Error al registrar reembolso' });
  }
};

/** PUT /api/reparto/reembolsos/:id — actualiza de_miembro_id, para_miembro_id, monto, fecha, concepto, notas, gasto_id. No se puede pagar más de lo que se debe. */
const updateReembolso = async (req, res) => {
  const { id } = req.params;
  const { de_miembro_id, para_miembro_id, monto, fecha, concepto, notas, gasto_id } = req.body;
  if (de_miembro_id != null && para_miembro_id != null && Number(de_miembro_id) === Number(para_miembro_id))
    return res.status(400).json({ error: 'de_miembro_id y para_miembro_id no pueden ser iguales' });
  const updates = [];
  const values = [];
  let i = 1;
  if (de_miembro_id !== undefined) { updates.push(`de_miembro_id = $${i++}`); values.push(de_miembro_id); }
  if (para_miembro_id !== undefined) { updates.push(`para_miembro_id = $${i++}`); values.push(para_miembro_id); }
  if (monto != null) {
    const m = parseFloat(monto);
    if (isNaN(m) || m <= 0) return res.status(400).json({ error: 'monto debe ser mayor a 0' });
    updates.push(`monto = $${i++}`); values.push(m);
  }
  if (fecha !== undefined) { updates.push(`fecha = $${i++}::date`); values.push(fecha); }
  if (concepto !== undefined) { updates.push(`concepto = $${i++}`); values.push(concepto === '' ? null : concepto); }
  if (notas !== undefined) { updates.push(`notas = $${i++}`); values.push(notas === '' ? null : notas); }
  if (gasto_id !== undefined) { updates.push(`gasto_id = $${i++}`); values.push(gasto_id === '' || gasto_id == null ? null : gasto_id); }
  if (req.body.medio_pago !== undefined) { updates.push(`medio_pago = $${i++}`); values.push(req.body.medio_pago === '' || req.body.medio_pago == null ? null : req.body.medio_pago); }
  if (updates.length === 0)
    return res.status(400).json({ error: 'Indica al menos un campo a actualizar' });
  values.push(id);
  try {
    const { rows: [current] } = await query(
      'SELECT de_miembro_id, para_miembro_id, monto, reparto_id FROM reparto_reembolsos WHERE id = $1',
      [id]
    );
    if (!current) return res.status(404).json({ error: 'Reembolso no encontrado' });
    const repartoId = current.reparto_id != null ? current.reparto_id : 1;
    if (de_miembro_id !== undefined || para_miembro_id !== undefined || gasto_id !== undefined) {
      const { rows: miembrosReparto } = await query(
        'SELECT id FROM reparto_miembros WHERE activo = true AND COALESCE(reparto_id, 1) = $1',
        [repartoId]
      );
      const idsMiembros = new Set(miembrosReparto.map(m => m.id));
      const deId = de_miembro_id !== undefined ? Number(de_miembro_id) : current.de_miembro_id;
      const paraId = para_miembro_id !== undefined ? Number(para_miembro_id) : current.para_miembro_id;
      if (!idsMiembros.has(deId))
        return res.status(400).json({ error: 'de_miembro_id debe ser un miembro activo del reparto' });
      if (!idsMiembros.has(paraId))
        return res.status(400).json({ error: 'para_miembro_id debe ser un miembro activo del reparto' });
      if (gasto_id !== undefined && gasto_id != null && gasto_id !== '') {
        const { rows: [gasto] } = await query(
          'SELECT id FROM reparto_gastos WHERE id = $1 AND (anulado IS NOT TRUE) AND COALESCE(reparto_id, 1) = $2',
          [gasto_id, repartoId]
        );
        if (!gasto)
          return res.status(400).json({ error: 'gasto_id no existe, está anulado o no pertenece a este reparto' });
      }
    }
    const quienPaga = de_miembro_id !== undefined ? Number(de_miembro_id) : current.de_miembro_id;
    const montoNuevo = monto != null ? parseFloat(monto) : Number(current.monto);
    const saldoExcl = await getSaldoMiembro(quienPaga, id);
    const debe = saldoExcl < 0 ? -saldoExcl : 0;
    if (montoNuevo > debe) {
      return res.status(400).json({
        error: debe === 0
          ? 'Esta persona no debe nada. No puede registrar un reembolso a su nombre.'
          : `No se puede pagar más de lo que se debe. Máximo permitido: S/ ${debe.toFixed(2)}`,
        max_permitido: debe,
      });
    }
    const { rows: [row] } = await query(`
      UPDATE reparto_reembolsos SET ${updates.join(', ')} WHERE id = $${i} RETURNING *
    `, values);
    if (!row) return res.status(404).json({ error: 'Reembolso no encontrado' });
    res.json(row);
  } catch (err) {
    logger.error({ err });
    res.status(500).json({ error: 'Error al actualizar reembolso' });
  }
};

/** DELETE /api/reparto/reembolsos/:id — marca como anulado (soft delete) */
const deleteReembolso = async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await query(
      'UPDATE reparto_reembolsos SET anulado = true WHERE id = $1',
      [id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Reembolso no encontrado' });
    res.json({ message: 'Reembolso anulado' });
  } catch (err) {
    logger.error({ err });
    res.status(500).json({ error: 'Error al anular reembolso' });
  }
};

module.exports = {
  getResumen,
  getResumenData,
  getMiembros,
  createMiembro,
  updateMiembro,
  deleteMiembro,
  getGastos,
  createGasto,
  updateGasto,
  confirmarGasto,
  deleteGasto,
  getReembolsos,
  createReembolso,
  updateReembolso,
  deleteReembolso,
  exportarReporte,
};
