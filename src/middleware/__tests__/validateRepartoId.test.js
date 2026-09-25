jest.mock('../../config/db', () => ({ query: jest.fn() }));
jest.mock('../../config/logger', () => ({ error: jest.fn() }));

const { query } = require('../../config/db');
const { validateRepartoId } = require('../validateRepartoId');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('middleware/validateRepartoId', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deja pasar sin consultar la DB si no se envía reparto_id', async () => {
    const req = { query: {}, body: {} };
    const res = mockRes();
    const next = jest.fn();
    await validateRepartoId(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('devuelve 400 si reparto_id no es un entero válido', async () => {
    const req = { query: { reparto_id: 'abc' }, body: {} };
    const res = mockRes();
    const next = jest.fn();
    await validateRepartoId(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('devuelve 400 si reparto_id es menor a 1', async () => {
    const req = { query: { reparto_id: '0' }, body: {} };
    const res = mockRes();
    const next = jest.fn();
    await validateRepartoId(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('devuelve 404 si el reparto no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { query: { reparto_id: '5' }, body: {} };
    const res = mockRes();
    const next = jest.fn();
    await validateRepartoId(req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('llama a next() si el reparto existe', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    const req = { query: { reparto_id: '5' }, body: {} };
    const res = mockRes();
    const next = jest.fn();
    await validateRepartoId(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('lee reparto_id del body si no viene en query', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 2 }] });
    const req = { query: {}, body: { reparto_id: 2 } };
    const res = mockRes();
    const next = jest.fn();
    await validateRepartoId(req, res, next);
    expect(query).toHaveBeenCalledWith(expect.any(String), [2]);
    expect(next).toHaveBeenCalled();
  });

  it('devuelve 500 si la consulta falla', async () => {
    query.mockRejectedValueOnce(new Error('boom'));
    const req = { query: { reparto_id: '5' }, body: {} };
    const res = mockRes();
    const next = jest.fn();
    await validateRepartoId(req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
