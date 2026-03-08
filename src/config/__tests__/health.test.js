const { checkDb } = require('../health');

jest.mock('../db', () => ({
  pool: {
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      release: jest.fn(),
    }),
  },
}));

describe('checkDb', () => {
  it('resolves to true when DB responds', async () => {
    const result = await checkDb();
    expect(result).toBe(true);
  });

  it('releases the client after query', async () => {
    const { pool } = require('../db');
    const client = await pool.connect();
    await checkDb();
    expect(client.release).toHaveBeenCalled();
  });
});
