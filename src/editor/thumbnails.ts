import { isRenderCancelled, type PDFDocumentProxy } from '../lib/pdfjs';
import { normalizeRotation } from './model';
import type { EditorSession } from './session';

const THUMB_WIDTH_PX = 120;

export interface ThumbnailCallbacks {
  onSelect(index: number): void;
  onMove(index: number, delta: 1 | -1): void;
  onDelete(index: number): void;
}

interface Attached {
  doc: PDFDocumentProxy;
  session: EditorSession;
}

/**
 * Columna de miniaturas. Cada miniatura se renderiza sólo cuando entra en
 * pantalla, así un PDF de cientos de páginas no bloquea la interfaz.
 */
export class ThumbnailList {
  private readonly container: HTMLElement;
  private readonly callbacks: ThumbnailCallbacks;
  private readonly observer: IntersectionObserver;
  private attached: Attached | null = null;
  private currentIndex = -1;

  constructor(container: HTMLElement, callbacks: ThumbnailCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const canvas = entry.target as HTMLCanvasElement;
          this.observer.unobserve(canvas);
          void this.renderThumb(Number(canvas.dataset['index']), canvas);
        }
      },
      { root: container, rootMargin: '200px 0px' },
    );
  }

  attach(doc: PDFDocumentProxy, session: EditorSession): void {
    this.attached = { doc, session };
    this.currentIndex = -1;
  }

  /** Vuelve a crear la lista (tras añadir, quitar o mover páginas). */
  rebuild(): void {
    const attached = this.attached;
    this.observer.disconnect();
    if (!attached) {
      this.container.replaceChildren();
      return;
    }

    const count = attached.session.pages.length;
    const items = Array.from({ length: count }, (_, index) => this.createItem(index, count));
    this.container.replaceChildren(...items);
    for (const item of items) {
      const canvas = item.querySelector('canvas');
      if (canvas) this.observer.observe(canvas);
    }
    this.setCurrent(this.currentIndex);
  }

  /** Vuelve a dibujar una miniatura (tras girar la página). */
  refresh(index: number): void {
    const canvas = this.container.querySelector<HTMLCanvasElement>(`canvas[data-index="${index}"]`);
    if (canvas) void this.renderThumb(index, canvas);
  }

  setCurrent(index: number): void {
    this.currentIndex = index;
    const items = this.container.querySelectorAll<HTMLElement>('.thumb');
    items.forEach((item, position) => {
      const current = position === index;
      item.classList.toggle('is-current', current);
      if (current) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    this.container.querySelector<HTMLElement>('.thumb.is-current')?.scrollIntoView({ block: 'nearest' });
  }

  private createItem(index: number, count: number): HTMLElement {
    const item = document.createElement('div');
    item.className = 'thumb';
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', `Página ${index + 1}`);
    item.addEventListener('click', () => this.callbacks.onSelect(index));
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.callbacks.onSelect(index);
      }
    });

    const canvas = document.createElement('canvas');
    canvas.dataset['index'] = String(index);
    canvas.setAttribute('aria-hidden', 'true');

    const label = document.createElement('div');
    label.className = 'thumb-label';
    const number = document.createElement('span');
    number.textContent = String(index + 1);

    const actions = document.createElement('div');
    actions.className = 'thumb-actions';
    actions.append(
      this.actionButton('↑', `Subir la página ${index + 1}`, index === 0, () => this.callbacks.onMove(index, -1)),
      this.actionButton(
        '↓',
        `Bajar la página ${index + 1}`,
        index === count - 1,
        () => this.callbacks.onMove(index, 1),
      ),
      this.actionButton('✕', `Eliminar la página ${index + 1}`, count <= 1, () => this.callbacks.onDelete(index)),
    );

    label.append(number, actions);
    item.append(canvas, label);
    return item;
  }

  private actionButton(label: string, ariaLabel: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-small btn-icon';
    button.textContent = label;
    button.setAttribute('aria-label', ariaLabel);
    button.disabled = disabled;
    button.addEventListener('click', (event) => {
      // Un botón de la miniatura no debe contar también como selección de la página.
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  private async renderThumb(index: number, canvas: HTMLCanvasElement): Promise<void> {
    const attached = this.attached;
    const entry = attached?.session.pages[index];
    if (!attached || !entry) return;

    try {
      const page = await attached.doc.getPage(entry.sourceIndex + 1);
      const rotation = normalizeRotation(page.rotate + entry.rotation);
      const natural = page.getViewport({ scale: 1, rotation });
      const viewport = page.getViewport({ scale: THUMB_WIDTH_PX / natural.width, rotation });
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);

      await page.render({ canvas, viewport, transform: [dpr, 0, 0, dpr, 0, 0] }).promise;
    } catch (error) {
      if (!isRenderCancelled(error)) console.error(error);
    }
  }
}
