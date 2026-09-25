jest.mock('../../config/db', () => ({ query: jest.fn() }));
jest.mock('../../config/logger', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { query } = require('../../config/db');
const deudoresController = require('../deudores.controller');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('deudores.controller getAll', () => {
  beforeEach(() => jest.clearAllMocks());

  it('pagina resultados respetando el límite máximo de 200', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ total: '0' }] });

    const req = { query: { page: '1', limit: '9999' } };
    const res = mockRes();
    await deudoresController.getAll(req, res);

    expect(query).toHaveBeenNthCalledWith(1, expect.any(String), [200, 0]);
    expect(res.json).toHaveBeenCalledWith({ data: [], total: 0, page: 1, limit: 200 });
  });

  it('calcula el offset a partir de la página', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ total: '30' }] });

    const req = { query: { page: '3', limit: '10' } };
    const res = mockRes();
    await deudoresController.getAll(req, res);

    expect(query).toHaveBeenNthCalledWith(1, expect.any(String), [10, 20]);
  });

  it('devuelve 500 si la consulta falla', async () => {
    query.mockRejectedValueOnce(new Error('boom'));
    const req = { query: {} };
    const res = mockRes();
    await deudoresController.getAll(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('deudores.controller getById', () => {
  beforeEach(() => jest.clearAllMocks());

  it('devuelve 404 si el deudor no existe o está inactivo', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { params: { id: '999' } };
    const res = mockRes();
    await deudoresController.getById(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('agrega los totales de préstamos/pagos/saldo al detalle del deudor', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'Ana' }] }); // deudor
    query.mockResolvedValueOnce({ rows: [{ id: 10, monto_original: '500', saldo_pendiente: '200' }] }); // prestamos
    query.mockResolvedValueOnce({ rows: [{ id: 100, monto: '300' }] }); // pagos
    query.mockResolvedValueOnce({ rows: [{ total_pagado: '300', total_pagos: '1' }] }); // resumen

    const req = { params: { id: '1' } };
    const res = mockRes();
    await deudoresController.getById(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      id: 1, nombre: 'Ana',
      total_prestado: 500,
      total_pagado: 300,
      saldo_pendiente: 200,
    }));
  });
});

describe('deudores.controller create', () => {
  beforeEach(() => jest.clearAllMocks());

  it('devuelve 400 si faltan nombre o apellidos', async () => {
    const req = { body: { nombre: 'Ana' } };
    const res = mockRes();
    await deudoresController.create(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('bloquea (400) si el DNI ya está en uso por otro deudor activo', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 5, nombre: 'Otra', apellidos: 'Persona' }] });
    const req = { body: { nombre: 'Ana', apellidos: 'Lopez', dni: '12345678' } };
    const res = mockRes();
    await deudoresController.create(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('DNI') }));
  });

  it('solo advierte (409) si nombre+apellidos coinciden, sin bloquear la creación', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 5, nombre: 'Ana', apellidos: 'Lopez' }] }); // nombreDup
    const req = { body: { nombre: 'Ana', apellidos: 'Lopez' } };
    const res = mockRes();
    await deudoresController.create(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ duplicado: true }));
  });

  it('con force=true, crea el deudor aunque el nombre coincida con otro existente', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'Ana', apellidos: 'Lopez' }] }); // INSERT
    const req = { body: { nombre: 'Ana', apellidos: 'Lopez', force: true } };
    const res = mockRes();
    await deudoresController.create(req, res);
    // Solo debe haber una llamada a query (el INSERT); no se consultó duplicado de nombre
    expect(query).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('deudores.controller update', () => {
  beforeEach(() => jest.clearAllMocks());

  it('devuelve 400 si no se envía ningún campo', async () => {
    const req = { params: { id: '1' }, body: {} };
    const res = mockRes();
    await deudoresController.update(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('devuelve 404 si el deudor no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { params: { id: '999' }, body: { nombre: 'X' } };
    const res = mockRes();
    await deudoresController.update(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('convierte monto_compromiso_pago a número y normaliza vacíos a null', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const req = { params: { id: '1' }, body: { monto_compromiso_pago: '150.5', telefono: '' } };
    const res = mockRes();
    await deudoresController.update(req, res);
    const [, values] = query.mock.calls[0];
    expect(values).toEqual([null, 150.5, '1']);
  });
});

describe('deudores.controller remove', () => {
  beforeEach(() => jest.clearAllMocks());

  it('desactiva (soft delete) al deudor', async () => {
    query.mockResolvedValueOnce({});
    const req = { params: { id: '1' } };
    const res = mockRes();
    await deudoresController.remove(req, res);
    expect(query).toHaveBeenCalledWith('UPDATE deudores SET activo = false WHERE id = $1', ['1']);
    expect(res.json).toHaveBeenCalledWith({ message: 'Deudor desactivado' });
  });
});
