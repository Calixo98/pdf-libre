import { describe, expect, it } from 'vitest';
import { readJpegOrientation } from '../src/lib/jpeg-orientation';
import { makeExifJpeg, makeJpeg } from './fixtures';

describe('readJpegOrientation', () => {
  it('lee la orientación de un EXIF little-endian', () => {
    expect(readJpegOrientation(makeExifJpeg(6, true))).toBe(6);
  });

  it('lee la orientación de un EXIF big-endian', () => {
    expect(readJpegOrientation(makeExifJpeg(8, false))).toBe(8);
  });

  it('devuelve 1 si el JPEG no tiene EXIF', () => {
    expect(readJpegOrientation(makeJpeg(16, 16))).toBe(1);
  });

  it('devuelve 1 si el valor de orientación está fuera de 1–8', () => {
    expect(readJpegOrientation(makeExifJpeg(9, true))).toBe(1);
  });

  it('devuelve 1 para datos que no son JPEG', () => {
    expect(readJpegOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(1);
    expect(readJpegOrientation(new Uint8Array())).toBe(1);
  });

  it('no falla con un segmento EXIF truncado', () => {
    const full = makeExifJpeg(3, true);
    expect(readJpegOrientation(full.slice(0, 20))).toBe(1);
  });
});
