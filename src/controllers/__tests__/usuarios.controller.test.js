jest.mock('../../config/db', () => ({ query: jest.fn() }));
jest.mock('../../config/logger', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn() }));

const { query } = require('../../config/db');
const bcrypt = require('bcryptjs');
const usuariosController = require('../usuarios.controller');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('usuarios.controller getAll', () => {
  beforeEach(() => jest.clearAllMocks());

  it('devuelve 403 si quien pide no es admin', async () => {
    const req = { user: { rol: 'usuario' } };
    const res = mockRes();
    await usuariosController.getAll(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('devuelve la lista de usuarios para un admin', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'Ana', activo: true }] });
    const req = { user: { rol: 'admin' } };
    const res = mockRes();
    await usuariosController.getAll(req, res);
    expect(res.json).toHaveBeenCalledWith([{ id: 1, nombre: 'Ana', activo: true }]);
  });

  it('si la columna activo no existe (42703), reintenta sin ella y la agrega en true por compatibilidad', async () => {
    const err = new Error('no existe la columna'); err.code = '42703';
    query.mockRejectedValueOnce(err);
    query.mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'Ana' }] });
    const req = { user: { rol: 'admin' } };
    const res = mockRes();
    await usuariosController.getAll(req, res);
    expect(res.json).toHaveBeenCalledWith([{ id: 1, nombre: 'Ana', activo: true }]);
  });
});

describe('usuarios.controller create', () => {
  beforeEach(() => jest.clearAllMocks());

  it('devuelve 403 si quien crea no es admin', async () => {
    const req = { user: { rol: 'usuario' }, body: {} };
    const res = mockRes();
    await usuariosController.create(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('devuelve 400 si faltan campos requeridos', async () => {
    const req = { user: { rol: 'admin' }, body: { nombre: 'Ana' } };
    const res = mockRes();
    await usuariosController.create(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('devuelve 400 si el email ya está registrado', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    const req = { user: { rol: 'admin' }, body: { nombre: 'Ana', email: 'a@a.com', password: '123456' } };
    const res = mockRes();
    await usuariosController.create(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('ya está registrado') }));
  });

  it('crea el usuario con rol "usuario" por defecto si no se especifica (mínimo privilegio)', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // no existe el email
    bcrypt.hash.mockResolvedValueOnce('hashed');
    query.mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'Ana', email: 'a@a.com', rol: 'usuario' }] });

    const req = { user: { rol: 'admin' }, body: { nombre: 'Ana', email: 'a@a.com', password: '123456' } };
    const res = mockRes();
    await usuariosController.create(req, res);

    expect(query).toHaveBeenLastCalledWith(expect.any(String), ['Ana', 'a@a.com', 'hashed', 'usuario']);
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('usuarios.controller update', () => {
  beforeEach(() => jest.clearAllMocks());

  it('devuelve 403 si quien actualiza no es admin', async () => {
    const req = { user: { rol: 'usuario' }, params: { id: '1' }, body: {} };
    const res = mockRes();
    await usuariosController.update(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('devuelve 404 si el usuario no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { user: { rol: 'admin' }, params: { id: '999' }, body: { nombre: 'X', email: 'x@x.com' } };
    const res = mockRes();
    await usuariosController.update(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('actualiza nombre/email/rol/activo', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'X', email: 'x@x.com', rol: 'admin', activo: false }] });
    const req = { user: { rol: 'admin' }, params: { id: '1' }, body: { nombre: 'X', email: 'x@x.com', rol: 'admin', activo: false } };
    const res = mockRes();
    await usuariosController.update(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ activo: false }));
  });
});

describe('usuarios.controller changePassword', () => {
  beforeEach(() => jest.clearAllMocks());

  it('devuelve 403 si intenta cambiar la contraseña de otro usuario sin ser admin', async () => {
    const req = { user: { id: 2, rol: 'usuario' }, params: { id: '1' }, body: { password_nuevo: '123456' } };
    const res = mockRes();
    await usuariosController.changePassword(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('devuelve 400 si la nueva contraseña tiene menos de 6 caracteres', async () => {
    const req = { user: { id: 1, rol: 'usuario' }, params: { id: '1' }, body: { password_nuevo: '123' } };
    const res = mockRes();
    await usuariosController.changePassword(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('devuelve 400 si la contraseña actual no coincide (usuario no admin)', async () => {
    query.mockResolvedValueOnce({ rows: [{ password: 'hash' }] });
    bcrypt.compare.mockResolvedValueOnce(false);
    const req = { user: { id: 1, rol: 'usuario' }, params: { id: '1' }, body: { password_actual: 'mal', password_nuevo: '123456' } };
    const res = mockRes();
    await usuariosController.changePassword(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('incorrecta') }));
  });

  it('un admin puede cambiar la contraseña de cualquiera sin validar la actual', async () => {
    query.mockResolvedValueOnce({ rows: [{ password: 'hash' }] }); // SELECT
    query.mockResolvedValueOnce({}); // UPDATE
    bcrypt.hash.mockResolvedValueOnce('newhash');

    const req = { user: { id: 99, rol: 'admin' }, params: { id: '1' }, body: { password_nuevo: '123456' } };
    const res = mockRes();
    await usuariosController.changePassword(req, res);

    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ message: 'Contraseña actualizada' });
  });

  it('devuelve 404 si el usuario no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { user: { id: 1, rol: 'admin' }, params: { id: '999' }, body: { password_nuevo: '123456' } };
    const res = mockRes();
    await usuariosController.changePassword(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
