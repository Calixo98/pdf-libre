import { errorMessage, type StatusTone } from '../ui/common';
import { isRenderCancelled, type PageViewport, type PDFDocumentProxy, type RenderTask } from '../lib/pdfjs';
import { drawAnnotation, measureText } from './draw';
import { findAnnotationAt } from './geometry';
import { normalizeRotation, type Annotation, type Point, type ToolId, type ToolSettings } from './model';
import type { EditorSession } from './session';

/** Tolerancia para borrar: píxeles de pantalla alrededor del trazo. */
const ERASE_TOLERANCE_PX = 6;
/** Distancia mínima entre puntos de un trazo a mano alzada, en puntos PDF. */
const MIN_INK_STEP_PT = 1;

export interface PageViewOptions {
  canvas: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
  wrap: HTMLElement;
  settings: ToolSettings;
  /** Indica si el texto cabe en la codificación de la fuente Helvetica del PDF. */
  canEncodeText: (line: string) => boolean;
  report: (message: string, tone: StatusTone) => void;
}

interface Attached {
  doc: PDFDocumentProxy;
  session: EditorSession;
}

interface TextEditor {
  element: HTMLTextAreaElement;
  pageIndex: number;
  anchor: Point;
  size: number;
  color: string;
}

/**
 * Muestra una página del editor: el render de pdf.js abajo y una capa de
 * anotaciones encima en la que se dibuja y se borra con el puntero.
 */
export class PageView {
  private readonly canvas: HTMLCanvasElement;
  private readonly overlay: HTMLCanvasElement;
  private readonly wrap: HTMLElement;
  private readonly overlayContext: CanvasRenderingContext2D;
  private readonly settings: ToolSettings;
  private readonly canEncodeText: (line: string) => boolean;
  private readonly report: (message: string, tone: StatusTone) => void;

  private attached: Attached | null = null;
  private pageIndex = 0;
  private scale = 1.25;
  private devicePixelRatioUsed = 1;
  private viewport: PageViewport | null = null;
  private renderTask: RenderTask | null = null;
  private renderId = 0;
  private renderQueue: Promise<void> = Promise.resolve();
  private draft: Annotation | null = null;
  private draftStart: Point | null = null;
  private textEditor: TextEditor | null = null;

  constructor(options: PageViewOptions) {
    this.canvas = options.canvas;
    this.overlay = options.overlay;
    this.wrap = options.wrap;
    this.settings = options.settings;
    this.canEncodeText = options.canEncodeText;
    this.report = options.report;

    const context = this.overlay.getContext('2d');
    if (!context) throw new Error('El navegador no ofrece canvas 2D');
    this.overlayContext = context;

    this.overlay.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    this.overlay.addEventListener('pointermove', (event) => this.onPointerMove(event));
    this.overlay.addEventListener('pointerup', (event) => this.onPointerUp(event));
    this.overlay.addEventListener('pointercancel', () => this.cancelDraft());
  }

  get currentPageIndex(): number {
    return this.pageIndex;
  }

  /** Cambia el PDF y la sesión que se muestran (al abrir otro archivo). */
  attach(doc: PDFDocumentProxy, session: EditorSession): void {
    this.commitTextEditor();
    this.cancelDraft();
    this.attached = { doc, session };
    this.pageIndex = 0;
  }

  setZoom(scale: number): void {
    this.scale = scale;
    void this.render();
  }

  showPage(index: number): void {
    this.commitTextEditor();
    this.cancelDraft();
    this.pageIndex = index;
    void this.render();
  }

  setTool(tool: ToolId): void {
    this.commitTextEditor();
    this.cancelDraft();
    this.overlay.classList.toggle('is-active', tool !== 'navigate');
    this.overlay.classList.toggle('is-erase', tool === 'erase');
    this.redrawOverlay();
  }

  /** Vuelve a dibujar la página actual (por ejemplo, tras un giro o un zoom). */
  render(): Promise<void> {
    const id = ++this.renderId;
    this.renderTask?.cancel();
    this.viewport = null;
    this.redrawOverlay();
    // Los renders van uno detrás de otro: empezar uno nuevo mientras el anterior aún se cancela
    // sobre el mismo canvas dejaba la página en blanco después de varios zooms seguidos.
    const next = this.renderQueue.then(() => this.draw(id));
    this.renderQueue = next.catch(() => undefined);
    return next;
  }

