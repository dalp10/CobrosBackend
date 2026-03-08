const { pgErrorToHttp } = require('../../utils/pgErrors');

describe('pgErrorToHttp', () => {
  it('returns null when err is null or has no code', () => {
    expect(pgErrorToHttp(null)).toBeNull();
    expect(pgErrorToHttp({})).toBeNull();
    expect(pgErrorToHttp({ message: 'foo' })).toBeNull();
  });

  it('returns 409 for unique_violation (23505)', () => {
    const res = pgErrorToHttp({ code: '23505', message: 'duplicate key', detail: 'email' });
    expect(res).toEqual({ status: 409, error: 'El registro ya existe', detail: 'email' });
  });

  it('returns 400 for foreign_key_violation (23503)', () => {
    const res = pgErrorToHttp({ code: '23503' });
    expect(res.status).toBe(400);
    expect(res.error).toContain('Referencia inválida');
  });

  it('returns 400 for not_null_violation (23502)', () => {
    const res = pgErrorToHttp({ code: '23502' });
    expect(res.status).toBe(400);
    expect(res.error).toContain('Falta un campo obligatorio');
  });

  it('returns 400 for invalid_text_representation (22P02)', () => {
    const res = pgErrorToHttp({ code: '22P02' });
    expect(res.status).toBe(400);
    expect(res.error).toContain('Valor inválido');
  });

  it('returns 400 for check_violation (23514)', () => {
    const res = pgErrorToHttp({ code: '23514' });
    expect(res.status).toBe(400);
    expect(res.error).toContain('no cumple las restricciones');
  });

  it('returns null for unknown code', () => {
    expect(pgErrorToHttp({ code: 'XX000' })).toBeNull();
  });
});
