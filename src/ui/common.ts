/** Obtiene un elemento por id y falla en voz alta si la página no lo tiene. */
export function requireElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Falta el elemento #${id} en la página`);
  return element as T;
}

export type StatusTone = 'info' | 'ok' | 'error';

/** Muestra un mensaje de estado. Usa textContent, nunca HTML, para que nada del archivo se interprete como código. */
export function setStatus(element: HTMLElement, text: string, tone: StatusTone = 'info'): void {
  element.textContent = text;
  element.dataset['tone'] = tone;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Lee un archivo como bytes; usado por todas las herramientas antes de procesarlo. */
export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