  private async draw(id: number): Promise<void> {
    if (id !== this.renderId) return; // ya hay una petición más reciente
    const attached = this.attached;
    const entry = attached?.session.pages[this.pageIndex];
    if (!attached || !entry) return;

    let task: RenderTask | null = null;
    try {
      const page = await attached.doc.getPage(entry.sourceIndex + 1);
      if (id !== this.renderId) return;

      const viewport = page.getViewport({
        scale: this.scale,
        rotation: normalizeRotation(page.rotate + entry.rotation),
      });
      const dpr = window.devicePixelRatio || 1;
      this.sizeCanvases(viewport, dpr);

      // Con canvasContext y canvas en null, pdf.js dibuja en el contexto que se le da (forma documentada).
      const context = this.canvas.getContext('2d');
      if (!context) throw new Error('El navegador no ofrece canvas 2D');
      task = page.render({ canvasContext: context, canvas: null, viewport, transform: [dpr, 0, 0, dpr, 0, 0] });
      this.renderTask = task;
      await task.promise;
      if (id !== this.renderId) return;

      this.viewport = viewport;
      this.devicePixelRatioUsed = dpr;
      this.redrawOverlay();
    } catch (error) {
      if (isRenderCancelled(error) || id !== this.renderId) return;
      console.error(error);
      this.report(`No se pudo mostrar la página: ${errorMessage(error)}`, 'error');
    } finally {
      if (this.renderTask === task) this.renderTask = null;
    }
  }

  /** Repinta sólo las anotaciones de la página actual, sin volver a renderizarla. */
  redrawOverlay(): void {
    const context = this.overlayContext;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (!this.viewport) return;

    context.setTransform(this.devicePixelRatioUsed, 0, 0, this.devicePixelRatioUsed, 0, 0);
    const annotations = this.attached?.session.pages[this.pageIndex]?.annotations ?? [];
    for (const annotation of annotations) drawAnnotation(context, this.viewport, annotation);
    if (this.draft) drawAnnotation(context, this.viewport, this.draft);
  }

  private sizeCanvases(viewport: PageViewport, dpr: number): void {
    for (const canvas of [this.canvas, this.overlay]) {
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
    }
  }

  private onPointerDown(event: PointerEvent): void {
    if (!this.viewport || event.button !== 0) return;
    const local = this.localPoint(event);
    const point = this.toUser(local);

    switch (this.settings.tool) {
      case 'text':
        this.openTextEditor(local, point);
        return;
      case 'erase':
        this.eraseAt(point);
        return;
      case 'highlight':
        this.draftStart = point;
        this.draft = {
          kind: 'highlight',
          id: 0,
          x: point.x,
          y: point.y,
          width: 0,
          height: 0,
          color: this.settings.highlightColor,
        };
        break;
      case 'ink':
        this.draft = {
          kind: 'ink',
          id: 0,
          points: [point],
          thickness: this.settings.inkWidth,
          color: this.settings.textColor,
        };
        break;
      case 'navigate':
        return;
    }
    this.overlay.setPointerCapture(event.pointerId);
    this.redrawOverlay();
  }

