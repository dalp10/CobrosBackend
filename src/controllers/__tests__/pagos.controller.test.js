jest.mock('../../config/db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
}));
jest.mock('../../utils/uploads', () => ({ tryDeleteUpload: jest.fn() }));
jest.mock('../../config/logger', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { query, getClient } = require('../../config/db');
const { tryDeleteUpload } = require('../../utils/uploads');
const pagosController = require('../pagos.controller');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function mockClient(responses) {
  const client = {
    query: jest.fn(),
    release: jest.fn(),
  };
  for (const r of responses) client.query.mockResolvedValueOnce(r);
  return client;
}

describe('pagos.controller create', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('devuelve 400 si faltan campos requeridos', async () => {
    const req = { body: {} };
    const res = mockRes();
    await pagosController.create(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(getClient).not.toHaveBeenCalled();
  });

  it('devuelve 409 y hace rollback si detecta un pago duplicado', async () => {
    const client = mockClient([
      undefined, // BEGIN
      { rows: [{ id: 99, fecha_pago: '2024-01-01', monto: 100, metodo_pago: 'efectivo' }] }, // dup check
      undefined, // ROLLBACK
    ]);
    getClient.mockResolvedValue(client);

    const req = {
      body: { deudor_id: 1, fecha_pago: '2024-01-01', monto: 100, metodo_pago: 'efectivo' },
    };
    const res = mockRes();
    await pagosController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ duplicado: true }));
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('permite forzar el registro aunque exista un posible duplicado (force=true)', async () => {
    const client = mockClient([
      undefined, // BEGIN
      { rows: [{ id: 1, deudor_id: 1, monto: 100, prestamo_id: null }] }, // INSERT pagos (sin prestamo -> sin chequeo de saldo ni cuotas)
      undefined, // COMMIT
    ]);
    getClient.mockResolvedValue(client);

    const req = {
      body: { deudor_id: 1, fecha_pago: '2024-01-01', monto: 100, metodo_pago: 'efectivo', force: 'true' },
    };
    const res = mockRes();
    await pagosController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    // Con force=true no debe haber consulta de duplicados: solo BEGIN, INSERT, COMMIT
    expect(client.query).toHaveBeenCalledTimes(3);
  });

  it('devuelve 400 si el monto excede el saldo pendiente del préstamo', async () => {
    const client = mockClient([
      undefined, // BEGIN
      { rows: [] }, // dup check (sin numero_operacion)
      undefined, // SELECT ... FOR UPDATE
      { rows: [{ monto_original: 100, total_pagado: 90 }] }, // saldo pendiente = 10
      undefined, // ROLLBACK
    ]);
    getClient.mockResolvedValue(client);

    const req = {
      body: { deudor_id: 1, prestamo_id: 5, fecha_pago: '2024-01-01', monto: 50, metodo_pago: 'efectivo' },
    };
    const res = mockRes();
    await pagosController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('excede el saldo pendiente') })
    );
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('reparte el pago sobre la cuota pendiente más antigua (capital/interés) y registra el pago', async () => {
    const cuotaPendiente = {
      id: 42,
      numero_cuota: 1,
      monto_esperado: '100.00',
      monto_pagado: '0.00',
      monto_interes: '10.00',
    };
    const client = mockClient([
      undefined, // BEGIN
      { rows: [] }, // dup check
      undefined, // SELECT ... FOR UPDATE
      { rows: [{ monto_original: 1000, total_pagado: 0 }] }, // saldo pendiente = 1000
      { rows: [cuotaPendiente] }, // aplicarPagoACuotas: cuotas pendientes
      undefined, // UPDATE cuotas
      { rows: [{ id: 1, deudor_id: 1, prestamo_id: 5, monto: 100 }] }, // INSERT pagos
      undefined, // COMMIT
    ]);
    getClient.mockResolvedValue(client);

    const req = {
      body: { deudor_id: 1, prestamo_id: 5, fecha_pago: '2024-01-01', monto: 100, metodo_pago: 'efectivo' },
    };
    const res = mockRes();
    await pagosController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    // La cuota se marca pagada, con el desglose capital/interés proporcional al monto_interes de la cuota
    expect(client.query).toHaveBeenCalledWith(
      'UPDATE cuotas SET monto_pagado = $1, estado = $2 WHERE id = $3',
      [100, 'pagado', 42]
    );
    // El INSERT final de pagos recibe el JSON de cuotas aplicadas como último-antepenúltimo parámetro
    const insertCall = client.query.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('INSERT INTO pagos'));
    expect(insertCall).toBeDefined();
    const cuotasAplicadasJson = insertCall[1][13];
    const cuotasAplicadas = JSON.parse(cuotasAplicadasJson);
    expect(cuotasAplicadas).toHaveLength(1);
    expect(cuotasAplicadas[0]).toMatchObject({
      numero_cuota: 1,
      monto_aplicado: 100,
      estado: 'pagado',
      interes_aplicado: 10, // 100 * (10/100)
      capital_aplicado: 90,
    });
  });

  it('reparte un pago parcial solo hasta cubrir la primera cuota pendiente, sin tocar las siguientes', async () => {
    const cuota1 = { id: 1, numero_cuota: 1, monto_esperado: '100.00', monto_pagado: '0.00', monto_interes: '0.00' };
    const cuota2 = { id: 2, numero_cuota: 2, monto_esperado: '100.00', monto_pagado: '0.00', monto_interes: '0.00' };
    const client = mockClient([
      undefined, // BEGIN
      { rows: [] }, // dup check
      undefined, // FOR UPDATE
      { rows: [{ monto_original: 1000, total_pagado: 0 }] },
      { rows: [cuota1, cuota2] }, // cuotas pendientes
      undefined, // UPDATE cuota1 (parcial)
      { rows: [{ id: 1 }] }, // INSERT pagos
      undefined, // COMMIT
    ]);
    getClient.mockResolvedValue(client);

    const req = {
      body: { deudor_id: 1, prestamo_id: 5, fecha_pago: '2024-01-01', monto: 60, metodo_pago: 'efectivo' },
    };
    const res = mockRes();
    await pagosController.create(req, res);

    expect(client.query).toHaveBeenCalledWith(
      'UPDATE cuotas SET monto_pagado = $1, estado = $2 WHERE id = $3',
      [60, 'parcial', 1]
    );
    // Solo una UPDATE de cuotas: la cuota 2 no debe tocarse porque el monto no alcanzó
    const updateCalls = client.query.mock.calls.filter(c => c[0] === 'UPDATE cuotas SET monto_pagado = $1, estado = $2 WHERE id = $3');
    expect(updateCalls).toHaveLength(1);
  });

  it('en error inesperado hace rollback, libera el cliente y responde 500', async () => {
    const client = mockClient([
      undefined, // BEGIN
    ]);
    client.query.mockRejectedValueOnce(new Error('boom')); // dup check falla
    getClient.mockResolvedValue(client);

    const req = {
      body: { deudor_id: 1, fecha_pago: '2024-01-01', monto: 100, metodo_pago: 'efectivo' },
    };
    const res = mockRes();
    await pagosController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(client.release).toHaveBeenCalled();
  });
});

