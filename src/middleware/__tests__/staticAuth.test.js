process.env.JWT_SECRET = 'test-secret';
const jwt = require('jsonwebtoken');
const staticAuth = require('../staticAuth');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('middleware/staticAuth', () => {
  it('devuelve 401 si no hay token ni en header ni en query', () => {
    const req = { headers: {}, query: {} };
    const res = mockRes();
    const next = jest.fn();
    staticAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('acepta el token por query string (?token=...) para <img>/<a> que no mandan header', () => {
    const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET);
    const req = { headers: {}, query: { token } };
    const res = mockRes();
    const next = jest.fn();
    staticAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('prioriza el header Authorization sobre el query token si ambos están presentes', () => {
    const validToken = jwt.sign({ id: 1 }, process.env.JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${validToken}` }, query: { token: 'invalido' } };
    const res = mockRes();
    const next = jest.fn();
    staticAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('devuelve 401 con un token inválido o expirado', () => {
    const req = { headers: {}, query: { token: 'no-es-un-jwt' } };
    const res = mockRes();
    const next = jest.fn();
    staticAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
