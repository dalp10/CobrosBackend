jest.mock('../../config/logger', () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));

const mockMessagesCreate = jest.fn();
jest.mock('twilio', () => jest.fn(() => ({ messages: { create: mockMessagesCreate } })));

const { sendWhatsApp, toE164 } = require('../whatsapp.service');

describe('toE164', () => {
  it('convierte un número peruano de 9 dígitos que empieza en 9 anteponiendo +51', () => {
    expect(toE164('981844013')).toBe('+51981844013');
  });

  it('quita el 0 inicial antes de convertir', () => {
    expect(toE164('0981844013')).toBe('+51981844013');
  });

  it('acepta un número que ya trae el código de país (10 dígitos)', () => {
    expect(toE164('51981844013')).toBe('+51981844013');
  });

  it('ignora caracteres no numéricos (espacios, guiones, +)', () => {
    expect(toE164('+51 981-844-013')).toBe('+51981844013');
  });

  it('devuelve null para números vacíos o inválidos (muy cortos)', () => {
    expect(toE164('')).toBeNull();
    expect(toE164(null)).toBeNull();
    expect(toE164('12345')).toBeNull();
  });
});

describe('sendWhatsApp', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('devuelve NOT_CONFIGURED si faltan las credenciales de Twilio', async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    const result = await sendWhatsApp('981844013', 'hola');
    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'NOT_CONFIGURED' }));
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('devuelve error si el número no es válido', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'SID';
    process.env.TWILIO_AUTH_TOKEN = 'TOKEN';
    const result = await sendWhatsApp('123', 'hola');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/inválido/);
  });

  it('envía el mensaje por Twilio y devuelve el sid', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'SID';
    process.env.TWILIO_AUTH_TOKEN = 'TOKEN';
    process.env.TWILIO_WHATSAPP_FROM = 'whatsapp:+14155238886';
    mockMessagesCreate.mockResolvedValueOnce({ sid: 'SM123' });

    const result = await sendWhatsApp('981844013', 'Hola, recuerda tu pago');

    expect(result).toEqual({ ok: true, sid: 'SM123' });
    expect(mockMessagesCreate).toHaveBeenCalledWith({
      body: 'Hola, recuerda tu pago',
      from: 'whatsapp:+14155238886',
      to: 'whatsapp:+51981844013',
    });
  });

  it('usa un mensaje por defecto si el body está vacío', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'SID';
    process.env.TWILIO_AUTH_TOKEN = 'TOKEN';
    mockMessagesCreate.mockResolvedValueOnce({ sid: 'SM1' });
    await sendWhatsApp('981844013', '   ');
    expect(mockMessagesCreate).toHaveBeenCalledWith(expect.objectContaining({ body: 'Recordatorio de cobro' }));
  });

  it('propaga el error de Twilio (código y mensaje) si el envío falla', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'SID';
    process.env.TWILIO_AUTH_TOKEN = 'TOKEN';
    const twilioError = new Error('Número no es de WhatsApp');
    twilioError.code = 63007;
    mockMessagesCreate.mockRejectedValueOnce(twilioError);

    const result = await sendWhatsApp('981844013', 'hola');

    expect(result).toEqual({ ok: false, error: 'Número no es de WhatsApp', code: 63007 });
  });
});
