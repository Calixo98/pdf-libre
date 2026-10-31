import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { degrees, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { exportEditedPdf, hexToRgb } from '../src/editor/export';
import type { EditorPage } from '../src/editor/model';
import { makePlainPdf } from './fixtures';

/** Texto de todos los flujos descomprimidos del PDF (incluye los contenidos de página). */
function decodedStreams(bytes: Uint8Array): string {
  const pdf = Buffer.from(bytes).toString('latin1');
  const parts: string[] = [];
  for (const match of pdf.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const raw = Buffer.from(match[1] ?? '', 'latin1');
    try {
      parts.push(inflateSync(raw).toString('latin1'));
    } catch {
      // Flujos que no son Flate (imágenes, por ejemplo) no nos interesan aquí.
    }
  }
  return parts.join('\n');
}

describe('exportEditedPdf', () => {
  it('copia las páginas en el orden elegido y omite las quitadas', async () => {
    const source = await makePlainPdf('Pagina', 3);
    const pages: EditorPage[] = [
      { sourceIndex: 2, rotation: 0, annotations: [] },
      { sourceIndex: 0, rotation: 0, annotations: [] },
    ];

    const output = await PDFDocument.load(await exportEditedPdf(source, pages));

    expect(output.getPageCount()).toBe(2);
  });

  it('suma el giro del usuario al /Rotate original del PDF', async () => {
    const original = await PDFDocument.create();
    original.addPage([300, 200]).setRotation(degrees(90));
    const source = await original.save();
    const pages: EditorPage[] = [{ sourceIndex: 0, rotation: 270, annotations: [] }];

    const output = await PDFDocument.load(await exportEditedPdf(source, pages));

    expect(output.getPage(0).getRotation().angle).toBe(0); // 90 + 270 = 360
  });

  it('dibuja texto, resaltado y trazos sobre la página', async () => {
    const source = await makePlainPdf('Base', 1);
    const plainSize = (await exportEditedPdf(source, [{ sourceIndex: 0, rotation: 0, annotations: [] }])).byteLength;
    const pages: EditorPage[] = [
      {
        sourceIndex: 0,
        rotation: 0,
        annotations: [
          { kind: 'text', id: 1, x: 40, y: 60, lines: ['Hola, mundo', 'Segunda línea'], size: 14, color: '#cc0000' },
          { kind: 'highlight', id: 2, x: 30, y: 30, width: 120, height: 14, color: '#ffd400' },
          {
            kind: 'ink',
            id: 3,
            points: [
              { x: 10, y: 10 },
              { x: 80, y: 40 },
              { x: 120, y: 15 },
            ],
            thickness: 2,
            color: '#000000',
          },
        ],
      },
    ];

    const annotated = await exportEditedPdf(source, pages);
    const content = decodedStreams(annotated);

    expect(annotated.byteLength).toBeGreaterThan(plainSize);
    expect(content).toMatch(/\bh\s+f\b/); // rectángulo relleno del resaltado (path cerrado + relleno)
    expect(content).toMatch(/\bS\b/); // trazo del dibujo
    expect((content.match(/\bTj\b/g) ?? []).length).toBeGreaterThanOrEqual(2); // dos líneas de texto
  });

  it('no deja en el archivo las páginas quitadas aunque otra página las enlace', async () => {
    const original = await PDFDocument.create();
    const font = await original.embedFont(StandardFonts.Helvetica);
    const [first, second, last] = [original.addPage([300, 200]), original.addPage([300, 200]), original.addPage([300, 200])];
    first.drawText('PRIMERA', { x: 20, y: 100, size: 14, font });
    second.drawText('SEGUNDA', { x: 20, y: 100, size: 14, font });
    last.drawText('SECRETO_FINAL', { x: 20, y: 100, size: 14, font });
    // Enlace interno de la primera página hacia la última, como los que generan Word y LibreOffice.
    const link = original.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [10, 10, 120, 30],
      Border: [0, 0, 0],
      Dest: [last.ref, PDFName.of('Fit')],
    });
    first.node.set(PDFName.of('Annots'), original.context.obj([original.context.register(link)]));
    const source = await original.save();

    const output = await exportEditedPdf(source, [
      { sourceIndex: 0, rotation: 0, annotations: [] },
      { sourceIndex: 1, rotation: 0, annotations: [] },
    ]);

    const hidden = Buffer.from('SECRETO_FINAL').toString('hex').toUpperCase();
    expect(decodedStreams(output).toUpperCase()).not.toContain(hidden);
    expect((await PDFDocument.load(output)).getPageCount()).toBe(2);
  });

  it('rechaza un PDF sin páginas', async () => {
    await expect(exportEditedPdf(await makePlainPdf(), [])).rejects.toThrow('no tiene páginas');
  });
});

describe('hexToRgb', () => {
  it('convierte #rrggbb a componentes entre 0 y 1', () => {
    expect(hexToRgb('#ff8000')).toMatchObject({ type: 'RGB', red: 1, green: 128 / 255, blue: 0 });
  });

  it('rechaza un color que no es #rrggbb', () => {
    expect(() => hexToRgb('rojo')).toThrow('Color no válido');
  });
});
