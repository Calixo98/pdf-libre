// Modelo del editor. Todas las coordenadas de anotaciones están en el espacio de
// usuario del PDF (puntos, origen abajo a la izquierda, sin girar), así que
// sobreviven a los giros de página y se dibujan igual en pantalla y en el PDF final.

export type ToolId = 'navigate' | 'text' | 'highlight' | 'ink' | 'erase';

export interface Point {
  x: number;
  y: number;
}

export interface TextAnnotation {
  kind: 'text';
  id: number;
  /** Punto de la línea base de la primera línea. */
  x: number;
  y: number;
  lines: string[];
  size: number;
  color: string;
}

export interface HighlightAnnotation {
  kind: 'highlight';
  id: number;
  /** Esquina inferior izquierda del rectángulo. */
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export interface InkAnnotation {
  kind: 'ink';
  id: number;
  points: Point[];
  thickness: number;
  color: string;
}

export type Annotation = TextAnnotation | HighlightAnnotation | InkAnnotation;

/** Anotación aún sin id: el historial le asigna uno al guardarla. */
export type AnnotationDraft =
  | Omit<TextAnnotation, 'id'>
  | Omit<HighlightAnnotation, 'id'>
  | Omit<InkAnnotation, 'id'>;

export interface EditorPage {
  /** Índice (0 based) de la página en el PDF original. */
  sourceIndex: number;
  /** Giro que aplicó el usuario, sumado al /Rotate del PDF: 0, 90, 180 o 270. */
  rotation: number;
  annotations: Annotation[];
}

export interface ToolSettings {
  tool: ToolId;
  textColor: string;
  highlightColor: string;
  textSize: number;
  inkWidth: number;
}

/** Interlineado del texto, como factor del tamaño de fuente. */
export const LINE_HEIGHT = 1.2;
export const HIGHLIGHT_OPACITY = 0.35;
/** Helvetica es la fuente estándar del PDF; en pantalla usamos una métrica equivalente. */
export const FONT_STACK = 'Helvetica, Arial, sans-serif';

export function normalizeRotation(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}
