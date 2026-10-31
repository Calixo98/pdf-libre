import {
  FONT_STACK,
  HIGHLIGHT_OPACITY,
  LINE_HEIGHT,
  type Annotation,
  type HighlightAnnotation,
  type InkAnnotation,
  type TextAnnotation,
} from './model';

/** Lo que el dibujo necesita de un PageViewport de pdf.js. */
export interface ViewportLike {
  scale: number;
  rotation: number;
  convertToViewportPoint(x: number, y: number): number[];
}

/**
 * Dibuja una anotación sobre el canvas de superposición. Usa la misma
 * geometría que la exportación: el texto se gira con la página y las líneas
 * avanzan hacia abajo en el sentido de la página.
 */
export function drawAnnotation(context: CanvasRenderingContext2D, viewport: ViewportLike, annotation: Annotation): void {
  switch (annotation.kind) {
    case 'text':
      drawText(context, viewport, annotation);
      return;
    case 'highlight':
      drawHighlight(context, viewport, annotation);
      return;
    case 'ink':
      drawInk(context, viewport, annotation);
      return;
  }
}

/** Ancho de un texto en puntos PDF (el contexto se usa sin transformaciones). */
export function measureText(context: CanvasRenderingContext2D, text: string, size: number): number {
  context.save();
  context.font = `${size}px ${FONT_STACK}`;
  const width = context.measureText(text).width;
  context.restore();
  return width;
}

function toCanvas(viewport: ViewportLike, x: number, y: number): { x: number; y: number } {
  const point = viewport.convertToViewportPoint(x, y);
  return { x: Number(point[0]), y: Number(point[1]) };
}

function drawText(context: CanvasRenderingContext2D, viewport: ViewportLike, annotation: TextAnnotation): void {
  const origin = toCanvas(viewport, annotation.x, annotation.y);
  context.save();
  context.translate(origin.x, origin.y);
  context.rotate((viewport.rotation * Math.PI) / 180);
  context.font = `${annotation.size * viewport.scale}px ${FONT_STACK}`;
  context.fillStyle = annotation.color;
  context.textBaseline = 'alphabetic';
  const lineStep = annotation.size * LINE_HEIGHT * viewport.scale;
  annotation.lines.forEach((line, index) => context.fillText(line, 0, index * lineStep));
  context.restore();
}

function drawHighlight(context: CanvasRenderingContext2D, viewport: ViewportLike, annotation: HighlightAnnotation): void {
  const corner1 = toCanvas(viewport, annotation.x, annotation.y);
  const corner2 = toCanvas(viewport, annotation.x + annotation.width, annotation.y + annotation.height);
  context.save();
  context.globalAlpha = HIGHLIGHT_OPACITY;
  context.fillStyle = annotation.color;
  context.fillRect(
    Math.min(corner1.x, corner2.x),
    Math.min(corner1.y, corner2.y),
    Math.abs(corner2.x - corner1.x),
    Math.abs(corner2.y - corner1.y),
  );
  context.restore();
}

function drawInk(context: CanvasRenderingContext2D, viewport: ViewportLike, annotation: InkAnnotation): void {
  const points = annotation.points.map((point) => toCanvas(viewport, point.x, point.y));
  const [first] = points;
  if (!first) return;
  context.save();
  context.strokeStyle = annotation.color;
  context.fillStyle = annotation.color;
  context.lineWidth = annotation.thickness * viewport.scale;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  if (points.length === 1) {
    // Un punto suelto: un círculo del grosor del trazo.
    context.beginPath();
    context.arc(first.x, first.y, context.lineWidth / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.beginPath();
    context.moveTo(first.x, first.y);
    for (const point of points.slice(1)) context.lineTo(point.x, point.y);
    context.stroke();
  }
  context.restore();
}
