jest.mock('../../config/logger', () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock('fs', () => ({ existsSync: jest.fn(), unlinkSync: jest.fn() }));

const fs = require('fs');
const path = require('path');
const { resolveUploadPath, tryDeleteUpload, uploadsDir } = require('../uploads');

describe('resolveUploadPath', () => {
  it('devuelve null si la url es vacía o no es string', () => {
    expect(resolveUploadPath(null)).toBeNull();
    expect(resolveUploadPath(undefined)).toBeNull();
    expect(resolveUploadPath(123)).toBeNull();
    expect(resolveUploadPath('')).toBeNull();
  });

  it('extrae el nombre de archivo de una url /uploads/...', () => {
    const result = resolveUploadPath('/uploads/voucher-123.jpg');
    expect(result).toBe(path.join(uploadsDir, 'voucher-123.jpg'));
  });

  it('ignora cualquier subruta y se queda solo con el nombre de archivo final (evita path traversal)', () => {
    const result = resolveUploadPath('/uploads/../../etc/passwd');
    expect(result).toBe(path.join(uploadsDir, 'passwd'));
  });
});

describe('tryDeleteUpload', () => {
  beforeEach(() => jest.clearAllMocks());

  it('no hace nada si la url no resuelve a una ruta', () => {
    tryDeleteUpload(null);
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  it('borra el archivo si existe', () => {
    fs.existsSync.mockReturnValue(true);
    tryDeleteUpload('/uploads/foo.jpg');
    expect(fs.unlinkSync).toHaveBeenCalledWith(path.join(uploadsDir, 'foo.jpg'));
  });

  it('no intenta borrar si el archivo no existe', () => {
    fs.existsSync.mockReturnValue(false);
    tryDeleteUpload('/uploads/foo.jpg');
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  it('no lanza si unlinkSync falla (solo registra el error)', () => {
    fs.existsSync.mockReturnValue(true);
    fs.unlinkSync.mockImplementation(() => { throw new Error('permiso denegado'); });
    expect(() => tryDeleteUpload('/uploads/foo.jpg')).not.toThrow();
  });
});
