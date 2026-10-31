export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Lee el ancho y alto de un PNG (fragmento IHDR) sin decodificarlo.
 * Devuelve null si la cabecera no es válida.
 */
export function readPngDimensions(bytes: Uint8Array): ImageDimensions | null {
  // Firma (8) + longitud (4) + "IHDR" (4) + ancho (4) + alto (4)
  if (bytes.length < 24) return null;
  const isIhdr = bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52;
  if (!isIhdr) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

// Marcadores SOF (Start Of Frame) que llevan las dimensiones. 0xC4 (DHT), 0xC8 (JPG) y 0xCC (DAC) no lo son.
const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/**
 * Lee el ancho y alto de un JPEG recorriendo sus segmentos hasta el primer SOF,
 * sin decodificar la imagen. Devuelve null si no lo encuentra.
 */
export function readJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1] ?? 0;
    // Bytes de relleno 0xFF entre segmentos.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Marcadores sin longitud (RSTn, TEM).
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // fin de imagen o inicio de datos sin SOF
    const segmentLength = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    if (segmentLength < 2) return null;
    if (SOF_MARKERS.has(marker)) {
      const height = ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0);
      const width = ((bytes[offset + 7] ?? 0) << 8) | (bytes[offset + 8] ?? 0);
      return { width, height };
    }
    offset += 2 + segmentLength;
  }
  return null;
}
