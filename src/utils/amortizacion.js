// src/utils/amortizacion.js
// Reparte cada cuota del cronograma en capital e interés compensatorio,
// usando el sistema de saldos decrecientes: el interés de cada cuota se
// calcula sobre el saldo de capital pendiente al inicio del periodo.

// tasa_interes se guarda como porcentaje por periodo (ej. 5 = 5% mensual).
const dividirCuota = (saldoCapital, montoEsperado, tasaInteres) => {
  const tasa = parseFloat(tasaInteres || 0) / 100;
  let interes = Math.round(saldoCapital * tasa * 100) / 100;
  if (interes > montoEsperado) interes = montoEsperado;
  const capital = Math.round((montoEsperado - interes) * 100) / 100;
  return { capital, interes };
};

// Calcula capital/interés para una lista de cuotas (ordenadas por numero_cuota),
// partiendo de un saldo de capital inicial.
const calcularCronograma = (cuotas, saldoCapitalInicial, tasaInteres) => {
  let saldoCapital = saldoCapitalInicial;
  return cuotas.map(c => {
    const { capital, interes } = dividirCuota(saldoCapital, parseFloat(c.monto_esperado), tasaInteres);
    saldoCapital = Math.max(0, saldoCapital - capital);
    return { ...c, monto_capital: capital, monto_interes: interes };
  });
};

module.exports = { dividirCuota, calcularCronograma };
