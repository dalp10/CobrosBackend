jest.mock('../../config/db', () => ({ query: jest.fn() }));
jest.mock('../../config/logger', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { query } = require('../../config/db');
const analiticaController = require('../analitica.controller');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function setupQueries({ porMes = [], totales = { dias_30: 0, dias_60: 0, dias_90: 0 }, deudores = [] }) {
  query.mockResolvedValueOnce({ rows: porMes });
  query.mockResolvedValueOnce({ rows: [totales] });
  query.mockResolvedValueOnce({ rows: deudores });
}

describe('analitica.controller getDashboard — score de riesgo', () => {
  beforeEach(() => jest.clearAllMocks());

  it('excluye deudores sin saldo pendiente (ya pagaron todo)', async () => {
    setupQueries({
      deudores: [{ id: 1, nombre: 'Ana', apellidos: 'Lopez', total_pagado: '500', total_prestado: '500', ultimo_pago: null, cuotas_vencidas: '0', max_dias_vencido: '0' }],
    });
    const req = {};
    const res = mockRes();
    await analiticaController.getDashboard(req, res);
    const body = res.json.mock.calls[0][0];
    expect(body.riesgo).toHaveLength(0);
  });

  it('marca riesgo "alto" con 3+ cuotas vencidas o más de 60 días de atraso', async () => {
    setupQueries({
      deudores: [{ id: 1, nombre: 'Ana', apellidos: 'Lopez', total_pagado: '0', total_prestado: '500', ultimo_pago: null, cuotas_vencidas: '3', max_dias_vencido: '10' }],
    });
    const req = {};
    const res = mockRes();
    await analiticaController.getDashboard(req, res);
    const body = res.json.mock.calls[0][0];
    expect(body.riesgo[0]).toMatchObject({ deudor_id: 1, nivel: 'alto' });
  });

  it('marca riesgo "medio" con 1-2 cuotas vencidas y poco atraso', async () => {
    setupQueries({
      deudores: [{ id: 1, nombre: 'Ana', apellidos: 'Lopez', total_pagado: '0', total_prestado: '500', ultimo_pago: null, cuotas_vencidas: '1', max_dias_vencido: '5' }],
    });
    const req = {};
    const res = mockRes();
    await analiticaController.getDashboard(req, res);
    const body = res.json.mock.calls[0][0];
    expect(body.riesgo[0]).toMatchObject({ nivel: 'medio' });
  });

  it('sin cuotas vencidas pero sin pagos registrados: riesgo "medio" ("Sin pagos registrados")', async () => {
    setupQueries({
      deudores: [{ id: 1, nombre: 'Ana', apellidos: 'Lopez', total_pagado: '0', total_prestado: '500', ultimo_pago: null, cuotas_vencidas: '0', max_dias_vencido: '0' }],
    });
    const req = {};
    const res = mockRes();
    await analiticaController.getDashboard(req, res);
    const body = res.json.mock.calls[0][0];
    expect(body.riesgo[0]).toMatchObject({ nivel: 'medio', motivo: 'Sin pagos registrados' });
  });

  it('sin cuotas vencidas y con pagos recientes (<=30 días): riesgo "bajo"', async () => {
    const hoy = new Date();
    setupQueries({
      deudores: [{ id: 1, nombre: 'Ana', apellidos: 'Lopez', total_pagado: '100', total_prestado: '500', ultimo_pago: hoy.toISOString(), cuotas_vencidas: '0', max_dias_vencido: '0' }],
    });
    const req = {};
    const res = mockRes();
    await analiticaController.getDashboard(req, res);
    const body = res.json.mock.calls[0][0];
    expect(body.riesgo[0]).toMatchObject({ nivel: 'bajo', motivo: 'Pagos al día' });
  });

  it('ordena primero por nivel de riesgo (alto > medio > bajo) y luego por saldo pendiente descendente', async () => {
    const hoy = new Date();
    setupQueries({
      deudores: [
        { id: 1, nombre: 'Bajo', apellidos: '', total_pagado: '900', total_prestado: '1000', ultimo_pago: hoy.toISOString(), cuotas_vencidas: '0', max_dias_vencido: '0' },
        { id: 2, nombre: 'AltoChico', apellidos: '', total_pagado: '0', total_prestado: '100', ultimo_pago: null, cuotas_vencidas: '3', max_dias_vencido: '10' },
        { id: 3, nombre: 'AltoGrande', apellidos: '', total_pagado: '0', total_prestado: '900', ultimo_pago: null, cuotas_vencidas: '5', max_dias_vencido: '90' },
      ],
    });
    const req = {};
    const res = mockRes();
    await analiticaController.getDashboard(req, res);
    const body = res.json.mock.calls[0][0];
    expect(body.riesgo.map(r => r.deudor_id)).toEqual([3, 2, 1]);
  });

  it('arma la proyección de cobros a 30/60/90 días', async () => {
    setupQueries({
      porMes: [{ mes: '2024-01', total: '500' }],
      totales: { dias_30: '100', dias_60: '300', dias_90: '500' },
    });
    const req = {};
    const res = mockRes();
    await analiticaController.getDashboard(req, res);
    const body = res.json.mock.calls[0][0];
    expect(body.proyeccion).toEqual({
      porMes: [{ mes: '2024-01', total: 500 }],
      dias_30: 100, dias_60: 300, dias_90: 500,
    });
  });

  it('devuelve 500 si la consulta falla', async () => {
    query.mockRejectedValueOnce(new Error('boom'));
    const req = {};
    const res = mockRes();
    await analiticaController.getDashboard(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
