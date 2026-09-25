const { dividirCuota, calcularCronograma } = require('../amortizacion');

describe('dividirCuota', () => {
  it('reparte capital e interés sobre el saldo pendiente (5% mensual)', () => {
    const { capital, interes } = dividirCuota(1000, 350, 5);
    expect(interes).toBe(50); // 1000 * 5%
    expect(capital).toBe(300); // 350 - 50
  });

  it('trata tasa_interes nula/indefinida como 0% (todo capital)', () => {
    expect(dividirCuota(1000, 100, undefined)).toEqual({ capital: 100, interes: 0 });
    expect(dividirCuota(1000, 100, null)).toEqual({ capital: 100, interes: 0 });
  });

  it('acepta tasa_interes como string numérico', () => {
    const { capital, interes } = dividirCuota(1000, 100, '10');
    expect(interes).toBe(100); // 1000 * 10%
    expect(capital).toBe(0);
  });

  it('no deja que el interés supere el monto de la cuota (interés capado)', () => {
    // Saldo muy alto con tasa alta generaría un interés mayor a la cuota misma;
    // el capital nunca debe quedar negativo.
    const { capital, interes } = dividirCuota(10000, 100, 50);
    expect(interes).toBe(100);
    expect(capital).toBe(0);
  });

  it('redondea a 2 decimales', () => {
    const { capital, interes } = dividirCuota(333.33, 100, 3);
    // interes = 333.33 * 0.03 = 9.9999 -> 10.00
    expect(interes).toBe(10);
    expect(capital).toBe(90);
  });
});

describe('calcularCronograma', () => {
  it('sobre saldos decrecientes, el interés baja y el capital sube en cada cuota', () => {
    const cuotas = [
      { numero_cuota: 1, monto_esperado: 400 },
      { numero_cuota: 2, monto_esperado: 400 },
      { numero_cuota: 3, monto_esperado: 400 },
    ];
    const resultado = calcularCronograma(cuotas, 1000, 5);

    expect(resultado).toHaveLength(3);
    // Cuota 1: interés sobre 1000
    expect(resultado[0].monto_interes).toBe(50);
    expect(resultado[0].monto_capital).toBe(350);
    // Cuota 2: interés sobre saldo restante (1000 - 350 = 650)
    expect(resultado[1].monto_interes).toBe(32.5);
    expect(resultado[1].monto_capital).toBe(367.5);
    // Cuota 3: interés sobre saldo restante (650 - 367.5 = 282.5)
    expect(resultado[2].monto_interes).toBe(14.13);
    expect(resultado[2].monto_capital).toBe(385.87);
  });

  it('con tasa 0%, todo el monto de cada cuota es capital', () => {
    const cuotas = [
      { numero_cuota: 1, monto_esperado: 300 },
      { numero_cuota: 2, monto_esperado: 300 },
    ];
    const resultado = calcularCronograma(cuotas, 600, 0);
    expect(resultado[0]).toMatchObject({ monto_capital: 300, monto_interes: 0 });
    expect(resultado[1]).toMatchObject({ monto_capital: 300, monto_interes: 0 });
  });

  it('el saldo de capital nunca baja de 0 aunque el capital amortizado supere el saldo inicial', () => {
    const cuotas = [
      { numero_cuota: 1, monto_esperado: 700 },
      { numero_cuota: 2, monto_esperado: 700 },
    ];
    // Saldo inicial 500: la primera cuota ya amortiza más capital del que existe.
    const resultado = calcularCronograma(cuotas, 500, 10);
    expect(resultado[0].monto_interes).toBe(50); // 500 * 10%
    expect(resultado[0].monto_capital).toBe(650); // 700 - 50
    // Saldo capital tras cuota 1: max(0, 500 - 650) = 0
    expect(resultado[1].monto_interes).toBe(0); // 0 * 10%
    expect(resultado[1].monto_capital).toBe(700);
  });

  it('conserva los campos originales de cada cuota (numero_cuota, fecha_vencimiento, etc.)', () => {
    const cuotas = [{ numero_cuota: 1, fecha_vencimiento: '2024-01-01', monto_esperado: 100 }];
    const resultado = calcularCronograma(cuotas, 100, 5);
    expect(resultado[0]).toMatchObject({ numero_cuota: 1, fecha_vencimiento: '2024-01-01' });
  });

  it('no muta el arreglo de cuotas original', () => {
    const cuotas = [{ numero_cuota: 1, monto_esperado: 100 }];
    calcularCronograma(cuotas, 100, 5);
    expect(cuotas[0].monto_capital).toBeUndefined();
  });
});
