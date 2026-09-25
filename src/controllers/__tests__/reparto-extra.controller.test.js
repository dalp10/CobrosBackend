jest.mock('../../config/db', () => ({ query: jest.fn() }));
jest.mock('../../config/logger', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  unlinkSync: jest.fn(),
  mkdirSync: jest.fn(),
  renameSync: jest.fn(),
}));

const { query } = require('../../config/db');
const fs = require('fs');
const repartoExtra = require('../reparto-extra.controller');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('reparto-extra.controller categorías', () => {
  beforeEach(() => jest.clearAllMocks());

  it('getCategorias usa reparto_id=1 por defecto', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { query: {} };
    const res = mockRes();
    await repartoExtra.getCategorias(req, res);
    expect(query).toHaveBeenCalledWith(expect.any(String), [1]);
  });

  it('createCategoria devuelve 400 si el nombre está vacío', async () => {
    const req = { body: { nombre: '   ' } };
    const res = mockRes();
    await repartoExtra.createCategoria(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('createCategoria devuelve 400 si el color no es un hex válido', async () => {
    const req = { body: { nombre: 'Agua', color: 'rojo' } };
    const res = mockRes();
    await repartoExtra.createCategoria(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('createCategoria devuelve 400 si ya existe una categoría con ese nombre en el reparto', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // existente
    const req = { body: { nombre: 'Agua' } };
    const res = mockRes();
    await repartoExtra.createCategoria(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('createCategoria usa el color gris por defecto si no se especifica', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // sin duplicado
    query.mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'Agua', color: '#6b7280' }] }); // INSERT
    const req = { body: { nombre: 'Agua' } };
    const res = mockRes();
    await repartoExtra.createCategoria(req, res);
    expect(query).toHaveBeenLastCalledWith(expect.any(String), ['Agua', '#6b7280', 1]);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('deleteCategoria devuelve 404 si no existe', async () => {
    query.mockResolvedValueOnce({ rowCount: 0 });
    const req = { params: { id: '999' } };
    const res = mockRes();
    await repartoExtra.deleteCategoria(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('reparto-extra.controller presupuestos', () => {
  beforeEach(() => jest.clearAllMocks());

  it('createPresupuesto devuelve 400 si faltan campos', async () => {
    const req = { body: {} };
    const res = mockRes();
    await repartoExtra.createPresupuesto(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('createPresupuesto valida rango de mes (1-12)', async () => {
    const req = { body: { anno: 2024, mes: 13, monto_techo: 100 } };
    const res = mockRes();
    await repartoExtra.createPresupuesto(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('createPresupuesto valida rango de año (2020-2035)', async () => {
    const req = { body: { anno: 2050, mes: 1, monto_techo: 100 } };
    const res = mockRes();
    await repartoExtra.createPresupuesto(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('createPresupuesto valida monto_techo >= 0', async () => {
    const req = { body: { anno: 2024, mes: 1, monto_techo: -5 } };
    const res = mockRes();
    await repartoExtra.createPresupuesto(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('createPresupuesto actualiza (200) si ya existe uno para ese año/mes en vez de duplicar', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 5 }] }); // existing
    query.mockResolvedValueOnce({}); // UPDATE
    query.mockResolvedValueOnce({ rows: [{ id: 5, anno: 2024, mes: 1, monto_techo: 200 }] }); // SELECT final
    const req = { body: { anno: 2024, mes: 1, monto_techo: 200 } };
    const res = mockRes();
    await repartoExtra.createPresupuesto(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('createPresupuesto crea uno nuevo (201) si no existía', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // no existente
    query.mockResolvedValueOnce({ rows: [{ id: 1, anno: 2024, mes: 1, monto_techo: 100 }] }); // INSERT
    const req = { body: { anno: 2024, mes: 1, monto_techo: 100 } };
    const res = mockRes();
    await repartoExtra.createPresupuesto(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('updatePresupuesto devuelve 404 si no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { params: { id: '999' }, body: { monto_techo: 100 } };
    const res = mockRes();
    await repartoExtra.updatePresupuesto(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('deletePresupuesto devuelve 404 si no existe', async () => {
    query.mockResolvedValueOnce({ rowCount: 0 });
    const req = { params: { id: '999' } };
    const res = mockRes();
    await repartoExtra.deletePresupuesto(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('reparto-extra.controller grupos', () => {
  beforeEach(() => jest.clearAllMocks());

  it('createGrupo devuelve 400 si el nombre está vacío', async () => {
    const req = { body: { nombre: '' } };
    const res = mockRes();
    await repartoExtra.createGrupo(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('createGrupo crea el grupo con el nombre recortado', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'Casa' }] });
    const req = { body: { nombre: '  Casa  ' } };
    const res = mockRes();
    await repartoExtra.createGrupo(req, res);
    expect(query).toHaveBeenCalledWith(expect.any(String), ['Casa']);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('getGrupos lista los grupos', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'Casa' }] });
    const req = {};
    const res = mockRes();
    await repartoExtra.getGrupos(req, res);
    expect(res.json).toHaveBeenCalledWith([{ id: 1, nombre: 'Casa' }]);
  });
});

describe('reparto-extra.controller getPendientes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('devuelve listas vacías cuando no hay miembros en el reparto', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // getResumenData: miembros -> N=0, corta temprano
    const req = { query: {} };
    const res = mockRes();
    await repartoExtra.getPendientes(req, res);
    expect(res.json).toHaveBeenCalledWith({ miembros_que_deben: [], gastos_sin_reembolso: [] });
  });
});

describe('reparto-extra.controller repetirGastoMes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('devuelve 404 si el gasto original no existe o está anulado', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { params: { id: '999' } };
    const res = mockRes();
    await repartoExtra.repetirGastoMes(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('copia el gasto al mes siguiente junto con sus participantes y cargos', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, concepto: 'Luz', monto_total: 100, pagado_por_id: 1, notas: null, categoria_id: null, reparto_id: 1 }] }); // gasto original
    query.mockResolvedValueOnce({ rows: [{ id: 2, concepto: 'Luz', monto_total: 100 }] }); // INSERT nuevo gasto
    query.mockResolvedValueOnce({ rows: [{ miembro_id: 1, peso: 1 }] }); // SELECT participantes
    query.mockResolvedValueOnce({}); // INSERT participante copiado
    query.mockResolvedValueOnce({ rows: [] }); // SELECT cargos (ninguno)

    const req = { params: { id: '1' } };
    const res = mockRes();
    await repartoExtra.repetirGastoMes(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('reparto-extra.controller adjuntos', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uploadAdjunto devuelve 400 si no se envía archivo', async () => {
    const req = { params: { id: '1' }, file: null };
    const res = mockRes();
    await repartoExtra.uploadAdjunto(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('uploadAdjunto devuelve 404 y borra el archivo temporal si el gasto no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    fs.existsSync.mockReturnValue(true);
    const req = { params: { id: '999' }, file: { path: '/tmp/x.jpg', size: 100, mimetype: 'image/jpeg' } };
    const res = mockRes();
    await repartoExtra.uploadAdjunto(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/x.jpg');
  });

  it('uploadAdjunto rechaza archivos de más de 10MB', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    fs.existsSync.mockReturnValue(true);
    const req = { params: { id: '1' }, file: { path: '/tmp/x.jpg', size: 11 * 1024 * 1024, mimetype: 'image/jpeg' } };
    const res = mockRes();
    await repartoExtra.uploadAdjunto(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('uploadAdjunto rechaza tipos de archivo no permitidos', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    fs.existsSync.mockReturnValue(true);
    const req = { params: { id: '1' }, file: { path: '/tmp/x.exe', size: 100, mimetype: 'application/x-msdownload' } };
    const res = mockRes();
    await repartoExtra.uploadAdjunto(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('getAdjuntos devuelve 404 si el gasto no existe o está anulado', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { params: { id: '999' } };
    const res = mockRes();
    await repartoExtra.getAdjuntos(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('deleteAdjunto devuelve 404 si no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { params: { id: '999' } };
    const res = mockRes();
    await repartoExtra.deleteAdjunto(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('descargarAdjunto devuelve 404 si el archivo no existe en el servidor', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, nombre_archivo: 'x.jpg', ruta: 'reparto/1/x.jpg', content_type: 'image/jpeg' }] });
    fs.existsSync.mockReturnValue(false);
    const req = { params: { id: '1' } };
    const res = mockRes();
    await repartoExtra.descargarAdjunto(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('descargarAdjunto envía el archivo si existe', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, nombre_archivo: 'x.jpg', ruta: 'reparto/1/x.jpg', content_type: 'image/jpeg' }] });
    fs.existsSync.mockReturnValue(true);
    const req = { params: { id: '1' } };
    const res = { setHeader: jest.fn(), sendFile: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
    await repartoExtra.descargarAdjunto(req, res);
    expect(res.sendFile).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
  });

  it('descargarAdjunto devuelve 404 si el adjunto no existe en la base de datos', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { params: { id: '999' } };
    const res = mockRes();
    await repartoExtra.descargarAdjunto(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('uploadAdjunto guarda el archivo y crea el registro en la base de datos', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // gasto existe
    query.mockResolvedValueOnce({ rows: [{ id: 5, gasto_id: 1, nombre_archivo: 'comprobante.jpg', content_type: 'image/jpeg' }] }); // INSERT
    fs.existsSync.mockReturnValue(false); // el directorio destino no existe -> se crea
    const req = {
      params: { id: '1' },
      file: { path: '/tmp/upload123', size: 1000, mimetype: 'image/jpeg', originalname: 'comprobante.jpg' },
    };
    const res = mockRes();
    await repartoExtra.uploadAdjunto(req, res);
    expect(fs.mkdirSync).toHaveBeenCalled();
    expect(fs.renameSync).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('deleteAdjunto borra el archivo físico y el registro', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 5, ruta: 'reparto/1/x.jpg' }] });
    fs.existsSync.mockReturnValue(true);
    const req = { params: { id: '5' } };
    const res = mockRes();
    await repartoExtra.deleteAdjunto(req, res);
    expect(fs.unlinkSync).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ message: 'Adjunto eliminado' });
  });
});

describe('reparto-extra.controller adjuntos de reembolsos', () => {
  beforeEach(() => jest.clearAllMocks());

  it('getAdjuntosReembolso devuelve 404 si el reembolso no existe o está anulado', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { params: { id: '999' } };
    const res = mockRes();
    await repartoExtra.getAdjuntosReembolso(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('getAdjuntosReembolso lista los adjuntos del reembolso', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // reembolso existe
    query.mockResolvedValueOnce({ rows: [{ id: 10, nombre_archivo: 'x.jpg' }] });
    const req = { params: { id: '1' } };
    const res = mockRes();
    await repartoExtra.getAdjuntosReembolso(req, res);
    expect(res.json).toHaveBeenCalledWith([{ id: 10, nombre_archivo: 'x.jpg' }]);
  });

  it('uploadAdjuntoReembolso devuelve 400 si no se envía archivo', async () => {
    const req = { params: { id: '1' }, file: null };
    const res = mockRes();
    await repartoExtra.uploadAdjuntoReembolso(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('uploadAdjuntoReembolso guarda el archivo si el reembolso existe', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    query.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    fs.existsSync.mockReturnValue(true);
    const req = {
      params: { id: '1' },
      file: { path: '/tmp/upload123', size: 1000, mimetype: 'application/pdf', originalname: 'comprobante.pdf' },
    };
    const res = mockRes();
    await repartoExtra.uploadAdjuntoReembolso(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('deleteAdjuntoReembolso devuelve 404 si no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { params: { id: '999' } };
    const res = mockRes();
    await repartoExtra.deleteAdjuntoReembolso(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('descargarAdjuntoReembolso devuelve 404 si el archivo no existe en el servidor', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, nombre_archivo: 'x.pdf', ruta: 'reparto/reembolsos/1/x.pdf', content_type: 'application/pdf' }] });
    fs.existsSync.mockReturnValue(false);
    const req = { params: { id: '1' } };
    const res = mockRes();
    await repartoExtra.descargarAdjuntoReembolso(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('reparto-extra.controller exportarReporteExcel', () => {
  beforeEach(() => jest.clearAllMocks());

  it('genera un archivo xlsx con el resumen del reparto', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // getResumenData: miembros -> N=0, corta temprano
    const req = { query: {} };
    const res = { setHeader: jest.fn(), send: jest.fn() };
    await repartoExtra.exportarReporteExcel(req, res);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', expect.stringContaining('spreadsheetml'));
    expect(res.send).toHaveBeenCalled();
    const buffer = res.send.mock.calls[0][0];
    expect(Buffer.isBuffer(buffer)).toBe(true);
  });

  it('devuelve 500 si falla la obtención de datos', async () => {
    query.mockRejectedValueOnce(new Error('boom'));
    const req = { query: {} };
    const res = mockRes();
    await repartoExtra.exportarReporteExcel(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
