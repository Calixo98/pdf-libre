import { readJpegOrientation } from './jpeg-orientation';
import { toBlob } from './download';
import type { PdfImage } from './images-to-pdf';

export interface PreparedImage {
  image: PdfImage;
  warning: string | null;
}

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Detecta el formato por los primeros bytes, sin confiar en la extensión del archivo. */
export function detectImageKind(bytes: Uint8Array): PdfImage['kind'] | null {
  if (startsWith(bytes, JPEG_SIGNATURE)) return 'jpg';
  if (startsWith(bytes, PNG_SIGNATURE)) return 'png';
  return null;
}

/**
 * Lee una foto del usuario. pdf-lib incrusta los bytes del JPEG tal cual, así
 * que una foto con orientación EXIF saldría girada: en ese caso se vuelve a
 * codificar con el navegador, que sí aplica la orientación.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = detectImageKind(bytes);
  if (!kind) throw new Error(`"${file.name}" no es un JPG ni un PNG.`);

  if (kind === 'jpg' && readJpegOrientation(bytes) !== 1) {
    try {
      return { image: { bytes: await reencodeUpright(bytes), kind }, warning: null };
    } catch {
      return {
        image: { bytes, kind },
        warning: `No se pudo enderezar "${file.name}"; puede salir girada en el PDF.`,
      };
    }
  }
  return { image: { bytes, kind }, warning: null };
}

async function reencodeUpright(bytes: Uint8Array): Promise<Uint8Array> {
  const url = URL.createObjectURL(toBlob(bytes, 'image/jpeg'));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('El navegador no ofrece canvas 2D');
    context.drawImage(img, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
    if (!blob) throw new Error('No se pudo codificar la imagen');
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, i) => bytes[i] === byte);
}
