import { deflateSync } from 'node:zlib';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import jpeg from 'jpeg-js';
import createQpdf from '@neslinesli93/qpdf-wasm';
import { fileURLToPath } from 'node:url';
import type { QpdfEngine } from '../src/lib/pdf-unlock';

const QPDF_WASM = fileURLToPath(new URL('../node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm', import.meta.url));

/** Motor qpdf para Node: el mismo módulo que en el navegador, pero cargando el .wasm desde disco. */
export async function createNodeQpdf(): Promise<QpdfEngine> {
  return (await createQpdf({ locateFile: () => QPDF_WASM })) as unknown as QpdfEngine;
}

/** PDF de una página con texto, sin cifrar. */
export async function makePlainPdf(text = 'Hola PDF', pages = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([300, 200]);
    page.drawText(`${text} ${i + 1}`, { x: 40, y: 100, size: 24, font });
  }
  return doc.save();
}

/** Cifra un PDF con qpdf (AES-256). Con userPassword vacío sólo quedan restricciones de propietario. */
export async function encryptPdf(bytes: Uint8Array, userPassword: string, ownerPassword: string): Promise<Uint8Array> {
  const engine = await createNodeQpdf();
  engine.FS.writeFile('/plain.pdf', bytes);
  const code = engine.callMain(['--encrypt', userPassword, ownerPassword, '256', '--', '/plain.pdf', '/encrypted.pdf']);
  if (code !== 0) throw new Error(`qpdf --encrypt falló con código ${code}`);
  return engine.FS.readFile('/encrypted.pdf');
}

/** JPEG RGB de color liso. */
export function makeJpeg(width: number, height: number): Uint8Array {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 200;
    data[i + 1] = 80;
    data[i + 2] = 40;
    data[i + 3] = 255;
  }
  const encoded = jpeg.encode({ data, width, height }, 90);
  return new Uint8Array(encoded.data);
}

/** PNG RGB de 8 bits con un gradiente. */
export function makePng(width: number, height: number): Uint8Array {
  const rows: number[] = [];
  for (let y = 0; y < height; y++) {
    rows.push(0); // filtro "None" para cada fila
    for (let x = 0; x < width; x++) rows.push(x % 256, y % 256, 128);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // profundidad de bits
  header[9] = 2; // RGB
  const chunks = [
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.from(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ];
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks]));
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData) >>> 0, 0);
  return Buffer.concat([length, typeAndData, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * JPEG mínimo con un segmento APP1 EXIF que declara la orientación indicada.
 * No tiene datos de imagen: sirve para probar el lector de EXIF.
 */
export function makeExifJpeg(orientation: number, littleEndian = true): Uint8Array {
  const u16 = (value: number): number[] =>
    littleEndian ? [value & 0xff, (value >> 8) & 0xff] : [(value >> 8) & 0xff, value & 0xff];
  const u32 = (value: number): number[] =>
    littleEndian
      ? [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]
      : [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];

  const tiff = [
    ...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]), // "II" o "MM"
    ...u16(42),
    ...u32(8), // IFD0 empieza justo después de la cabecera TIFF
    ...u16(1), // una sola entrada
    ...u16(0x0112), // etiqueta Orientation
    ...u16(3), // tipo SHORT
    ...u32(1), // cantidad
    ...u16(orientation),
    0,
    0, // relleno del campo de valor
    ...u32(0), // sin IFD siguiente
  ];
  const exifPayload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const segmentLength = exifPayload.length + 2;
  return new Uint8Array([
    0xff,
    0xd8, // SOI
    0xff,
    0xe1, // APP1
    (segmentLength >> 8) & 0xff,
    segmentLength & 0xff,
    ...exifPayload,
    0xff,
    0xd9, // EOI
  ]);
}
