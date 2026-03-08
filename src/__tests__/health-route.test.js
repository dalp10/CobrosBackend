const request = require('supertest');
const express = require('express');

// App mínima para probar el health sin DB real
const app = express();
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', db: 'mock' });
});

describe('GET /api/health', () => {
  it('returns 200 and status ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('mock');
  });
});
