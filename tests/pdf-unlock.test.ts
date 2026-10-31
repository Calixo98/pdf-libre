import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { decryptPdf, isEncryptedPdf, PdfUnlockError } from '../src/lib/pdf-unlock';
import { createNodeQpdf, encryptPdf, makePlainPdf } from './fixtures';

describe('isEncryptedPdf', () => {
  it('detecta un PDF sin cifrar', async () => {
    expect(await isEncryptedPdf(await makePlainPdf())).toBe(false);
  });

  it('detecta un PDF con contraseña de usuario', async () => {
    const encrypted = await encryptPdf(await makePlainPdf(), 'secreto', 'propietario');
    expect(await isEncryptedPdf(encrypted)).toBe(true);
  });

  it('trata como cifrado lo que pdf-lib no puede leer', async () => {
    expect(await isEncryptedPdf(new Uint8Array([1, 2, 3]))).toBe(true);
  });
});

describe('decryptPdf', () => {
  it('quita la contraseña de usuario cuando se escribe la correcta', async () => {
    const encrypted = await encryptPdf(await makePlainPdf('Secreto', 2), 'secreto', 'propietario');

    const output = await decryptPdf(encrypted, 'secreto', createNodeQpdf);

    const doc = await PDFDocument.load(output);
    expect(doc.isEncrypted).toBe(false);
    expect(doc.getPageCount()).toBe(2);
  });

  it('sin contraseña falla con PdfUnlockError si el PDF pide una', async () => {
    const encrypted = await encryptPdf(await makePlainPdf(), 'secreto', 'propietario');

    const error = await decryptPdf(encrypted, '', createNodeQpdf).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PdfUnlockError);
    expect((error as PdfUnlockError).triedWithoutPassword).toBe(true);
  });

  it('con contraseña incorrecta falla con PdfUnlockError', async () => {
    const encrypted = await encryptPdf(await makePlainPdf(), 'secreto', 'propietario');

    const error = await decryptPdf(encrypted, 'otra', createNodeQpdf).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PdfUnlockError);
    expect((error as PdfUnlockError).triedWithoutPassword).toBe(false);
  });

  it('quita sólo restricciones de propietario sin pedir contraseña', async () => {
    const restricted = await encryptPdf(await makePlainPdf(), '', 'propietario');

    const output = await decryptPdf(restricted, '', createNodeQpdf);

    expect((await PDFDocument.load(output)).isEncrypted).toBe(false);
  });

  it('un PDF sin cifrar también se devuelve como copia válida', async () => {
    const output = await decryptPdf(await makePlainPdf(), '', createNodeQpdf);
    expect((await PDFDocument.load(output)).getPageCount()).toBe(1);
  });
});