describe('pagos.controller getAll', () => {
  beforeEach(() => jest.clearAllMocks());

  it('filtra por deudor_id, metodo y rango de fechas, y pagina la respuesta', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    query.mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const req = { query: { deudor_id: '5', metodo: 'efectivo', desde: '2024-01-01', hasta: '2024-01-31', page: '2', limit: '10' } };
    const res = mockRes();
    await pagosController.getAll(req, res);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('p.deudor_id = $1');
    expect(sql).toContain('p.metodo_pago = $2');
    expect(sql).toContain('p.fecha_pago >= $3');
    expect(sql).toContain('p.fecha_pago <= $4');
    expect(params).toEqual(['5', 'efectivo', '2024-01-01', '2024-01-31', 10, 10]); // offset = (2-1)*10
    expect(res.json).toHaveBeenCalledWith({ data: [{ id: 1 }], total: 1, page: 2, limit: 10 });
  });

  it('sin filtros, no agrega WHERE y usa page=1/limit=50 por defecto', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    const req = { query: {} };
    const res = mockRes();
    await pagosController.getAll(req, res);
    const [sql] = query.mock.calls[0];
    expect(sql).not.toContain('WHERE');
    expect(res.json).toHaveBeenCalledWith({ data: [], total: 0, page: 1, limit: 50 });
  });

  it('devuelve 500 si la consulta falla', async () => {
    query.mockRejectedValueOnce(new Error('boom'));
    const req = { query: {} };
    const res = mockRes();
    await pagosController.getAll(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('pagos.controller update', () => {
  beforeEach(() => jest.clearAllMocks());

  it('devuelve 404 si el pago no existe', async () => {
    const client = mockClient([
      undefined, // BEGIN
      { rows: [] }, // SELECT pago actual
      undefined, // ROLLBACK
    ]);
    getClient.mockResolvedValue(client);
    const req = { params: { id: '999' }, body: { monto: 100 } };
    const res = mockRes();
    await pagosController.update(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('rechaza cambiar el préstamo asociado si el pago ya tenía uno distinto', async () => {
    const client = mockClient([
      undefined, // BEGIN
      { rows: [{ id: 1, prestamo_id: 5, imagen_url: null, cuotas_aplicadas: null, monto: 100 }] },
      undefined, // ROLLBACK
    ]);
    getClient.mockResolvedValue(client);
    const req = { params: { id: '1' }, body: { prestamo_id: 9, monto: 100 } };
    const res = mockRes();
    await pagosController.update(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('no se puede cambiar') }));
  });

  it('actualiza los datos del pago y reemplaza la imagen si se sube una nueva', async () => {
    const client = mockClient([
      undefined, // BEGIN
      { rows: [{ id: 1, prestamo_id: null, imagen_url: '/uploads/old.jpg', imagen_nombre: 'old.jpg', cuotas_aplicadas: null, monto: 100 }] },
      { rows: [{ id: 1, monto: 150 }] }, // UPDATE pagos
      undefined, // COMMIT
    ]);
    getClient.mockResolvedValue(client);
    const req = {
      params: { id: '1' },
      body: { fecha_pago: '2024-01-01', monto: 150, metodo_pago: 'yape' },
      file: { filename: 'new.jpg', originalname: 'comprobante.jpg' },
    };
    const res = mockRes();
    await pagosController.update(req, res);

    expect(tryDeleteUpload).toHaveBeenCalledWith('/uploads/old.jpg');
    expect(res.json).toHaveBeenCalledWith({ id: 1, monto: 150 });
  });

  it('devuelve 400 si al asociar un préstamo el monto excede el saldo pendiente', async () => {
    const client = mockClient([
      undefined, // BEGIN
      { rows: [{ id: 1, prestamo_id: null, imagen_url: null, cuotas_aplicadas: null, monto: 100 }] },
      undefined, // SELECT ... FOR UPDATE
      { rows: [{ monto_original: 100, total_pagado: 90 }] }, // saldo=10
      undefined, // ROLLBACK
    ]);
    getClient.mockResolvedValue(client);
    const req = { params: { id: '1' }, body: { prestamo_id: 5, monto: 50 } };
    const res = mockRes();
    await pagosController.update(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('pagos.controller resumen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('combina resumen por deudor, por método, por mes y totales globales', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'Ana Lopez', total_pagado: '100' }] });
    query.mockResolvedValueOnce({ rows: [{ metodo_pago: 'efectivo', cantidad: '2', total: '100' }] });
    query.mockResolvedValueOnce({ rows: [{ mes: '2024-01', total: '100', pagos: '2' }] });
    query.mockResolvedValueOnce({ rows: [{ total_cobrado: '100', total_prestado: '200' }] });

    const req = {};
    const res = mockRes();
    await pagosController.resumen(req, res);

    expect(res.json).toHaveBeenCalledWith({
      porDeudor: [{ id: 1, nombre: 'Ana Lopez', total_pagado: '100' }],
      porMetodo: [{ metodo_pago: 'efectivo', cantidad: '2', total: '100' }],
      porMes: [{ mes: '2024-01', total: '100', pagos: '2' }],
      totales: { total_cobrado: '100', total_prestado: '200' },
    });
  });

  it('devuelve 500 si alguna consulta falla', async () => {
    query.mockRejectedValueOnce(new Error('boom'));
    const req = {};
    const res = mockRes();
    await pagosController.resumen(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('pagos.controller remove', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('devuelve 404 si el pago no existe', async () => {
    const client = mockClient([
      undefined, // BEGIN
      { rows: [] }, // SELECT pago -> no existe
      undefined, // ROLLBACK
    ]);
    getClient.mockResolvedValue(client);

    const req = { params: { id: '1' } };
    const res = mockRes();
    await pagosController.remove(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('revierte el abono de la cuota al eliminar el pago que lo generó', async () => {
    const pago = {
      id: 1,
      prestamo_id: 5,
      cuotas_aplicadas: [{ numero_cuota: 1, monto_aplicado: 100 }],
      imagen_url: null,
    };
    const cuota = { id: 42, monto_esperado: '100.00', monto_pagado: '100.00' };
    const client = mockClient([
      undefined, // BEGIN
      { rows: [pago] }, // SELECT pago
      { rows: [cuota] }, // SELECT cuota (revertirPagoDeCuotas)
      undefined, // UPDATE cuota -> vuelve a pendiente
      undefined, // DELETE pagos
      undefined, // COMMIT
    ]);
    getClient.mockResolvedValue(client);

    const req = { params: { id: '1' } };
    const res = mockRes();
    await pagosController.remove(req, res);

    expect(client.query).toHaveBeenCalledWith(
      'UPDATE cuotas SET monto_pagado = $1, estado = $2 WHERE id = $3',
      [0, 'pendiente', 42]
    );
    expect(res.json).toHaveBeenCalledWith({ message: 'Pago eliminado' });
    expect(tryDeleteUpload).not.toHaveBeenCalled();
  });

  it('deja la cuota en estado parcial si al revertir el pago queda un abono previo', async () => {
    const pago = {
      id: 2,
      prestamo_id: 5,
      cuotas_aplicadas: [{ numero_cuota: 1, monto_aplicado: 40 }],
      imagen_url: '/uploads/foo.jpg',
    };
    const cuota = { id: 42, monto_esperado: '100.00', monto_pagado: '100.00' };
    const client = mockClient([
      undefined, // BEGIN
      { rows: [pago] },
      { rows: [cuota] },
      undefined, // UPDATE cuota -> queda en 60/100 -> parcial
      undefined, // DELETE pagos
      undefined, // COMMIT
    ]);
    getClient.mockResolvedValue(client);

    const req = { params: { id: '2' } };
    const res = mockRes();
    await pagosController.remove(req, res);

    expect(client.query).toHaveBeenCalledWith(
      'UPDATE cuotas SET monto_pagado = $1, estado = $2 WHERE id = $3',
      [60, 'parcial', 42]
    );
    expect(tryDeleteUpload).toHaveBeenCalledWith('/uploads/foo.jpg');
  });
});