  private onPointerMove(event: PointerEvent): void {
    const draft = this.draft;
    if (!draft || !this.viewport) return;
    const point = this.toUser(this.localPoint(event));

    if (draft.kind === 'highlight' && this.draftStart) {
      const start = this.draftStart;
      this.draft = {
        ...draft,
        x: Math.min(start.x, point.x),
        y: Math.min(start.y, point.y),
        width: Math.abs(point.x - start.x),
        height: Math.abs(point.y - start.y),
      };
    } else if (draft.kind === 'ink') {
      const last = draft.points[draft.points.length - 1];
      if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= MIN_INK_STEP_PT) {
        this.draft = { ...draft, points: [...draft.points, point] };
      }
    }
    this.redrawOverlay();
  }

  private onPointerUp(event: PointerEvent): void {
    const draft = this.draft;
    if (!draft) return;
    if (this.overlay.hasPointerCapture(event.pointerId)) this.overlay.releasePointerCapture(event.pointerId);
    this.draft = null;
    this.draftStart = null;

    const session = this.attached?.session;
    if (session && draft.kind === 'highlight' && draft.width >= 1 && draft.height >= 1) {
      session.addAnnotation(this.pageIndex, {
        kind: 'highlight',
        x: draft.x,
        y: draft.y,
        width: draft.width,
        height: draft.height,
        color: draft.color,
      });
    } else if (session && draft.kind === 'ink' && draft.points.length >= 2) {
      session.addAnnotation(this.pageIndex, {
        kind: 'ink',
        points: draft.points,
        thickness: draft.thickness,
        color: draft.color,
      });
    }
    this.redrawOverlay();
  }

  private cancelDraft(): void {
    this.draft = null;
    this.draftStart = null;
  }

  private eraseAt(point: Point): void {
    const viewport = this.viewport;
    const session = this.attached?.session;
    const page = session?.pages[this.pageIndex];
    if (!viewport || !session || !page) return;
    const hit = findAnnotationAt(
      page.annotations,
      point,
      ERASE_TOLERANCE_PX / viewport.scale,
      (text, size) => measureText(this.overlayContext, text, size),
    );
    if (hit) session.removeAnnotation(this.pageIndex, hit.id);
  }

  private openTextEditor(local: Point, anchor: Point): void {
    this.commitTextEditor();

    const fontPx = this.settings.textSize * this.scale;
    const element = document.createElement('textarea');
    element.className = 'text-input';
    element.rows = 1;
    element.setAttribute('aria-label', 'Texto que se añadirá a la página');
    // La línea base del texto cae en el punto donde se hizo clic.
    element.style.left = `${local.x}px`;
    element.style.top = `${local.y - fontPx * 0.9}px`;
    element.style.fontSize = `${fontPx}px`;
    element.style.color = this.settings.textColor;
    element.addEventListener('keydown', (event) => this.onTextKeydown(event, element));
    element.addEventListener('blur', () => this.commitTextEditor(element));

    this.textEditor = {
      element,
      pageIndex: this.pageIndex,
      anchor,
      size: this.settings.textSize,
      color: this.settings.textColor,
    };
    this.wrap.append(element);
    element.focus();
  }

  private onTextKeydown(event: KeyboardEvent, element: HTMLTextAreaElement): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeTextEditor(element);
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.commitTextEditor(element);
    }
  }

  /** Guarda el texto escrito como anotación. Si la fuente no admite algún carácter, deja el cuadro abierto. */
  private commitTextEditor(target?: HTMLTextAreaElement): void {
    const editor = this.textEditor;
    if (!editor || (target && target !== editor.element)) return;

    const lines = trimTrailingEmptyLines(editor.element.value);
    if (lines.length === 0) {
      this.closeTextEditor(editor.element);
      return;
    }
    if (!lines.every((line) => this.canEncodeText(line))) {
      this.report(
        'Ese texto tiene caracteres que el PDF no admite con esta fuente (por ejemplo emojis o letras griegas). Cámbialos y vuelve a intentarlo.',
        'error',
      );
      editor.element.focus();
      return;
    }

    this.closeTextEditor(editor.element);
    this.attached?.session.addAnnotation(editor.pageIndex, {
      kind: 'text',
      x: editor.anchor.x,
      y: editor.anchor.y,
      lines,
      size: editor.size,
      color: editor.color,
    });
  }

  private closeTextEditor(element: HTMLTextAreaElement): void {
    if (this.textEditor?.element !== element) return;
    // Se limpia antes de quitar el elemento: quitarlo puede disparar blur y ese commit debe ignorarse.
    this.textEditor = null;
    element.remove();
  }

  private localPoint(event: PointerEvent): Point {
    const rect = this.overlay.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private toUser(local: Point): Point {
    const viewport = this.viewport;
    if (!viewport) return local;
    const point = viewport.convertToPdfPoint(local.x, local.y);
    return { x: Number(point[0]), y: Number(point[1]) };
  }
}

function trimTrailingEmptyLines(value: string): string[] {
  const lines = value.replace(/\r/g, '').split('\n');
  while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') lines.pop();
  return lines;
}
