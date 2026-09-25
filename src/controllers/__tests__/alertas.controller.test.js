jest.mock('../../config/db', () => ({ query: jest.fn() }));
jest.mock('../../config/logger', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../../services/whatsapp.service', () => ({ sendWhatsApp: jest.fn() }));

const { query } = require('../../config/db');
const { sendWhatsApp } = require('../../services/whatsapp.service');
const alertasController = require('../alertas.controller');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('alertas.controller enviarWhatsApp', () => {
  beforeEach(() => jest.clearAllMocks());

  it('devuelve 400 si se indican telefono y deudor_id a la vez', async () => {
    const req = { body: { telefono: '999', deudor_id: 1, mensaje: 'hola' } };
    const res = mockRes();
    await alertasController.enviarWhatsApp(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('devuelve 404 si el deudor no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { body: { deudor_id: 1, mensaje: 'hola' } };
    const res = mockRes();
    await alertasController.enviarWhatsApp(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('devuelve 400 si el deudor no tiene teléfono registrado', async () => {
    query.mockResolvedValueOnce({ rows: [{ telefono: null }] });
    const req = { body: { deudor_id: 1, mensaje: 'hola' } };
    const res = mockRes();
    await alertasController.enviarWhatsApp(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('devuelve 400 si no se indica telefono ni deudor_id', async () => {
    const req = { body: { mensaje: 'hola' } };
    const res = mockRes();
    await alertasController.enviarWhatsApp(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('antepone el título de recordatorio al mensaje si no lo trae ya', async () => {
    sendWhatsApp.mockResolvedValueOnce({ ok: true, sid: 'SM123' });
    const req = { body: { telefono: '999888777', mensaje: 'Pague pronto' } };
    const res = mockRes();
    await alertasController.enviarWhatsApp(req, res);
    expect(sendWhatsApp).toHaveBeenCalledWith('999888777', expect.stringContaining('Pague pronto'));
    expect(sendWhatsApp.mock.calls[0][1]).toMatch(/^📋 \*Recordatorio de cobro\*/);
    expect(res.json).toHaveBeenCalledWith({ ok: true, sid: 'SM123', mensaje: 'Mensaje enviado' });
  });

  it('devuelve 503 si WhatsApp no está configurado', async () => {
    sendWhatsApp.mockResolvedValueOnce({ ok: false, code: 'NOT_CONFIGURED', error: 'WhatsApp no configurado.' });
    const req = { body: { telefono: '999888777', mensaje: 'hola' } };
    const res = mockRes();
    await alertasController.enviarWhatsApp(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('devuelve 400 en error de cliente de Twilio (número inválido, código 21211)', async () => {
    sendWhatsApp.mockResolvedValueOnce({ ok: false, code: 21211, error: 'Número inválido' });
    const req = { body: { telefono: 'abc', mensaje: 'hola' } };
    const res = mockRes();
    await alertasController.enviarWhatsApp(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('devuelve 502 para otros errores de Twilio no clasificados', async () => {
    sendWhatsApp.mockResolvedValueOnce({ ok: false, code: 'ETIMEDOUT', error: 'timeout' });
    const req = { body: { telefono: '999888777', mensaje: 'hola' } };
    const res = mockRes();
    await alertasController.enviarWhatsApp(req, res);
    expect(res.status).toHaveBeenCalledWith(502);
  });
});

describe('alertas.controller getMora', () => {
  beforeEach(() => jest.clearAllMocks());

  it('agrupa las cuotas vencidas por deudor y suma el total en mora', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { deudor_id: 1, nombre: 'Ana', apellidos: 'Lopez', telefono: '999', cuota_id: 10, prestamo_id: 5, numero_cuota: 1, fecha_vencimiento: '2024-01-01', monto_esperado: '100.00', monto_pagado: '40.00', prestamo_desc: 'Préstamo', dias_vencido: 20 },
        { deudor_id: 1, nombre: 'Ana', apellidos: 'Lopez', telefono: '999', cuota_id: 11, prestamo_id: 5, numero_cuota: 2, fecha_vencimiento: '2024-02-01', monto_esperado: '100.00', monto_pagado: '0.00', prestamo_desc: 'Préstamo', dias_vencido: 5 },
      ],
    });
    const req = {};
    const res = mockRes();
    await alertasController.getMora(req, res);

    const result = res.json.mock.calls[0][0];
    expect(result).toHaveLength(1);
    expect(result[0].deudor_id).toBe(1);
    expect(result[0].total_mora).toBeCloseTo(160); // 60 + 100
    expect(result[0].cuotas).toHaveLength(2);
  });

  it('devuelve 500 si la consulta falla', async () => {
    query.mockRejectedValueOnce(new Error('boom'));
    const req = {};
    const res = mockRes();
    await alertasController.getMora(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('alertas.controller getProximas', () => {
  beforeEach(() => jest.clearAllMocks());

  it('usa 3 días por defecto si no se especifica "dias"', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { query: {} };
    const res = mockRes();
    await alertasController.getProximas(req, res);
    expect(query).toHaveBeenCalledWith(expect.any(String), [3]);
  });

  it('agrupa cuotas próximas a vencer por deudor', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { deudor_id: 2, nombre: 'Beto', apellidos: 'Ruiz', telefono: '888', cuota_id: 20, prestamo_id: 6, numero_cuota: 1, fecha_vencimiento: '2024-03-01', monto_esperado: '50.00', monto_pagado: '0.00', prestamo_desc: 'x', dias_para_vencer: 2 },
      ],
    });
    const req = { query: { dias: '7' } };
    const res = mockRes();
    await alertasController.getProximas(req, res);
    const result = res.json.mock.calls[0][0];
    expect(result[0]).toMatchObject({ deudor_id: 2, total: 50 });
  });
});
