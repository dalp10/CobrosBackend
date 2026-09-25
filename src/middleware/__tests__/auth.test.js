process.env.JWT_SECRET = 'test-secret';
const jwt = require('jsonwebtoken');
const authMiddleware = require('../auth');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('middleware/auth', () => {
  it('devuelve 401 TOKEN_MISSING si no hay header Authorization', () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = jest.fn();
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_MISSING' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('devuelve 401 TOKEN_INVALID con un token mal formado', () => {
    const req = { headers: { authorization: 'Bearer basura' } };
    const res = mockRes();
    const next = jest.fn();
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_INVALID' }));
  });

  it('devuelve 401 TOKEN_EXPIRED con un token expirado', () => {
    const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET, { expiresIn: -10 });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    const next = jest.fn();
    authMiddleware(req, res, next);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_EXPIRED' }));
  });

  it('adjunta el usuario decodificado a req.user y llama next() con un token válido', () => {
    const token = jwt.sign({ id: 1, rol: 'admin' }, process.env.JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    const next = jest.fn();
    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toMatchObject({ id: 1, rol: 'admin' });
  });
});
