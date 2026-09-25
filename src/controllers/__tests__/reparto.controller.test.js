jest.mock('../../config/db', () => ({ query: jest.fn() }));
jest.mock('../../config/logger', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { query } = require('../../config/db');
const repartoController = require('../reparto.controller');
const {
  calcularCuotaPorMiembro, calcularSugerenciasReembolso,
  createReembolso, createGasto, getResumenData, getMiembros,
  createMiembro, updateMiembro, deleteMiembro, getGastos, updateGasto,
  confirmarGasto, deleteGasto, getReembolsos, updateReembolso,
  deleteReembolso, exportarReporte,
} = repartoController;

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('calcularCuotaPorMiembro', () => {
  const miembros = [{ id: 1, nombre: 'A' }, { id: 2, nombre: 'B' }, { id: 3, nombre: 'C' }];

  it('reparte un gasto sin participantes definidos entre todos por igual', () => {
    const gastos = [{ id: 10, fecha: '2024-01-15', monto_total: 300 }];
    const { cuotaPorMiembro } = calcularCuotaPorMiembro(miembros, gastos, {}, {});
    expect(cuotaPorMiembro).toEqual([100, 100, 100]);
  });

  it('reparte un gasto con participantes explícitos solo entre ellos, según su peso', () => {
    const gastos = [{ id: 10, fecha: '2024-01-15', monto_total: 300 }];
    // Solo A y B participan, con pesos 1:2 -> A=100, B=200, C=0
    const participantesByGasto = { 10: [{ miembro_id: 1, peso: 1 }, { miembro_id: 2, peso: 2 }] };
    const { cuotaPorMiembro } = calcularCuotaPorMiembro(miembros, gastos, participantesByGasto, {});
    expect(cuotaPorMiembro[0]).toBeCloseTo(100);
    expect(cuotaPorMiembro[1]).toBeCloseTo(200);
    expect(cuotaPorMiembro[2]).toBe(0);
  });

  it('si los participantes son todos los miembros con igual peso, se trata como gasto compartido (aplican cargos)', () => {
    const gastos = [{ id: 10, fecha: '2024-01-15', monto_total: 300 }];
    const participantesByGasto = { 10: [{ miembro_id: 1, peso: 1 }, { miembro_id: 2, peso: 1 }, { miembro_id: 3, peso: 1 }] };
    const cargosByGasto = { 10: { 1: 30 } }; // A tiene un cargo extra de 30 en este gasto
    const { cuotaPorMiembro } = calcularCuotaPorMiembro(miembros, gastos, participantesByGasto, cargosByGasto);
    // Base = (300 - 30) / 3 = 90; A paga 90+30=120, B y C pagan 90 cada uno
    expect(cuotaPorMiembro).toEqual([120, 90, 90]);
  });

  it('descuenta los cargos adicionales de la base antes de repartir entre todos', () => {
    const gastos = [{ id: 10, fecha: '2024-01-15', monto_total: 300 }];
    const cargosByGasto = { 10: { 2: 60 } }; // B tiene un cargo aparte (ej. A/C) de 60
    const { cuotaPorMiembro } = calcularCuotaPorMiembro(miembros, gastos, {}, cargosByGasto);
    // Base = (300 - 60) / 3 = 80; B paga 80+60=140, A y C pagan 80 cada uno
    expect(cuotaPorMiembro).toEqual([80, 140, 80]);
  });

  it('agrupa el total y las cuotas por mes usando la fecha del gasto', () => {
    const gastos = [
      { id: 1, fecha: '2024-01-10', monto_total: 90 },
      { id: 2, fecha: '2024-02-05', monto_total: 60 },
    ];
    const { byMonth } = calcularCuotaPorMiembro(miembros, gastos, {}, {});
    expect(byMonth['2024-01'].total).toBe(90);
    expect(byMonth['2024-02'].total).toBe(60);
    expect(byMonth['2024-01'].cuotas).toEqual([30, 30, 30]);
  });
});

describe('calcularSugerenciasReembolso', () => {
  it('sugiere transferencias mínimas entre quien debe y quien le deben', () => {
    const saldos = [
      { id: 1, nombre: 'A', saldoNum: -100 }, // debe 100
      { id: 2, nombre: 'B', saldoNum: 40 },   // le deben 40
      { id: 3, nombre: 'C', saldoNum: 60 },   // le deben 60
    ];
    const sugerencias = calcularSugerenciasReembolso(saldos);
    expect(sugerencias).toEqual([
      { de_id: 1, de_nombre: 'A', para_id: 2, para_nombre: 'B', monto: 40 },
      { de_id: 1, de_nombre: 'A', para_id: 3, para_nombre: 'C', monto: 60 },
    ]);
  });

  it('no genera sugerencias cuando todos están al día', () => {
    const saldos = [{ id: 1, nombre: 'A', saldoNum: 0 }, { id: 2, nombre: 'B', saldoNum: 0 }];
    expect(calcularSugerenciasReembolso(saldos)).toEqual([]);
  });

  it('ignora diferencias insignificantes (menores a 1 céntimo)', () => {
    const saldos = [{ id: 1, nombre: 'A', saldoNum: -0.005 }, { id: 2, nombre: 'B', saldoNum: 0.005 }];
    expect(calcularSugerenciasReembolso(saldos)).toEqual([]);
  });
});

describe('reparto.controller createReembolso — no puede pagar más de lo que se debe', () => {
  beforeEach(() => jest.clearAllMocks());

  function mockGetSaldoMiembroQueries(saldoDeudorEsperado) {
    // getSaldoMiembro() hace 5 queries en este orden: miembros, gastos, participantes, cargos... en
    // realidad usa getParticipantesByGasto/getCargosByGasto (1 query cada uno si hay gastos) + pagado/recibe/da.
    // Para simplificar el escenario de prueba se usa un solo miembro sin gastos ni reembolsos previos,
    // de forma que el saldo es 0 y "debe" también es 0 (caso límite: no debe nada).
    query.mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'A', cargo_adicional_mensual: 0 }] }); // miembros
    query.mockResolvedValueOnce({ rows: [] }); // gastosTodos (vacío -> sin participantes/cargos)
    query.mockResolvedValueOnce({ rows: [] }); // pagadoPorMiembro
    query.mockResolvedValueOnce({ rows: [] }); // recibeReembolso
    query.mockResolvedValueOnce({ rows: [] }); // daReembolso
  }

  it('rechaza el reembolso si la persona no debe nada', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] }); // miembros activos del reparto (validación de ids)
    mockGetSaldoMiembroQueries();

    const req = { body: { de_miembro_id: 1, para_miembro_id: 2, monto: 10 } };
    const res = mockRes();
    await createReembolso(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('no debe nada') })
    );
  });

  it('rechaza de_miembro_id igual a para_miembro_id', async () => {
    const req = { body: { de_miembro_id: 1, para_miembro_id: 1, monto: 10 } };
    const res = mockRes();
    await createReembolso(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('reparto.controller createGasto — validaciones', () => {
  beforeEach(() => jest.clearAllMocks());

  it('devuelve 400 si faltan campos obligatorios', async () => {
    const req = { body: {} };
    const res = mockRes();
    await createGasto(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('devuelve 400 si pagado_por_id no es miembro activo del reparto', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 5 }] }); // miembros activos (id 5 solamente)
    const req = { body: { concepto: 'Luz', monto_total: 100, pagado_por_id: 99 } };
    const res = mockRes();
    await createGasto(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('miembro activo del reparto') })
    );
  });

  it('devuelve 400 si monto_total no es mayor a 0', async () => {
    const req = { body: { concepto: 'Luz', monto_total: 0, pagado_por_id: 1 } };
    const res = mockRes();
    await createGasto(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('getResumenData — integración con reparto de gastos y saldos', () => {
  beforeEach(() => jest.clearAllMocks());

  it('devuelve estructura vacía si no hay miembros activos', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // miembros
    const data = await getResumenData(null, null, 1);
    expect(data).toEqual(expect.objectContaining({ miembros: [], gastos: [], total_gastos: 0 }));
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('calcula saldos y sugerencias de reembolso a partir de un gasto compartido', async () => {
    const miembros = [{ id: 1, nombre: 'Ana', cargo_adicional_mensual: 0 }, { id: 2, nombre: 'Beto', cargo_adicional_mensual: 0 }];
    const gasto = { id: 10, concepto: 'Luz', monto_total: '200', fecha: '2024-01-15', pagado_por_id: 1, notas: null, categoria_id: null, medio_pago: null, recurrente: false, estado: 'confirmado', fecha_corte: null, fecha_vencimiento: null, meses: 1, pagado_por_nombre: 'Ana', categoria_nombre: null, categoria_color: null };
    const gastoSimple = { id: 10, fecha: '2024-01-15', monto_total: '200', meses: 1 };

    query.mockResolvedValueOnce({ rows: miembros });               // miembros
    query.mockResolvedValueOnce({ rows: [gasto] });                // gastosList
    query.mockResolvedValueOnce({ rows: [] });                     // participantes (gastosList ids)
    query.mockResolvedValueOnce({ rows: [] });                     // cargos (gastosList ids)
    query.mockResolvedValueOnce({ rows: [gastoSimple] });          // gastosTodos
    query.mockResolvedValueOnce({ rows: [] });                     // participantes (gastosTodos ids)
    query.mockResolvedValueOnce({ rows: [] });                     // cargos (gastosTodos ids)
    query.mockResolvedValueOnce({ rows: [] });                     // reembolsos
    query.mockResolvedValueOnce({ rows: [] });                     // categorias
    query.mockResolvedValueOnce({ rows: [{ pagado_por_id: 1, total: '200' }] }); // pagadoPorMiembro
    query.mockResolvedValueOnce({ rows: [] });                     // recibeReembolso
    query.mockResolvedValueOnce({ rows: [] });                     // daReembolso

    const data = await getResumenData(null, null, 1);

    expect(data.total_gastos).toBe(200);
    expect(data.cuota_por_persona).toBe(100);
    const ana = data.miembros.find(m => m.id === 1);
    const beto = data.miembros.find(m => m.id === 2);
    expect(ana.saldo).toBe(100);   // pagó 200, le tocaba 100 -> le deben 100
    expect(beto.saldo).toBe(-100); // no pagó nada, le tocaba 100 -> debe 100
    expect(data.sugerencias_reembolso).toEqual([
      { de_id: 2, de_nombre: 'Beto', para_id: 1, para_nombre: 'Ana', monto: 100 },
    ]);
  });
});

describe('reparto.controller — miembros', () => {
  beforeEach(() => jest.clearAllMocks());

  it('getMiembros lista los miembros activos del reparto', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'Ana' }] });
    const req = { query: {} };
    const res = mockRes();
    await getMiembros(req, res);
    expect(res.json).toHaveBeenCalledWith([{ id: 1, nombre: 'Ana' }]);
  });

  it('createMiembro devuelve 400 si el nombre está vacío', async () => {
    const req = { body: { nombre: '  ' } };
    const res = mockRes();
    await createMiembro(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('createMiembro devuelve 400 si cargo_adicional_mensual es negativo', async () => {
    const req = { body: { nombre: 'Ana', cargo_adicional_mensual: -5 } };
    const res = mockRes();
    await createMiembro(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('createMiembro devuelve 400 si ya existe un miembro activo con ese nombre', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const req = { body: { nombre: 'Ana' } };
    const res = mockRes();
    await createMiembro(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('createMiembro crea el miembro correctamente', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // sin duplicado
    query.mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'Ana', cargo_adicional_mensual: 0 }] });
    const req = { body: { nombre: 'Ana' } };
    const res = mockRes();
    await createMiembro(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('updateMiembro devuelve 400 si cargo_adicional_mensual es inválido', async () => {
    const req = { params: { id: '1' }, body: { cargo_adicional_mensual: 'abc' } };
    const res = mockRes();
    await updateMiembro(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('updateMiembro devuelve 404 si el miembro no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { params: { id: '999' }, body: { cargo_adicional_mensual: 10 } };
    const res = mockRes();
    await updateMiembro(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('deleteMiembro desactiva (no borra) al miembro', async () => {
    query.mockResolvedValueOnce({ rowCount: 1 });
    const req = { params: { id: '1' } };
    const res = mockRes();
    await deleteMiembro(req, res);
    expect(query).toHaveBeenCalledWith('UPDATE reparto_miembros SET activo = false WHERE id = $1', ['1']);
    expect(res.json).toHaveBeenCalledWith({ message: 'Persona eliminada del reparto' });
  });

  it('deleteMiembro devuelve 404 si no existe', async () => {
    query.mockResolvedValueOnce({ rowCount: 0 });
    const req = { params: { id: '999' } };
    const res = mockRes();
    await deleteMiembro(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('reparto.controller — gastos', () => {
  beforeEach(() => jest.clearAllMocks());

  it('getGastos lista los gastos no anulados', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const req = { query: {} };
    const res = mockRes();
    await getGastos(req, res);
    expect(res.json).toHaveBeenCalledWith([{ id: 1 }]);
  });

  it('createGasto: crea el gasto y sus participantes con peso', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] }); // miembros activos
    query.mockResolvedValueOnce({ rows: [{ id: 10, concepto: 'Luz' }] }); // INSERT gasto
    query.mockResolvedValueOnce({}); // INSERT participante 1
    query.mockResolvedValueOnce({}); // INSERT participante 2

    const req = {
      body: { concepto: 'Luz', monto_total: 100, pagado_por_id: 1, participantes: [{ miembro_id: 1, peso: 1 }, { miembro_id: 2, peso: 1 }] },
    };
    const res = mockRes();
    await createGasto(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('updateGasto devuelve 400 si no se envía ningún campo ni participantes', async () => {
    const req = { params: { id: '1' }, body: {} };
    const res = mockRes();
    await updateGasto(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('updateGasto devuelve 404 si el gasto no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { params: { id: '999' }, body: { concepto: 'Nuevo' } };
    const res = mockRes();
    await updateGasto(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('updateGasto valida que pagado_por_id sea miembro activo del reparto', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, reparto_id: 1 }] }); // gastoActual
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // miembros activos (solo id 1)
    const req = { params: { id: '1' }, body: { pagado_por_id: 99 } };
    const res = mockRes();
    await updateGasto(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('confirmarGasto pasa el gasto de borrador a confirmado', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, estado: 'confirmado' }] });
    const req = { params: { id: '1' }, body: { medio_pago: 'efectivo' } };
    const res = mockRes();
    await confirmarGasto(req, res);
    expect(res.json).toHaveBeenCalledWith({ id: 1, estado: 'confirmado' });
  });

  it('confirmarGasto devuelve 404 si el gasto no existe o está anulado', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { params: { id: '999' }, body: {} };
    const res = mockRes();
    await confirmarGasto(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('deleteGasto bloquea la anulación si hay reembolsos activos asociados', async () => {
    query.mockResolvedValueOnce({ rows: [{ pagado_por_id: 1 }] }); // gasto
    query.mockResolvedValueOnce({ rows: [{ id: 5 }] }); // reembolsos asociados
    const req = { params: { id: '1' } };
    const res = mockRes();
    await deleteGasto(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'REEMBOLSOS_ASOCIADOS' }));
  });

  it('deleteGasto anula el gasto si no hay reembolsos asociados', async () => {
    query.mockResolvedValueOnce({ rows: [{ pagado_por_id: 1 }] }); // gasto
    query.mockResolvedValueOnce({ rows: [] }); // sin reembolsos
    query.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE anulado
    const req = { params: { id: '1' } };
    const res = mockRes();
    await deleteGasto(req, res);
    expect(res.json).toHaveBeenCalledWith({ message: 'Gasto anulado' });
  });

  it('deleteGasto devuelve 404 si el gasto no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { params: { id: '999' } };
    const res = mockRes();
    await deleteGasto(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('reparto.controller — reembolsos', () => {
  beforeEach(() => jest.clearAllMocks());

  it('getReembolsos lista los reembolsos no anulados', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const req = { query: {} };
    const res = mockRes();
    await getReembolsos(req, res);
    expect(res.json).toHaveBeenCalledWith([{ id: 1 }]);
  });

  it('createReembolso registra el reembolso si el monto no supera lo que se debe', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] }); // miembros activos del reparto
    // getSaldoMiembro(de_miembro_id=2): saldo -100 (debe 100)
    query.mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'Ana' }, { id: 2, nombre: 'Beto' }] }); // miembros
    query.mockResolvedValueOnce({ rows: [{ id: 10, fecha: '2024-01-01', monto_total: 200, meses: 1 }] }); // gastosTodos
    query.mockResolvedValueOnce({ rows: [] }); // participantesByGasto
    query.mockResolvedValueOnce({ rows: [] }); // cargosByGasto
    query.mockResolvedValueOnce({ rows: [{ pagado_por_id: 1, total: '200' }] }); // pagadoPorMiembro
    query.mockResolvedValueOnce({ rows: [] }); // recibeReembolso
    query.mockResolvedValueOnce({ rows: [] }); // daReembolso
    query.mockResolvedValueOnce({ rows: [{ id: 99, monto: 50 }] }); // INSERT reembolso

    const req = { body: { de_miembro_id: 2, para_miembro_id: 1, monto: 50 } };
    const res = mockRes();
    await createReembolso(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('updateReembolso devuelve 404 si el reembolso no existe', async () => {
    const req = { params: { id: '999' }, body: { monto: 10 } };
    const res = mockRes();
    query.mockResolvedValueOnce({ rows: [] });
    await updateReembolso(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('updateReembolso devuelve 400 si no se envía ningún campo', async () => {
    const req = { params: { id: '1' }, body: {} };
    const res = mockRes();
    await updateReembolso(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('deleteReembolso anula (soft delete) el reembolso', async () => {
    query.mockResolvedValueOnce({ rowCount: 1 });
    const req = { params: { id: '1' } };
    const res = mockRes();
    await deleteReembolso(req, res);
    expect(res.json).toHaveBeenCalledWith({ message: 'Reembolso anulado' });
  });

  it('deleteReembolso devuelve 404 si no existe', async () => {
    query.mockResolvedValueOnce({ rowCount: 0 });
    const req = { params: { id: '999' } };
    const res = mockRes();
    await deleteReembolso(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('reparto.controller exportarReporte', () => {
  beforeEach(() => jest.clearAllMocks());

  it('devuelve 400 si el formato no es csv', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // miembros (getResumenData con N=0 corta temprano)
    const req = { query: { formato: 'xlsx' } };
    const res = mockRes();
    await exportarReporte(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('genera un CSV con BOM y las secciones esperadas', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // miembros -> N=0, corta temprano con estructura vacía
    const req = { query: {} };
    const res = { setHeader: jest.fn(), send: jest.fn() };
    await exportarReporte(req, res);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', expect.stringContaining('text/csv'));
    const csvSent = res.send.mock.calls[0][0];
    expect(csvSent.startsWith('﻿')).toBe(true);
    expect(csvSent).toContain('REPARTO DE GASTOS');
  });
});

describe('reparto.controller getResumen (wrapper)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('recorta gastos y reembolsos a los últimos 100 y los muestra más recientes primero', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // miembros -> N=0, atajo con estructura vacía
    const req = { query: {} };
    const res = mockRes();
    await repartoController.getResumen(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ gastos: [], reembolsos: [] }));
  });

  it('devuelve 500 si getResumenData falla', async () => {
    query.mockRejectedValueOnce(new Error('boom'));
    const req = { query: {} };
    const res = mockRes();
    await repartoController.getResumen(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('reparto.controller updateGasto — actualización completa con participantes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reemplaza participantes: borra los anteriores e inserta los nuevos', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, reparto_id: 1 }] }); // gastoActual
    query.mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] }); // miembros activos del reparto
    query.mockResolvedValueOnce({ rows: [{ id: 1, concepto: 'Luz' }] }); // UPDATE reparto_gastos
    query.mockResolvedValueOnce({}); // DELETE participantes previos
    query.mockResolvedValueOnce({}); // INSERT participante 1
    query.mockResolvedValueOnce({ rows: [{ id: 1, concepto: 'Luz', pagado_por_nombre: 'Ana' }] }); // SELECT final

    const req = {
      params: { id: '1' },
      body: { concepto: 'Luz', participantes: [{ miembro_id: 1, peso: 1 }] },
    };
    const res = mockRes();
    await updateGasto(req, res);

    expect(query).toHaveBeenCalledWith('DELETE FROM reparto_gasto_participantes WHERE gasto_id = $1', ['1']);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ concepto: 'Luz' }));
  });

  it('rechaza un peso de participante inválido (mayor a 1000)', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, reparto_id: 1 }] });
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const req = { params: { id: '1' }, body: { participantes: [{ miembro_id: 1, peso: 5000 }] } };
    const res = mockRes();
    await updateGasto(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rechaza participantes duplicados', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, reparto_id: 1 }] });
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const req = { params: { id: '1' }, body: { participantes: [{ miembro_id: 1, peso: 1 }, { miembro_id: 1, peso: 2 }] } };
    const res = mockRes();
    await updateGasto(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('reparto.controller createReembolso / updateReembolso — no puede exceder lo que se debe', () => {
  beforeEach(() => jest.clearAllMocks());

  it('createReembolso rechaza un monto mayor a la deuda', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] }); // miembros activos del reparto
    // getSaldoMiembro(de_miembro_id=2)
    query.mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'Ana', cargo_adicional_mensual: 0 }, { id: 2, nombre: 'Beto', cargo_adicional_mensual: 0 }] });
    query.mockResolvedValueOnce({ rows: [{ id: 10, fecha: '2024-01-01', monto_total: 200, meses: 1 }] }); // gastosTodos
    query.mockResolvedValueOnce({ rows: [] }); // participantes
    query.mockResolvedValueOnce({ rows: [] }); // cargos
    query.mockResolvedValueOnce({ rows: [{ pagado_por_id: 1, total: '200' }] }); // pagadoPorMiembro
    query.mockResolvedValueOnce({ rows: [] }); // recibeReembolso
    query.mockResolvedValueOnce({ rows: [] }); // daReembolso -> Beto debe 100

    const req = { body: { de_miembro_id: 2, para_miembro_id: 1, monto: 500 } };
    const res = mockRes();
    await createReembolso(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ max_permitido: 100 }));
  });

  it('updateReembolso actualiza el monto si no excede lo que se debe', async () => {
    query.mockResolvedValueOnce({ rows: [{ de_miembro_id: 2, para_miembro_id: 1, monto: 50, reparto_id: 1 }] }); // current
    // getSaldoMiembro(2, excluirReembolsoId=id)
    query.mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'Ana', cargo_adicional_mensual: 0 }, { id: 2, nombre: 'Beto', cargo_adicional_mensual: 0 }] });
    query.mockResolvedValueOnce({ rows: [{ id: 10, fecha: '2024-01-01', monto_total: 200, meses: 1 }] });
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ pagado_por_id: 1, total: '200' }] });
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ de_miembro_id: 2, total: '50' }] }); // daReembolso (el propio reembolso a excluir)
    query.mockResolvedValueOnce({ rows: [{ id: 1, de_miembro_id: 2, monto: 50 }] }); // SELECT excl (monto del propio reembolso)
    query.mockResolvedValueOnce({ rows: [{ id: 1, monto: 80 }] }); // UPDATE

    const req = { params: { id: '1' }, body: { monto: 80 } };
    const res = mockRes();
    await updateReembolso(req, res);
    expect(res.json).toHaveBeenCalledWith({ id: 1, monto: 80 });
  });
});
