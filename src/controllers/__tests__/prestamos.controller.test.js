jest.mock('../../config/db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
}));
jest.mock('../../config/logger', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { query, getClient } = require('../../config/db');
const prestamosController = require('../prestamos.controller');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function mockClient(responses) {
  const client = { query: jest.fn(), release: jest.fn() };
  for (const r of responses) client.query.mockResolvedValueOnce(r);
  return client;
}

describe('prestamos.controller getAll', () => {
  beforeEach(() => jest.clearAllMocks());

  it('filtra por deudor_id cuando se especifica', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const req = { query: { deudor_id: '5' } };
    const res = mockRes();
    await prestamosController.getAll(req, res);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('WHERE pr.deudor_id = $1');
    expect(params).toEqual(['5']);
    expect(res.json).toHaveBeenCalledWith([{ id: 1 }]);
  });

  it('sin filtro devuelve todos los préstamos', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { query: {} };
    const res = mockRes();
    await prestamosController.getAll(req, res);
    const [sql, params] = query.mock.calls[0];
    expect(sql).not.toContain('WHERE pr.deudor_id');
    expect(params).toEqual([]);
  });

  it('devuelve 500 si la consulta falla', async () => {
    query.mockRejectedValueOnce(new Error('boom'));
    const req = { query: {} };
    const res = mockRes();
    await prestamosController.getAll(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('prestamos.controller getById', () => {
  beforeEach(() => jest.clearAllMocks());

  it('devuelve 404 si el préstamo no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { params: { id: '999' } };
    const res = mockRes();
    await prestamosController.getById(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('calcula saldo_pendiente y saldo_capital a partir de las cuotas', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, monto_original: '1000' }] }); // prestamo
    query.mockResolvedValueOnce({
      rows: [
        { numero_cuota: 1, monto_esperado: '500', monto_pagado: '500', monto_capital: '450', monto_interes: '50' },
        { numero_cuota: 2, monto_esperado: '500', monto_pagado: '0', monto_capital: '472.5', monto_interes: '27.5' },
      ],
    }); // cuotas
    query.mockResolvedValueOnce({ rows: [{ id: 1, monto: '500' }] }); // pagos

    const req = { params: { id: '1' } };
    const res = mockRes();
    await prestamosController.getById(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.total_pagado).toBe(500);
    expect(body.saldo_pendiente).toBe(500); // 1000 esperado - max(500 cuotas, 500 pagos)
    expect(body.saldo_capital).toBeCloseTo(550); // 1000 - 450 amortizado
    expect(body.interes_total).toBeCloseTo(77.5);
  });

  it('sin cronograma de cuotas, calcula el saldo directo sobre monto_original', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, monto_original: '300' }] });
    query.mockResolvedValueOnce({ rows: [] }); // sin cuotas
    query.mockResolvedValueOnce({ rows: [{ monto: '100' }] }); // un pago de 100

    const req = { params: { id: '1' } };
    const res = mockRes();
    await prestamosController.getById(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.saldo_pendiente).toBe(200); // 300 - 100
  });
});

describe('prestamos.controller updateEstado', () => {
  beforeEach(() => jest.clearAllMocks());

  it('actualiza el estado del préstamo', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, estado: 'pagado' }] });
    const req = { params: { id: '1' }, body: { estado: 'pagado' } };
    const res = mockRes();
    await prestamosController.updateEstado(req, res);
    expect(res.json).toHaveBeenCalledWith({ id: 1, estado: 'pagado' });
  });

  it('devuelve 500 si la consulta falla', async () => {
    query.mockRejectedValueOnce(new Error('boom'));
    const req = { params: { id: '1' }, body: { estado: 'pagado' } };
    const res = mockRes();
    await prestamosController.updateEstado(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('prestamos.controller getCuotas', () => {
  beforeEach(() => jest.clearAllMocks());

  it('devuelve las cuotas ordenadas por numero_cuota', async () => {
    query.mockResolvedValueOnce({ rows: [{ numero_cuota: 1 }, { numero_cuota: 2 }] });
    const req = { params: { id: '1' } };
    const res = mockRes();
    await prestamosController.getCuotas(req, res);
    expect(res.json).toHaveBeenCalledWith([{ numero_cuota: 1 }, { numero_cuota: 2 }]);
  });
});

describe('prestamos.controller create', () => {
  beforeEach(() => jest.clearAllMocks());

  it('devuelve 400 si faltan campos requeridos', async () => {
    const req = { body: {} };
    const res = mockRes();
    await prestamosController.create(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(getClient).not.toHaveBeenCalled();
  });

  it('un préstamo simple (1 cuota, sin cuota_mensual) no genera cronograma', async () => {
    const client = mockClient([
      undefined, // BEGIN
      { rows: [{ id: 1, monto_original: 500 }] }, // INSERT prestamos
      undefined, // COMMIT
    ]);
    getClient.mockResolvedValue(client);

    const req = {
      body: { deudor_id: 1, tipo: 'prestamo', monto_original: 500, fecha_inicio: '2024-01-01' },
    };
    const res = mockRes();
    await prestamosController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ cuotas: [] }));
    // Solo BEGIN + INSERT prestamos + COMMIT: ningún INSERT de cuotas
    expect(client.query).toHaveBeenCalledTimes(3);
  });

  it('genera el cronograma completo con desglose capital/interés cuando hay varias cuotas', async () => {
    const client = mockClient([
      undefined, // BEGIN
      { rows: [{ id: 1, monto_original: 1000 }] }, // INSERT prestamos
      undefined, // INSERT cuota 1
      undefined, // INSERT cuota 2
      undefined, // COMMIT
    ]);
    getClient.mockResolvedValue(client);

    const req = {
      body: {
        deudor_id: 1, tipo: 'prestamo', monto_original: 1000, tasa_interes: 5,
        total_cuotas: 2, fecha_inicio: '2024-01-01',
      },
    };
    const res = mockRes();
    await prestamosController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.cuotas).toHaveLength(2);
    // Cuota mensual = 1000/2 = 500; interés cuota 1 = 1000*5% = 50; capital = 450
    expect(body.cuotas[0]).toMatchObject({ numero_cuota: 1, monto_esperado: 500, monto_interes: 50, monto_capital: 450 });
    // Interés cuota 2 sobre saldo restante (1000-450=550): 550*5%=27.5; capital=472.5
    expect(body.cuotas[1]).toMatchObject({ numero_cuota: 2, monto_interes: 27.5, monto_capital: 472.5 });

    const insertCuotaCalls = client.query.mock.calls.filter(
      c => typeof c[0] === 'string' && c[0].includes('INSERT INTO cuotas')
    );
    expect(insertCuotaCalls).toHaveLength(2);
  });

  it('hace rollback y responde 500 si falla la transacción', async () => {
    const client = mockClient([undefined]); // BEGIN
    client.query.mockRejectedValueOnce(new Error('db down'));
    getClient.mockResolvedValue(client);

    const req = { body: { deudor_id: 1, tipo: 'prestamo', monto_original: 100, fecha_inicio: '2024-01-01' } };
    const res = mockRes();
    await prestamosController.create(req, res);

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(client.release).toHaveBeenCalled();
  });
});

