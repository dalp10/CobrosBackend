const { addMonthsIso } = require('./fechas');

describe('addMonthsIso', () => {
  it('no arrastra el día al mes siguiente en meses cortos (feb/abr/jun/sep/nov)', () => {
    expect(addMonthsIso('2026-01-01', 0)).toBe('2026-01-01');
    expect(addMonthsIso('2026-01-01', 1)).toBe('2026-02-01');
    expect(addMonthsIso('2026-01-01', 2)).toBe('2026-03-01');
    expect(addMonthsIso('2026-01-01', 3)).toBe('2026-04-01');
  });

  it('genera un cronograma mensual estable en el día 1 durante 48 meses (caso préstamo BanBif)', () => {
    const fechas = Array.from({ length: 48 }, (_, i) => addMonthsIso('2023-04-01', i));
    expect(fechas.every(f => f.endsWith('-01'))).toBe(true);
    expect(fechas[0]).toBe('2023-04-01');
    expect(fechas[47]).toBe('2027-03-01');
  });

  it('acepta un objeto Date (como lo devuelve node-postgres para columnas DATE)', () => {
    const fecha = new Date('2023-04-01T05:00:00.000Z'); // medianoche local (UTC-5) tal como la devuelve pg
    expect(addMonthsIso(fecha, 1)).toBe('2023-05-01');
  });

  it('sí desborda cuando el día de anclaje no existe en el mes destino (ej. día 31)', () => {
    expect(addMonthsIso('2023-01-31', 1)).toBe('2023-03-03'); // feb no tiene día 31
  });
});
