import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentLoadingTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { LIMITS } from './limits';

// El worker lo empaqueta Vite; los recursos (cMaps, fuentes estándar, WASM) se
// copian a public/pdfjs con scripts/copy-pdfjs-assets.mjs.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const ASSET_BASE = `${import.meta.env.BASE_URL}pdfjs/`;

/**
 * Abre un PDF sin cifrar para mostrarlo. Devuelve la tarea de carga: `.promise`
 * entrega el documento y `.destroy()` libera el worker y la memoria.
 */
export function openPdfDocument(bytes: Uint8Array): PDFDocumentLoadingTask {
  return pdfjs.getDocument({
    // pdf.js transfiere el buffer al worker; se pasa una copia para conservar `bytes`.
    data: bytes.slice(),
    cMapUrl: `${ASSET_BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSET_BASE}standard_fonts/`,
    wasmUrl: `${ASSET_BASE}wasm/`,
    // Endurecimiento frente a PDF maliciosos: sin formularios XFA (motor de
    // scripts propio), sin pedir fuentes del sistema y con un tope de píxeles
    // por imagen para que una imagen gigante incrustada no agote la memoria.
    // pdf.js nunca ejecuta el JavaScript de un PDF: sólo dibuja en un canvas.
    enableXfa: false,
    useSystemFonts: false,
    maxImageSize: LIMITS.maxImagePixels,
  });
}

export type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  PageViewport,
  RenderTask,
} from 'pdfjs-dist';

/** pdf.js lanza RenderingCancelledException cuando se cancela un render; no es un error real. */
export function isRenderCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'RenderingCancelledException';
}
