import {
  degrees,
  LineCapStyle,
  PDFArray,
  PDFContext,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFPage,
  rgb,
  StandardFonts,
  type PDFFont,
} from 'pdf-lib';
import {
  HIGHLIGHT_OPACITY,
  LINE_HEIGHT,
  normalizeRotation,
  type Annotation,
  type EditorPage,
} from './model';
import { sanitizePdfDocument, type SanitizeReport } from '../lib/pdf-sanitize';

export interface ExportResult {
  bytes: Uint8Array;
  /** Contenido activo (scripts, acciones, adjuntos…) que se quitó del PDF exportado. */
  report: SanitizeReport;
}

/**
 * Genera el PDF final: aplica las anotaciones en el PDF original, luego copia
 * las páginas en el orden elegido con sus giros. Las páginas quitadas no se copian.
 * Al final se quita el contenido activo que las páginas copiadas pudieran traer
 * (acciones automáticas, scripts, adjuntos, enlaces javascript:…).
 */
export async function exportEditedPdf(source: Uint8Array, pages: EditorPage[]): Promise<ExportResult> {
  if (pages.length === 0) throw new Error('El PDF no tiene páginas para exportar');

  const original = await PDFDocument.load(source, { updateMetadata: false });
  const font = await original.embedFont(StandardFonts.Helvetica);

  // Giro propio de cada página en el PDF original (puede venir heredado del árbol de páginas).
  const baseRotations = new Map<number, number>();
  for (const page of pages) {
    const sourcePage = original.getPage(page.sourceIndex);
    baseRotations.set(page.sourceIndex, normalizeRotation(sourcePage.getRotation().angle));
    dropReferencesToOtherPages(sourcePage, original.context);
    for (const annotation of page.annotations) drawAnnotation(sourcePage, annotation, font);
  }

  const output = await PDFDocument.create({ updateMetadata: false });
  const copies = await output.copyPages(
    original,
    pages.map((page) => page.sourceIndex),
  );
  copies.forEach((copy, index) => {
    const entry = pages[index];
    if (!entry) return;
    const base = baseRotations.get(entry.sourceIndex) ?? 0;
    copy.setRotation(degrees(normalizeRotation(base + entry.rotation)));
    output.addPage(copy);
  });
  const report = sanitizePdfDocument(output);
  return { bytes: await output.save(), report };
}

/**
 * copyPages copia todo lo que una página referencia. Un enlace interno o un
 * campo de formulario que apunta a otra página arrastraría esa página al PDF
 * aunque el usuario la hubiera quitado. Por eso se quitan esas referencias
 * antes de copiar; los enlaces a sitios web y las notas se conservan.
 */
function dropReferencesToOtherPages(page: PDFPage, context: PDFContext): void {
  const annotations = page.node.Annots();
  if (!annotations) return;

  const kept: ReturnType<PDFArray['get']>[] = [];
  for (let index = 0; index < annotations.size(); index++) {
    const reference = annotations.get(index);
    const annotation = context.lookup(reference, PDFDict);
    if (annotation && keepsAnnotation(annotation, context)) kept.push(reference);
  }
  page.node.set(PDFName.of('Annots'), context.obj(kept));
}

function keepsAnnotation(annotation: PDFDict, context: PDFContext): boolean {
  const subtype = annotation.get(PDFName.of('Subtype'));
  if (!(subtype instanceof PDFName)) return false;
  switch (subtype.decodeText()) {
    case 'Widget':
      return false; // un campo de formulario puede arrastrar widgets de otras páginas
    case 'Link': {
      if (annotation.has(PDFName.of('Dest'))) return false;
      const action = context.lookup(annotation.get(PDFName.of('A')), PDFDict);
      const actionType = action?.get(PDFName.of('S'));
      return actionType instanceof PDFName && actionType.decodeText() === 'URI';
    }
    default:
      return true;
  }
}

function drawAnnotation(page: PDFPage, annotation: Annotation, font: PDFFont): void {
  switch (annotation.kind) {
    case 'text': {
      const color = hexToRgb(annotation.color);
      annotation.lines.forEach((line, index) => {
        if (line.length === 0) return;
        page.drawText(line, {
          x: annotation.x,
          y: annotation.y - index * annotation.size * LINE_HEIGHT,
          size: annotation.size,
          font,
          color,
        });
      });
      return;
    }
    case 'highlight':
      page.drawRectangle({
        x: annotation.x,
        y: annotation.y,
        width: annotation.width,
        height: annotation.height,
        color: hexToRgb(annotation.color),
        opacity: HIGHLIGHT_OPACITY,
        borderWidth: 0,
      });
      return;
    case 'ink': {
      const color = hexToRgb(annotation.color);
      const [first, ...rest] = annotation.points;
      if (!first) return;
      // Un solo punto se dibuja como un segmento de largo cero con extremos redondeados.
      let previous = first;
      for (const point of rest.length > 0 ? rest : [first]) {
        page.drawLine({
          start: previous,
          end: point,
          thickness: annotation.thickness,
          color,
          lineCap: LineCapStyle.Round,
        });
        previous = point;
      }
      return;
    }
  }
}

/** "#rrggbb" -> color de pdf-lib. */
export function hexToRgb(hex: string) {
  const value = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!value) throw new Error(`Color no válido: ${hex}`);
  const channel = (offset: number) => parseInt(value.slice(offset, offset + 2), 16) / 255;
  return rgb(channel(0), channel(2), channel(4));
}
