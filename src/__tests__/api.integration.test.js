process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-jest';

const request = require('supertest');

jest.mock('../config/health', () => ({ checkDb: jest.fn().mockResolvedValue(undefined) }));

const app = require('../index');

describe('API integración', () => {
  describe('POST /api/auth/login', () => {
    it('devuelve 400 cuando faltan email o password', async () => {
      const res = await request(app).post('/api/auth/login').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Error de validación');
      expect(res.body.errors).toBeDefined();
      expect(Array.isArray(res.body.errors)).toBe(true);
    });

    it('devuelve 400 cuando el email no es válido', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'no-es-email', password: '123456' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Error de validación');
    });
  });

  describe('GET /api/deudores', () => {
    it('devuelve 401 sin token Authorization', async () => {
      const res = await request(app).get('/api/deudores');
      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('GET /api/health', () => {
    it('devuelve 200 y db connected cuando checkDb resuelve', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.db).toBe('connected');
    });
  });
});
