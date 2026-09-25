const express = require('express');
const request = require('supertest');
const { validateParamId } = require('../validateParamId');

function buildApp() {
  const app = express();
  app.get('/items/:id', validateParamId, (req, res) => res.json({ ok: true }));
  return app;
}

describe('middleware/validateParamId', () => {
  it('deja pasar un id entero positivo', async () => {
    const res = await request(buildApp()).get('/items/5');
    expect(res.status).toBe(200);
  });

  it('rechaza un id no numérico con 400', async () => {
    const res = await request(buildApp()).get('/items/abc');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ID inválido');
  });

  it('rechaza un id negativo o cero con 400', async () => {
    const res = await request(buildApp()).get('/items/0');
    expect(res.status).toBe(400);
  });
});
