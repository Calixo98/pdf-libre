import { describe, expect, it } from 'vitest';
import { readJpegDimensions, readPngDimensions } from '../src/lib/image-dimensions';
import { assertFileSize, assertImageDimensions, canvasScaleCap, InputLimitError, LIMITS } from '../src/lib/limits';
import { safeFileName } from '../src/lib/download';
import { makeJpeg, makePng } from './fixtures';

describe('dimensiones de imagen sin decodificar', () => {
  it('lee el tamaño de un PNG', () => {
    expect(readPngDimensions(makePng(37, 21))).toEqual({ width: 37, height: 21 });
  });

  it('lee el tamaño de un JPEG', () => {
    expect(readJpegDimensions(makeJpeg(64, 48))).toEqual({ width: 64, height: 48 });
  });

  it('detecta una "bomba" PNG por su cabecera, aunque el archivo sea diminuto', () => {
    const png = makePng(2, 2);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    view.setUint32(16, 60_000); // ancho declarado
    view.setUint32(20, 60_000); // alto declarado
    const dims = readPngDimensions(png);
    expect(dims).toEqual({ width: 60_000, height: 60_000 });
    expect(() => assertImageDimensions('bomba.png', dims!.width, dims!.height)).toThrow(InputLimitError);
  });

  it('devuelve null con datos que no son imagen', () => {
    expect(readPngDimensions(new Uint8Array(10))).toBeNull();
    expect(readJpegDimensions(new Uint8Array([0xff, 0xd8, 0x00, 0x00]))).toBeNull();
  });
});

describe('límites de entrada', () => {
  it('rechaza archivos demasiado grandes o vacíos', () => {
    expect(() => assertFileSize({ name: 'a.pdf', size: LIMITS.maxPdfBytes + 1 }, LIMITS.maxPdfBytes)).toThrow(
      'pesa más de',
    );
    expect(() => assertFileSize({ name: 'a.pdf', size: 0 }, LIMITS.maxPdfBytes)).toThrow('vacío');
    expect(() => assertFileSize({ name: 'a.pdf', size: 1000 }, LIMITS.maxPdfBytes)).not.toThrow();
  });

  it('acepta imágenes normales y rechaza dimensiones excesivas', () => {
    expect(() => assertImageDimensions('foto.jpg', 4032, 3024)).not.toThrow();
    expect(() => assertImageDimensions('larga.png', 30_000, 10)).toThrow(InputLimitError);
    expect(() => assertImageDimensions('vacia.png', 0, 10)).toThrow(InputLimitError);
  });

  it('limita el área de un canvas', () => {
    expect(canvasScaleCap(1000, 1000)).toBe(1);
    const scale = canvasScaleCap(40_000, 40_000);
    expect(40_000 * scale * 40_000 * scale).toBeLessThanOrEqual(LIMITS.maxCanvasPixels + 1);
  });
});

describe('safeFileName', () => {
  it('quita separadores de ruta, caracteres de control y reservados', () => {
    expect(safeFileName('../../etc/passwd')).toBe('etc_passwd');
    expect(safeFileName('a\u0000b‮c<d>:e|f?.pdf')).toBe('abc_d_e_f_.pdf');
  });

  it('limita la longitud y nunca devuelve un nombre vacío', () => {
    expect(safeFileName('x'.repeat(500)).length).toBeLessThanOrEqual(120);
    expect(safeFileName('...')).toBe('documento');
    expect(safeFileName('   ')).toBe('documento');
  });
});
