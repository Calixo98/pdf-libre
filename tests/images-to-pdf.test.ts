import { describe, expect, it } from 'vitest';
import { PDFDocument, PageSizes } from 'pdf-lib';
import { computePageLayout, hasPngEnd, imagesToPdf, type ImagesToPdfOptions } from '../src/lib/images-to-pdf';
import { makeJpeg, makePng } from './fixtures';

const A4_NO_MARGIN: ImagesToPdfOptions = { pageSize: 'a4', orientation: 'auto', marginMm: 0 };

describe('computePageLayout', () => {
  it('usa A4 vertical para una imagen alta y la centra', () => {
    const layout = computePageLayout({ width: 500, height: 1000 }, A4_NO_MARGIN);
    expect(layout.pageWidth).toBeCloseTo(PageSizes.A4[0], 2);
    expect(layout.pageHeight).toBeCloseTo(PageSizes.A4[1], 2);
    expect(layout.height).toBeCloseTo(layout.pageHeight, 2);
    expect(layout.x).toBeCloseTo((layout.pageWidth - layout.width) / 2, 2);
    expect(layout.y).toBeCloseTo(0, 2);
  });

  it('gira la página a horizontal cuando la imagen es ancha', () => {
    const layout = computePageLayout({ width: 1000, height: 500 }, A4_NO_MARGIN);
    expect(layout.pageWidth).toBeCloseTo(PageSizes.A4[1], 2);
    expect(layout.pageHeight).toBeCloseTo(PageSizes.A4[0], 2);
    expect(layout.width).toBeCloseTo(layout.pageWidth, 2);
  });

  it('respeta la orientación elegida aunque la imagen sea de otra forma', () => {
    const layout = computePageLayout({ width: 1000, height: 500 }, { ...A4_NO_MARGIN, orientation: 'portrait' });
    expect(layout.pageWidth).toBeCloseTo(PageSizes.A4[0], 2);
    expect(layout.pageHeight).toBeCloseTo(PageSizes.A4[1], 2);
  });

  it('descuenta el margen de cada lado', () => {
    const layout = computePageLayout({ width: 500, height: 1000 }, { ...A4_NO_MARGIN, marginMm: 10 });
    const margin = (10 * 72) / 25.4;
    expect(layout.x).toBeGreaterThanOrEqual(margin - 1e-6);
    expect(layout.y + layout.height).toBeLessThanOrEqual(layout.pageHeight - margin + 1e-6);
  });

  it('usa carta cuando se elige', () => {
    const layout = computePageLayout({ width: 500, height: 1000 }, { ...A4_NO_MARGIN, pageSize: 'letter' });
    expect(layout.pageWidth).toBeCloseTo(PageSizes.Letter[0], 2);
    expect(layout.pageHeight).toBeCloseTo(PageSizes.Letter[1], 2);
  });

  it('en modo "ajustar" la página tiene el tamaño de la imagen', () => {
    const layout = computePageLayout({ width: 800, height: 600 }, { ...A4_NO_MARGIN, pageSize: 'fit' });
    expect(layout).toEqual({ pageWidth: 800, pageHeight: 600, x: 0, y: 0, width: 800, height: 600 });
  });

  it('limita la página a 14 400 pt por lado', () => {
    const layout = computePageLayout({ width: 20000, height: 10000 }, { ...A4_NO_MARGIN, pageSize: 'fit' });
    expect(layout.pageWidth).toBeCloseTo(14400, 6);
    expect(layout.pageHeight).toBeCloseTo(7200, 6);
  });
});

describe('imagesToPdf', () => {
  it('crea una página por imagen, en orden, con JPG y PNG', async () => {
    const bytes = await imagesToPdf(
      [
        { kind: 'jpg', bytes: makeJpeg(120, 80) },
        { kind: 'png', bytes: makePng(60, 90) },
      ],
      A4_NO_MARGIN,
    );

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    const [first, second] = doc.getPages();
    expect(first?.getWidth()).toBeCloseTo(PageSizes.A4[1], 2); // 120 x 80 es horizontal
    expect(second?.getWidth()).toBeCloseTo(PageSizes.A4[0], 2); // 60 x 90 es vertical
  });

  it('rechaza un PNG cortado en vez de quedarse colgado', async () => {
    const png = makePng(64, 64);
    const truncated = png.slice(0, Math.floor(png.length * 0.9));

    await expect(imagesToPdf([{ kind: 'png', bytes: truncated }], A4_NO_MARGIN)).rejects.toThrow('PNG incompleto');
    expect(hasPngEnd(png)).toBe(true);
    expect(hasPngEnd(truncated)).toBe(false);
  });

  it('rechaza una lista vacía', async () => {
    await expect(imagesToPdf([], A4_NO_MARGIN)).rejects.toThrow('al menos una imagen');
  });
});
