jest.mock('../../config/logger', () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));

const mockSendMail = jest.fn();
const mockCreateTransport = jest.fn(() => ({ sendMail: mockSendMail }));
jest.mock('nodemailer', () => ({ createTransport: mockCreateTransport }));

describe('email.service sendEmail', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('devuelve NOT_CONFIGURED si faltan variables SMTP', async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    const { sendEmail } = require('../email.service');
    const result = await sendEmail('a@a.com', 'Asunto', '<p>hola</p>');
    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'NOT_CONFIGURED' }));
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('envía el correo con el transporte SMTP configurado', async () => {
    process.env.SMTP_HOST = 'smtp.test.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'user@test.com';
    process.env.SMTP_PASS = 'secret';
    process.env.SMTP_FROM = 'noreply@test.com';
    mockSendMail.mockResolvedValueOnce({ messageId: 'MSG1' });

    const { sendEmail } = require('../email.service');
    const result = await sendEmail('a@a.com', 'Asunto', '<p>hola</p>');

    expect(result).toEqual({ ok: true, messageId: 'MSG1' });
    expect(mockSendMail).toHaveBeenCalledWith({
      from: 'noreply@test.com', to: 'a@a.com', subject: 'Asunto', html: '<p>hola</p>',
    });
  });

  it('usa secure=true automáticamente en el puerto 465', async () => {
    process.env.SMTP_HOST = 'smtp.test.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_USER = 'user@test.com';
    process.env.SMTP_PASS = 'secret';
    mockSendMail.mockResolvedValueOnce({ messageId: 'MSG1' });

    const { sendEmail } = require('../email.service');
    await sendEmail('a@a.com', 'Asunto', '<p>hola</p>');

    expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: true, port: 465 }));
  });

  it('devuelve ok:false si el envío falla, sin lanzar', async () => {
    process.env.SMTP_HOST = 'smtp.test.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'user@test.com';
    process.env.SMTP_PASS = 'secret';
    mockSendMail.mockRejectedValueOnce(new Error('conexión rechazada'));

    const { sendEmail } = require('../email.service');
    const result = await sendEmail('a@a.com', 'Asunto', '<p>hola</p>');

    expect(result).toEqual({ ok: false, error: 'conexión rechazada' });
  });
});
