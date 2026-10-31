import { LINE_HEIGHT, type Annotation, type Point, type TextAnnotation } from './model';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Mide el ancho de un texto en puntos PDF para un tamaño dado. */
export type MeasureText = (text: string, size: number) => number;

/** Rectángulo aproximado que ocupa un texto, en espacio de usuario del PDF. */
export function textRect(annotation: TextAnnotation, measure: MeasureText): Rect {
  const { x, y, lines, size } = annotation;
  const lastBaseline = y - (lines.length - 1) * size * LINE_HEIGHT;
  const width = Math.max(0, ...lines.map((line) => measure(line, size)));
  const bottom = lastBaseline - size * 0.25; // descendentes
  const top = y + size * 0.8; // altura de mayúsculas aproximada
  return { x, y: bottom, width, height: top - bottom };
}

/** Distancia de un punto a un segmento. */
export function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

/** Distancia de un punto a una polilínea (un solo punto cuenta como trazo de largo cero). */
export function distanceToPolyline(point: Point, points: Point[]): number {
  const [first] = points;
  if (!first) return Infinity;
  if (points.length === 1) return Math.hypot(point.x - first.x, point.y - first.y);
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1];
    const end = points[i];
    if (start && end) best = Math.min(best, distanceToSegment(point, start, end));
  }
  return best;
}

function rectContains(rect: Rect, point: Point, tolerance: number): boolean {
  return (
    point.x >= rect.x - tolerance &&
    point.x <= rect.x + rect.width + tolerance &&
    point.y >= rect.y - tolerance &&
    point.y <= rect.y + rect.height + tolerance
  );
}

export function annotationContains(
  annotation: Annotation,
  point: Point,
  tolerance: number,
  measure: MeasureText,
): boolean {
  switch (annotation.kind) {
    case 'text':
      return rectContains(textRect(annotation, measure), point, tolerance);
    case 'highlight':
      return rectContains(annotation, point, tolerance);
    case 'ink':
      return distanceToPolyline(point, annotation.points) <= annotation.thickness / 2 + tolerance;
  }
}

/** Devuelve la anotación más alta (la dibujada al final) que está bajo el punto. */
export function findAnnotationAt(
  annotations: Annotation[],
  point: Point,
  tolerance: number,
  measure: MeasureText,
): Annotation | undefined {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const annotation = annotations[i];
    if (annotation && annotationContains(annotation, point, tolerance, measure)) return annotation;
  }
  return undefined;
}
