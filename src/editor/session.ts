import { normalizeRotation, type Annotation, type AnnotationDraft, type EditorPage } from './model';

/** Qué cambió, para que la interfaz sólo repinte lo necesario. */
export type SessionEvent =
  | { type: 'annotations'; pageIndex: number }
  | { type: 'rotation'; pageIndex: number }
  | { type: 'structure' }
  | { type: 'saved' };

type Undo = () => SessionEvent;
type Listener = (event: SessionEvent) => void;

/**
 * Estado del editor: páginas (orden, giro y anotaciones) con historial para
 * deshacer. Cada cambio guarda cómo revertirse; deshacer en orden inverso
 * siempre devuelve índices válidos.
 */
export class EditorSession {
  readonly pages: EditorPage[];

  private readonly undoStack: Undo[] = [];
  private readonly listeners = new Set<Listener>();
  private nextId = 1;
  private changed = false;

  constructor(pageCount: number) {
    this.pages = Array.from({ length: pageCount }, (_, sourceIndex) => ({
      sourceIndex,
      rotation: 0,
      annotations: [],
    }));
  }

  get hasChanges(): boolean {
    return this.changed;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  addAnnotation(pageIndex: number, draft: AnnotationDraft): Annotation | null {
    const page = this.pages[pageIndex];
    if (!page) return null;

    const annotation = { ...draft, id: this.nextId++ } as Annotation;
    page.annotations.push(annotation);
    this.commit(
      () => {
        page.annotations = page.annotations.filter((candidate) => candidate !== annotation);
        return { type: 'annotations', pageIndex };
      },
      { type: 'annotations', pageIndex },
    );
    return annotation;
  }

  removeAnnotation(pageIndex: number, id: number): void {
    const page = this.pages[pageIndex];
    if (!page) return;
    const position = page.annotations.findIndex((annotation) => annotation.id === id);
    if (position < 0) return;

    const [removed] = page.annotations.splice(position, 1);
    if (!removed) return;
    this.commit(
      () => {
        page.annotations.splice(position, 0, removed);
        return { type: 'annotations', pageIndex };
      },
      { type: 'annotations', pageIndex },
    );
  }

  rotatePage(pageIndex: number, quarterTurns: 1 | -1): void {
    const page = this.pages[pageIndex];
    if (!page) return;
    const previous = page.rotation;
    page.rotation = normalizeRotation(previous + 90 * quarterTurns);
    this.commit(
      () => {
        page.rotation = previous;
        return { type: 'rotation', pageIndex };
      },
      { type: 'rotation', pageIndex },
    );
  }

  /** Mueve la página una posición. Devuelve su nuevo índice. */
  movePage(pageIndex: number, delta: 1 | -1): number {
    const target = pageIndex + delta;
    if (target < 0 || target >= this.pages.length) return pageIndex;
    this.swapPages(pageIndex, target);
    this.commit(
      () => {
        this.swapPages(pageIndex, target);
        return { type: 'structure' };
      },
      { type: 'structure' },
    );
    return target;
  }

  /** Quita una página. No se pueden quitar todas: el PDF final necesita al menos una. */
  deletePage(pageIndex: number): boolean {
    if (this.pages.length <= 1) return false;
    const [removed] = this.pages.splice(pageIndex, 1);
    if (!removed) return false;
    this.commit(
      () => {
        this.pages.splice(pageIndex, 0, removed);
        return { type: 'structure' };
      },
      { type: 'structure' },
    );
    return true;
  }

  undo(): void {
    const undo = this.undoStack.pop();
    if (!undo) return;
    this.emit(undo());
  }

  markSaved(): void {
    this.changed = false;
    this.emit({ type: 'saved' });
  }

  private swapPages(a: number, b: number): void {
    const first = this.pages[a];
    const second = this.pages[b];
    if (!first || !second) return;
    this.pages[a] = second;
    this.pages[b] = first;
  }

  private commit(undo: Undo, event: SessionEvent): void {
    this.undoStack.push(undo);
    this.changed = true;
    this.emit(event);
  }

  private emit(event: SessionEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
