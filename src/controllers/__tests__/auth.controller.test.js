process.env.JWT_SECRET = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

jest.mock('../../config/db', () => ({ query: jest.fn() }));
jest.mock('../../config/logger', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('bcryptjs', () => ({ compare: jest.fn(), hash: jest.fn() }));
jest.mock('jsonwebtoken', () => ({ sign: jest.fn(), verify: jest.fn() }));
jest.mock('../../services/email.service', () => ({ sendEmail: jest.fn() }));

const { query } = require('../../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendEmail } = require('../../services/email.service');
const authController = require('../auth.controller');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.cookie = jest.fn().mockReturnValue(res);
  res.clearCookie = jest.fn().mockReturnValue(res);
  res.end = jest.fn().mockReturnValue(res);
  return res;
}

describe('auth.controller login', () => {
  beforeEach(() => jest.clearAllMocks());

  it('devuelve 400 si faltan email o password', async () => {
    const req = { body: {} };
    const res = mockRes();
    await authController.login(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('devuelve 401 si el email no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { body: { email: 'a@a.com', password: 'x' } };
    const res = mockRes();
    await authController.login(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('devuelve 401 si la contraseña no coincide', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, password: 'hash', activo: true }] });
    bcrypt.compare.mockResolvedValueOnce(false);
    const req = { body: { email: 'a@a.com', password: 'wrong' } };
    const res = mockRes();
    await authController.login(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('devuelve 403 si la cuenta está desactivada (sin revelar esto antes de validar el password)', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, password: 'hash', activo: false }] });
    bcrypt.compare.mockResolvedValueOnce(true);
    const req = { body: { email: 'a@a.com', password: 'good' } };
    const res = mockRes();
    await authController.login(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'USER_INACTIVE' }));
  });

  it('login exitoso: firma tokens, setea cookie httpOnly y devuelve el usuario sin password', async () => {
    const user = { id: 1, nombre: 'Ana', email: 'a@a.com', rol: 'admin', password: 'hash', activo: true };
    query.mockResolvedValueOnce({ rows: [user] });
    bcrypt.compare.mockResolvedValueOnce(true);
    jwt.sign.mockReturnValueOnce('access-token').mockReturnValueOnce('refresh-token');

    const req = { body: { email: 'a@a.com', password: 'good' } };
    const res = mockRes();
    await authController.login(req, res);

    expect(res.cookie).toHaveBeenCalledWith(
      'refreshToken', 'refresh-token', expect.objectContaining({ httpOnly: true })
    );
    expect(res.json).toHaveBeenCalledWith({
      token: 'access-token',
      user: { id: 1, nombre: 'Ana', email: 'a@a.com', rol: 'admin' },
    });
  });

  it('devuelve 500 si la base de datos falla', async () => {
    query.mockRejectedValueOnce(new Error('db down'));
    const req = { body: { email: 'a@a.com', password: 'x' } };
    const res = mockRes();
    await authController.login(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('auth.controller refresh', () => {
  beforeEach(() => jest.clearAllMocks());

  it('devuelve 401 si no hay cookie de refresh token', async () => {
    const req = { cookies: {} };
    const res = mockRes();
    await authController.refresh(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'REFRESH_TOKEN_MISSING' }));
  });

  it('limpia la cookie y responde 401 si el usuario ya no existe o está inactivo', async () => {
    jwt.verify.mockReturnValueOnce({ id: 1 });
    query.mockResolvedValueOnce({ rows: [] });
    const req = { cookies: { refreshToken: 'rt' } };
    const res = mockRes();
    await authController.refresh(req, res);
    expect(res.clearCookie).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'REFRESH_TOKEN_INVALID' }));
  });

  it('emite un nuevo access token si el refresh token es válido', async () => {
    jwt.verify.mockReturnValueOnce({ id: 1 });
    query.mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'Ana', email: 'a@a.com', rol: 'admin', activo: true }] });
    jwt.sign.mockReturnValueOnce('new-access').mockReturnValueOnce('new-refresh');

    const req = { cookies: { refreshToken: 'rt' } };
    const res = mockRes();
    await authController.refresh(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ token: 'new-access' }));
  });

  it('distingue token expirado de token inválido en la respuesta', async () => {
    const err = new Error('expired');
    err.name = 'TokenExpiredError';
    jwt.verify.mockImplementationOnce(() => { throw err; });

    const req = { cookies: { refreshToken: 'rt' } };
    const res = mockRes();
    await authController.refresh(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'REFRESH_TOKEN_EXPIRED' }));
  });
});

