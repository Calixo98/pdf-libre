import { PDFDocument } from 'pdf-lib';
import createQpdf from '@neslinesli93/qpdf-wasm';
import qpdfWasmUrl from '@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url';

/** Subconjunto de la API de qpdf-wasm que usa este proyecto. */
export interface QpdfEngine {
  callMain(args: string[]): number;
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string): Uint8Array;
  };
}

export type QpdfFactory = () => Promise<QpdfEngine>;

/**
 * qpdf no dice si falló por contraseña o por un archivo dañado, así que el
 * error sólo indica si se intentó sin contraseña (lo habitual es que el PDF la pida).
 */
export class PdfUnlockError extends Error {
  readonly triedWithoutPassword: boolean;

  constructor(triedWithoutPassword: boolean) {
    super('PDF_UNLOCK_FAILED');
    this.name = 'PdfUnlockError';
    this.triedWithoutPassword = triedWithoutPassword;
  }
}

const INPUT_PATH = '/input.pdf';
const OUTPUT_PATH = '/output.pdf';
// Códigos de salida de qpdf: 0 = correcto, 3 = correcto con advertencias, 2 = error.
const QPDF_SUCCESS_CODES = [0, 3];

/** Un PDF válido empieza con "%PDF-" (a veces tras unos bytes de basura, por eso se busca en los primeros 1 KB). */
export function isPdfFile(bytes: Uint8Array): boolean {
  const signature = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
  const limit = Math.min(bytes.length, 1024) - signature.length;
  for (let start = 0; start <= limit; start++) {
    if (signature.every((byte, i) => bytes[start + i] === byte)) return true;
  }
  return false;
}

/** Indica si el PDF está cifrado (contraseña de usuario o sólo de propietario). */
export async function isEncryptedPdf(bytes: Uint8Array): Promise<boolean> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return doc.isEncrypted;
  } catch {
    // pdf-lib no pudo leer la estructura: se trata como cifrado para que qpdf lo intente.
    return true;
  }
}

/**
 * Devuelve una copia del PDF sin cifrado ni restricciones de copia, impresión o edición.
 * Con contraseña vacía se abren los PDF que sólo tienen contraseña de propietario.
 */
export async function decryptPdf(
  bytes: Uint8Array,
  password: string,
  createEngine: QpdfFactory = createBrowserQpdf,
): Promise<Uint8Array> {
  const engine = await createEngine();
  engine.FS.writeFile(INPUT_PATH, bytes);
  // La contraseña va en el mismo argumento que --password para no depender del orden de las opciones.
  const exitCode = engine.callMain([`--password=${password}`, '--decrypt', INPUT_PATH, OUTPUT_PATH]);
  if (!QPDF_SUCCESS_CODES.includes(exitCode)) {
    throw new PdfUnlockError(password === '');
  }
  return engine.FS.readFile(OUTPUT_PATH);
}

/** Carga qpdf desde el .wasm que empaqueta Vite. */
export async function createBrowserQpdf(): Promise<QpdfEngine> {
  const qpdf = await createQpdf({ locateFile: () => qpdfWasmUrl });
  // Los tipos del paquete no declaran FS.writeFile, pero el módulo lo expone en runtime.
  return qpdf as unknown as QpdfEngine;
}