describe('prestamos.controller update', () => {
  beforeEach(() => jest.clearAllMocks());

  it('devuelve 400 si no se envían campos', async () => {
    const req = { params: { id: '1' }, body: {} };
    const res = mockRes();
    await prestamosController.update(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('bloquea cambiar monto_original si el préstamo ya tiene cronograma de cuotas', async () => {
    query.mockResolvedValueOnce({ rows: [{ count: '3' }] }); // COUNT cuotas > 0

    const req = { params: { id: '1' }, body: { monto_original: 999 } };
    const res = mockRes();
    await prestamosController.update(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Reprogramar cronograma') })
    );
  });

  it('permite actualizar otros campos sin tocar cuotas', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, descripcion: 'nuevo' }] }); // UPDATE

    const req = { params: { id: '1' }, body: { descripcion: 'nuevo' } };
    const res = mockRes();
    await prestamosController.update(req, res);

    expect(res.json).toHaveBeenCalledWith({ id: 1, descripcion: 'nuevo' });
  });

  it('devuelve 404 si el préstamo no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { params: { id: '999' }, body: { descripcion: 'x' } };
    const res = mockRes();
    await prestamosController.update(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('prestamos.controller reprogramar', () => {
  beforeEach(() => jest.clearAllMocks());

  it('devuelve 400 si faltan cuota_mensual o total_cuotas', async () => {
    const req = { params: { id: '1' }, body: {} };
    const res = mockRes();
    await prestamosController.reprogramar(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(getClient).not.toHaveBeenCalled();
  });

  it('devuelve 404 si el préstamo no existe', async () => {
    const client = mockClient([
      undefined, // BEGIN
      { rows: [] }, // SELECT prestamo -> no existe
      undefined, // ROLLBACK
    ]);
    getClient.mockResolvedValue(client);

    const req = { params: { id: '999' }, body: { cuota_mensual: 100, total_cuotas: 3 } };
    const res = mockRes();
    await prestamosController.reprogramar(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('conserva las cuotas ya pagadas y recalcula el resto a partir del saldo pendiente', async () => {
    const prestamo = { id: 1, monto_original: 1000, tasa_interes: 5, fecha_inicio: '2024-01-01' };
    const cuotaPagada = {
      id: 1, numero_cuota: 1, estado: 'pagado', monto_esperado: '500.00', monto_pagado: '500.00',
      fecha_vencimiento: '2024-01-01', monto_capital: '450.00', monto_interes: '50.00',
    };
    const client = mockClient([
      undefined, // BEGIN
      { rows: [prestamo] }, // SELECT prestamo
      { rows: [cuotaPagada] }, // SELECT cuotas actuales
      undefined, // DELETE cuotas no pagadas
      undefined, // INSERT nueva cuota 2
      undefined, // INSERT nueva cuota 3
      { rows: [{ id: 1, total_cuotas: 3, cuota_mensual: 250 }] }, // UPDATE prestamos
      undefined, // COMMIT
    ]);
    getClient.mockResolvedValue(client);
    query.mockResolvedValueOnce({ rows: [{ numero_cuota: 2 }, { numero_cuota: 3 }] }); // SELECT final cuotas (usa `query`, no `client.query`)

    const req = { params: { id: '1' }, body: { cuota_mensual: 250, total_cuotas: 2 } };
    const res = mockRes();
    await prestamosController.reprogramar(req, res);

    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(client.query).toHaveBeenCalledWith(
      `DELETE FROM cuotas WHERE prestamo_id = $1 AND estado != 'pagado'`,
      ['1']
    );
    // Las nuevas cuotas continúan numeración después de la ya pagada (numeroInicial = 2)
    const insertCalls = client.query.mock.calls.filter(c => typeof c[0] === 'string' && c[0].includes('INSERT INTO cuotas'));
    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0][1][1]).toBe(2); // numero_cuota de la primera cuota nueva
  });
});
