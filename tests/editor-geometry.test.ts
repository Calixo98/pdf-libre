import { describe, expect, it } from 'vitest';
import {
  annotationContains,
  distanceToPolyline,
  distanceToSegment,
  findAnnotationAt,
  textRect,
} from '../src/editor/geometry';
import type { Annotation, TextAnnotation } from '../src/editor/model';

// Ancho fijo: cada carácter mide 0.5 puntos por punto de tamaño.
const measure = (text: string, size: number) => text.length * size * 0.5;

describe('geometría de anotaciones', () => {
  it('calcula el rectángulo de un texto de varias líneas', () => {
    const text: TextAnnotation = { kind: 'text', id: 1, x: 100, y: 500, lines: ['abcd', 'ab'], size: 10, color: '#000000' };

    const rect = textRect(text, measure);

    expect(rect.x).toBe(100);
    expect(rect.width).toBe(20); // la línea más larga: 4 caracteres de 5 pt
    // Desde los descendentes de la última línea hasta la altura de mayúsculas de la primera.
    expect(rect.y).toBeCloseTo(500 - 12 - 2.5, 6);
    expect(rect.y + rect.height).toBeCloseTo(500 + 8, 6);
  });

  it('mide la distancia a un segmento, incluidos sus extremos', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(distanceToSegment({ x: 5, y: 3 }, a, b)).toBeCloseTo(3, 6);
    expect(distanceToSegment({ x: 13, y: 4 }, a, b)).toBeCloseTo(5, 6);
    expect(distanceToSegment({ x: 2, y: 2 }, a, a)).toBeCloseTo(Math.sqrt(8), 6);
  });

  it('mide la distancia a una polilínea y a un solo punto', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(distanceToPolyline({ x: 12, y: 5 }, line)).toBeCloseTo(2, 6);
    expect(distanceToPolyline({ x: 3, y: 4 }, [{ x: 0, y: 0 }])).toBeCloseTo(5, 6);
    expect(distanceToPolyline({ x: 0, y: 0 }, [])).toBe(Infinity);
  });

  it('un trazo cuenta como tocado dentro de su grosor más la tolerancia', () => {
    const ink: Annotation = {
      kind: 'ink',
      id: 2,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      thickness: 4,
      color: '#000000',
    };
    expect(annotationContains(ink, { x: 50, y: 3 }, 1, measure)).toBe(true);
    expect(annotationContains(ink, { x: 50, y: 5 }, 1, measure)).toBe(false);
  });

  it('devuelve la anotación superior cuando hay varias bajo el punto', () => {
    const lower: Annotation = { kind: 'highlight', id: 1, x: 0, y: 0, width: 100, height: 100, color: '#ffd400' };
    const upper: Annotation = { kind: 'highlight', id: 2, x: 10, y: 10, width: 20, height: 20, color: '#ffd400' };

    const hit = findAnnotationAt([lower, upper], { x: 15, y: 15 }, 0, measure);

    expect(hit?.id).toBe(2);
    expect(findAnnotationAt([lower, upper], { x: 500, y: 500 }, 0, measure)).toBeUndefined();
  });
});
