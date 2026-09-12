// src/controllers/analitica.controller.js
const { query } = require('../config/db');
const logger = require('../config/logger');

// GET /api/analitica/dashboard
// Proyección de cobros (próximos 30/60/90 días) y score de riesgo de mora por deudor.
const getDashboard = async (req, res) => {
  try {
    // ── Proyección de cobros: cuotas pendientes/parciales agrupadas por mes ──
    const { rows: porMes } = await query(`
      SELECT
        TO_CHAR(fecha_vencimiento, 'YYYY-MM') AS mes,
        SUM(monto_esperado - monto_pagado) AS total
      FROM cuotas
      WHERE estado IN ('pendiente', 'parcial')
        AND fecha_vencimiento >= CURRENT_DATE
        AND fecha_vencimiento <= CURRENT_DATE + 90
      GROUP BY mes
      ORDER BY mes
    `);

    const { rows: [totalesProyeccion] } = await query(`
      SELECT
        COALESCE(SUM(monto_esperado - monto_pagado) FILTER (WHERE fecha_vencimiento <= CURRENT_DATE + 30), 0) AS dias_30,
        COALESCE(SUM(monto_esperado - monto_pagado) FILTER (WHERE fecha_vencimiento <= CURRENT_DATE + 60), 0) AS dias_60,
        COALESCE(SUM(monto_esperado - monto_pagado) FILTER (WHERE fecha_vencimiento <= CURRENT_DATE + 90), 0) AS dias_90
      FROM cuotas
      WHERE estado IN ('pendiente', 'parcial')
        AND fecha_vencimiento >= CURRENT_DATE
    `);

    // ── Score de riesgo: datos por deudor (saldo, último pago, cuotas vencidas) ──
    const { rows: deudores } = await query(`
      SELECT
        d.id,
        d.nombre, d.apellidos,
        (SELECT COALESCE(SUM(p.monto), 0) FROM pagos p WHERE p.deudor_id = d.id) AS total_pagado,
        (SELECT COALESCE(SUM(pr.monto_original), 0) FROM prestamos pr WHERE pr.deudor_id = d.id) AS total_prestado,
        (SELECT MAX(p.fecha_pago) FROM pagos p WHERE p.deudor_id = d.id) AS ultimo_pago,
        (
          SELECT COUNT(c.id)
          FROM cuotas c JOIN prestamos pr ON pr.id = c.prestamo_id
          WHERE pr.deudor_id = d.id AND c.estado IN ('pendiente','parcial','vencido') AND c.fecha_vencimiento < CURRENT_DATE
        ) AS cuotas_vencidas,
        (
          SELECT COALESCE(MAX(CURRENT_DATE - c.fecha_vencimiento), 0)
          FROM cuotas c JOIN prestamos pr ON pr.id = c.prestamo_id
          WHERE pr.deudor_id = d.id AND c.estado IN ('pendiente','parcial','vencido') AND c.fecha_vencimiento < CURRENT_DATE
        ) AS max_dias_vencido
      FROM deudores d
      WHERE d.activo = true
    `);

    const riesgo = [];
    for (const r of deudores) {
      const saldoPendiente = parseFloat(r.total_prestado) - parseFloat(r.total_pagado);
      if (saldoPendiente <= 0) continue;

      const cuotasVencidas = parseInt(r.cuotas_vencidas, 10);
      const maxDiasVencido = parseInt(r.max_dias_vencido, 10);
      let nivel, motivo;

      if (cuotasVencidas > 0) {
        if (cuotasVencidas >= 3 || maxDiasVencido > 60) {
          nivel = 'alto';
          motivo = `${cuotasVencidas} cuota${cuotasVencidas !== 1 ? 's' : ''} vencida${cuotasVencidas !== 1 ? 's' : ''}, hasta ${maxDiasVencido} días de atraso`;
        } else {
          nivel = 'medio';
          motivo = `${cuotasVencidas} cuota${cuotasVencidas !== 1 ? 's' : ''} vencida${cuotasVencidas !== 1 ? 's' : ''}`;
        }
      } else {
        const diasSinPago = r.ultimo_pago
          ? Math.floor((Date.now() - new Date(r.ultimo_pago).getTime()) / 86400000)
          : null;
        if (diasSinPago === null) {
          nivel = 'medio';
          motivo = 'Sin pagos registrados';
        } else if (diasSinPago > 60) {
          nivel = 'alto';
          motivo = `${diasSinPago} días sin registrar pagos`;
        } else if (diasSinPago > 30) {
          nivel = 'medio';
          motivo = `${diasSinPago} días sin registrar pagos`;
        } else {
          nivel = 'bajo';
          motivo = 'Pagos al día';
        }
      }

      riesgo.push({
        deudor_id: r.id,
        nombre: r.nombre,
        apellidos: r.apellidos,
        saldo_pendiente: saldoPendiente,
        nivel,
        motivo
      });
    }

    const orden = { alto: 0, medio: 1, bajo: 2 };
    riesgo.sort((a, b) => orden[a.nivel] - orden[b.nivel] || b.saldo_pendiente - a.saldo_pendiente);

    res.json({
      proyeccion: {
        porMes: porMes.map(r => ({ mes: r.mes, total: parseFloat(r.total) })),
        dias_30: parseFloat(totalesProyeccion.dias_30),
        dias_60: parseFloat(totalesProyeccion.dias_60),
        dias_90: parseFloat(totalesProyeccion.dias_90)
      },
      riesgo
    });
  } catch (err) {
    logger.error({ err });
    res.status(500).json({ error: 'Error al obtener analítica del dashboard' });
  }
};

module.exports = { getDashboard };
