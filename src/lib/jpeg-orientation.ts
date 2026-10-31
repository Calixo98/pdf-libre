const APP1_MARKER = 0xe1;
const SOS_MARKER = 0xda;
const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
const ORIENTATION_TAG = 0x0112;

/**
 * Lee la orientación EXIF (1–8) de un JPEG. Devuelve 1 (sin girar) si no hay
 * EXIF o si los datos no son válidos. Los celulares guardan las fotos en
 * horizontal y marcan el giro real en esta etiqueta.
 */
export function readJpegOrientation(bytes: Uint8Array): number {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return 1;
    const marker = bytes[offset + 1];
    if (marker === SOS_MARKER) return 1; // a partir de aquí empieza la imagen comprimida
    const segmentLength = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    if (marker === APP1_MARKER && hasExifHeader(bytes, offset + 4)) {
      return readTiffOrientation(bytes, offset + 4 + EXIF_HEADER.length);
    }
    offset += 2 + segmentLength;
  }
  return 1;
}

function hasExifHeader(bytes: Uint8Array, start: number): boolean {
  return EXIF_HEADER.every((byte, i) => bytes[start + i] === byte);
}

function readTiffOrientation(bytes: Uint8Array, tiffStart: number): number {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset + tiffStart, bytes.byteLength - tiffStart);
    const littleEndian = view.getUint16(0) === 0x4949; // "II" = little-endian, "MM" = big-endian
    if (!littleEndian && view.getUint16(0) !== 0x4d4d) return 1;

    const ifdOffset = view.getUint32(4, littleEndian);
    const entryCount = view.getUint16(ifdOffset, littleEndian);
    for (let i = 0; i < entryCount; i++) {
      const entry = ifdOffset + 2 + i * 12;
      if (view.getUint16(entry, littleEndian) === ORIENTATION_TAG) {
        // Tipo SHORT con un solo valor: va en los primeros 2 bytes del campo de valor.
        const value = view.getUint16(entry + 8, littleEndian);
        return value >= 1 && value <= 8 ? value : 1;
      }
    }
  } catch {
    // Datos EXIF truncados: se trata como si no hubiera orientación.
  }
  return 1;
}
