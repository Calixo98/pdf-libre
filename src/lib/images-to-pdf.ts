import { PageSizes, PDFDocument } from 'pdf-lib';

export type PageSizeOption = 'a4' | 'letter' | 'fit';
export type OrientationOption = 'auto' | 'portrait' | 'landscape';

export interface ImagesToPdfOptions {
  pageSize: PageSizeOption;
  orientation: OrientationOption;
  marginMm: number;
}

export interface PdfImage {
  bytes: Uint8Array;
  kind: 'jpg' | 'png';
}

export interface PageLayout {
  pageWidth: number;
  pageHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Un PDF admite páginas de hasta 200 pulgadas (14 400 pt) por lado.
const MAX_PAGE_SIDE_PT = 14400;
const MM_TO_PT = 72 / 25.4;

/**
 * Calcula la página y la posición de la imagen. Con "fit" la página tiene el
 * tamaño de la imagen (1 px = 1 pt); con A4 o carta la imagen se centra y se
 * escala para caber dentro del margen.
 */
export function computePageLayout(
  image: { width: number; height: number },
  options: ImagesToPdfOptions,
): PageLayout {
  if (options.pageSize === 'fit') {
    const scale = Math.min(1, MAX_PAGE_SIDE_PT / Math.max(image.width, image.height));
    const width = image.width * scale;
    const height = image.height * scale;
    return { pageWidth: width, pageHeight: height, x: 0, y: 0, width, height };
  }

  const base = options.pageSize === 'letter' ? PageSizes.Letter : PageSizes.A4;
  const shortSide = Math.min(...base);
  const longSide = Math.max(...base);
  const landscape =
    options.orientation === 'landscape' || (options.orientation === 'auto' && image.width > image.height);
  const pageWidth = landscape ? longSide : shortSide;
  const pageHeight = landscape ? shortSide : longSide;

  const margin = options.marginMm * MM_TO_PT;
  const availableWidth = Math.max(pageWidth - 2 * margin, 1);
  const availableHeight = Math.max(pageHeight - 2 * margin, 1);
  const scale = Math.min(availableWidth / image.width, availableHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    pageWidth,
    pageHeight,
    x: (pageWidth - width) / 2,
    y: (pageHeight - height) / 2,
    width,
    height,
  };
}

/**
 * Un PNG completo termina con el fragmento IEND (longitud 0, tipo "IEND" y CRC).
 * Sin él, el decodificador de pdf-lib no termina nunca, así que se rechaza antes.
 */
export function hasPngEnd(bytes: Uint8Array): boolean {
  const iend = [0x49, 0x45, 0x4e, 0x44]; // "IEND"
  for (let position = bytes.length - 8; position >= 4; position--) {
    const lengthIsZero = [0, 1, 2, 3].every((i) => bytes[position - 4 + i] === 0);
    if (lengthIsZero && iend.every((byte, i) => bytes[position + i] === byte)) return true;
  }
  return false;
}

/** Crea un PDF con una imagen por página, en el orden recibido. */
export async function imagesToPdf(images: PdfImage[], options: ImagesToPdfOptions): Promise<Uint8Array> {
  if (images.length === 0) throw new Error('imagesToPdf: se necesita al menos una imagen');

  const pdf = await PDFDocument.create({ updateMetadata: false });
  for (const [index, image] of images.entries()) {
    if (image.kind === 'png' && !hasPngEnd(image.bytes)) {
      throw new Error(`La imagen ${index + 1} es un PNG incompleto o dañado.`);
    }
    const embedded = image.kind === 'jpg' ? await pdf.embedJpg(image.bytes) : await pdf.embedPng(image.bytes);
    const layout = computePageLayout(embedded, options);
    const page = pdf.addPage([layout.pageWidth, layout.pageHeight]);
    page.drawImage(embedded, { x: layout.x, y: layout.y, width: layout.width, height: layout.height });
  }
  return pdf.save();
}