describe('auth.controller logout / me', () => {
  beforeEach(() => jest.clearAllMocks());

  it('logout limpia la cookie y responde 204', async () => {
    const req = {};
    const res = mockRes();
    await authController.logout(req, res);
    expect(res.clearCookie).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('me devuelve 404 si el usuario del token ya no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { user: { id: 1 } };
    const res = mockRes();
    await authController.me(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('me devuelve los datos del usuario autenticado', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'Ana' }] });
    const req = { user: { id: 1 } };
    const res = mockRes();
    await authController.me(req, res);
    expect(res.json).toHaveBeenCalledWith({ id: 1, nombre: 'Ana' });
  });
});

describe('auth.controller forgotPassword', () => {
  beforeEach(() => jest.clearAllMocks());

  it('responde el mensaje genérico aunque el email no exista (no revela si la cuenta existe)', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { body: { email: 'nadie@x.com' } };
    const res = mockRes();
    await authController.forgotPassword(req, res);
    expect(res.status).not.toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: expect.stringContaining('Si el email está registrado') });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('responde el mismo mensaje genérico si el email sí existe, y guarda el hash del token (no el token en claro)', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'Ana', email: 'ana@x.com', activo: true }] });
    query.mockResolvedValueOnce({}); // UPDATE reset_token_hash
    sendEmail.mockResolvedValueOnce({ ok: true });

    const req = { body: { email: 'ana@x.com' } };
    const res = mockRes();
    await authController.forgotPassword(req, res);

    expect(res.json).toHaveBeenCalledWith({ message: expect.stringContaining('Si el email está registrado') });
    const [sql, params] = query.mock.calls[1];
    expect(sql).toContain('reset_token_hash');
    const tokenHashStored = params[0];
    expect(tokenHashStored).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex, no el token plano
    expect(sendEmail).toHaveBeenCalledWith('ana@x.com', expect.any(String), expect.stringContaining('reset-password?token='));
  });

  it('no envía email ni genera token si la cuenta está desactivada', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'Ana', email: 'ana@x.com', activo: false }] });
    const req = { body: { email: 'ana@x.com' } };
    const res = mockRes();
    await authController.forgotPassword(req, res);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1); // solo el SELECT, sin UPDATE
  });

  it('responde el mensaje genérico incluso si la base de datos falla (no filtra errores internos)', async () => {
    query.mockRejectedValueOnce(new Error('db down'));
    const req = { body: { email: 'ana@x.com' } };
    const res = mockRes();
    await authController.forgotPassword(req, res);
    expect(res.json).toHaveBeenCalledWith({ message: expect.stringContaining('Si el email está registrado') });
  });
});

describe('auth.controller resetPassword', () => {
  beforeEach(() => jest.clearAllMocks());

  it('devuelve 400 si el token es inválido o expiró', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { body: { token: 'abc', password_nuevo: '123456' } };
    const res = mockRes();
    await authController.resetPassword(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'RESET_TOKEN_INVALID' }));
  });

  it('actualiza la contraseña y limpia el token (de un solo uso) con un token válido', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // token válido
    bcrypt.hash.mockResolvedValueOnce('nuevo-hash');
    query.mockResolvedValueOnce({}); // UPDATE

    const req = { body: { token: 'token-valido', password_nuevo: '123456' } };
    const res = mockRes();
    await authController.resetPassword(req, res);

    const [sql, params] = query.mock.calls[1];
    expect(sql).toContain('reset_token_hash = NULL');
    expect(params).toEqual(['nuevo-hash', 1]);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('actualizada') }));
  });

  it('devuelve 500 si la base de datos falla', async () => {
    query.mockRejectedValueOnce(new Error('db down'));
    const req = { body: { token: 'x', password_nuevo: '123456' } };
    const res = mockRes();
    await authController.resetPassword(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
