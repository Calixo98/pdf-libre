import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';
import { decryptPdf, isEncryptedPdf, isPdfFile, PdfUnlockError } from '../lib/pdf-unlock';
import { openPdfDocument, type PDFDocumentLoadingTask } from '../lib/pdfjs';
import { baseName, downloadBytes } from '../lib/download';
import { errorMessage, formatBytes, readFileBytes, requireElement, setStatus } from '../ui/common';
import { exportEditedPdf } from '../editor/export';
import { PageView } from '../editor/page-view';
import { EditorSession, type SessionEvent } from '../editor/session';
import { ThumbnailList } from '../editor/thumbnails';
import type { ToolId, ToolSettings } from '../editor/model';

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
const DEFAULT_ZOOM_INDEX = ZOOM_LEVELS.indexOf(1.25);

const status = requireElement<HTMLElement>('status');
const openView = requireElement<HTMLElement>('open-view');
const editorView = requireElement<HTMLElement>('editor-view');
const dropzone = requireElement<HTMLDivElement>('dropzone');
const pickButton = requireElement<HTMLButtonElement>('pick-btn');
const fileInput = requireElement<HTMLInputElement>('file-input');
const passwordPanel = requireElement<HTMLElement>('password-panel');
const passwordForm = requireElement<HTMLFormElement>('password-form');
const passwordInput = requireElement<HTMLInputElement>('password-input');
const unlockButton = requireElement<HTMLButtonElement>('unlock-btn');
const fileNameLabel = requireElement<HTMLElement>('file-name');
const openAnotherButton = requireElement<HTMLButtonElement>('open-another-btn');
const undoButton = requireElement<HTMLButtonElement>('undo-btn');
const downloadButton = requireElement<HTMLButtonElement>('download-btn');
const thumbsContainer = requireElement<HTMLElement>('thumbs');
const pageWrap = requireElement<HTMLElement>('page-wrap');
const pageCanvas = requireElement<HTMLCanvasElement>('page-canvas');
const overlay = requireElement<HTMLCanvasElement>('overlay');
const prevButton = requireElement<HTMLButtonElement>('prev-btn');
const nextButton = requireElement<HTMLButtonElement>('next-btn');
const pageLabel = requireElement<HTMLElement>('page-label');
const rotateLeftButton = requireElement<HTMLButtonElement>('rotate-left-btn');
const rotateRightButton = requireElement<HTMLButtonElement>('rotate-right-btn');
const deletePageButton = requireElement<HTMLButtonElement>('delete-page-btn');
const zoomOutButton = requireElement<HTMLButtonElement>('zoom-out-btn');
const zoomInButton = requireElement<HTMLButtonElement>('zoom-in-btn');
const zoomLabel = requireElement<HTMLElement>('zoom-label');
const textColorInput = requireElement<HTMLInputElement>('text-color');
const highlightColorInput = requireElement<HTMLInputElement>('highlight-color');
const textSizeSelect = requireElement<HTMLSelectElement>('text-size');
const inkWidthSelect = requireElement<HTMLSelectElement>('ink-width');

const settings: ToolSettings = {
  tool: 'navigate',
  textColor: textColorInput.value,
  highlightColor: highlightColorInput.value,
  textSize: Number(textSizeSelect.value),
  inkWidth: Number(inkWidthSelect.value),
};

let fileName = '';
/** PDF sin cifrar sobre el que se exporta. */
let sourceBytes: Uint8Array | null = null;
/** PDF cifrado que espera la contraseña del usuario. */
let pendingEncrypted: Uint8Array | null = null;
let loadingTask: PDFDocumentLoadingTask | null = null;
let session: EditorSession | null = null;
let zoomIndex = DEFAULT_ZOOM_INDEX;
let busy = false;
/** Fuente usada sólo para comprobar qué caracteres admite el PDF. */
let textFont: PDFFont | null = null;

const pageView = new PageView({
  canvas: pageCanvas,
  overlay,
  wrap: pageWrap,
  settings,
  canEncodeText: canEncodeLine,
  report: (message, tone) => setStatus(status, message, tone),
});

const thumbs = new ThumbnailList(thumbsContainer, {
  onSelect: (index) => goToPage(index),
  onMove: (index, delta) => {
    if (!session) return;
    goToPage(session.movePage(index, delta));
  },
  onDelete: (index) => {
    if (!session) return;
    if (!window.confirm(`¿Quitar la página ${index + 1} del PDF?`)) return;
    session.deletePage(index);
  },
});

// --- Apertura del archivo ---

dropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropzone.classList.add('is-dragover');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropzone.classList.remove('is-dragover');
  const file = event.dataTransfer?.files[0];
  if (file) void openFile(file);
});
// Soltar un archivo fuera de la zona no debe abrirlo en la pestaña y perder el trabajo.
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());
pickButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (file) void openFile(file);
});

passwordForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void unlockPending(passwordInput.value);
});

openAnotherButton.addEventListener('click', () => {
  if (session?.hasChanges && !window.confirm('Hay cambios sin descargar. ¿Abrir otro PDF de todos modos?')) return;
  showOpenView();
});

// --- Herramientas, página y zoom ---

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="tool"]')) {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    setTool(radio.value as ToolId);
  });
}
textColorInput.addEventListener('input', () => (settings.textColor = textColorInput.value));
highlightColorInput.addEventListener('input', () => (settings.highlightColor = highlightColorInput.value));
textSizeSelect.addEventListener('change', () => (settings.textSize = Number(textSizeSelect.value)));
inkWidthSelect.addEventListener('change', () => (settings.inkWidth = Number(inkWidthSelect.value)));

prevButton.addEventListener('click', () => goToPage(pageView.currentPageIndex - 1));
nextButton.addEventListener('click', () => goToPage(pageView.currentPageIndex + 1));
rotateLeftButton.addEventListener('click', () => rotateCurrent(-1));
rotateRightButton.addEventListener('click', () => rotateCurrent(1));
deletePageButton.addEventListener('click', () => {
  if (!session) return;
  const index = pageView.currentPageIndex;
  if (!window.confirm(`¿Quitar la página ${index + 1} del PDF?`)) return;
  session.deletePage(index);
});
zoomOutButton.addEventListener('click', () => setZoom(zoomIndex - 1));
zoomInButton.addEventListener('click', () => setZoom(zoomIndex + 1));

undoButton.addEventListener('click', () => session?.undo());
downloadButton.addEventListener('click', () => void exportAndDownload());

document.addEventListener('keydown', (event) => {
  if (editorView.hidden) return;
  const typing = event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement;
  if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    session?.undo();
  }
});

window.addEventListener('beforeunload', (event) => {
  if (session?.hasChanges) event.preventDefault();
});

// --- Funciones ---

async function openFile(file: File): Promise<void> {
  if (busy) return;
  busy = true;
  fileName = file.name;
  try {
    setStatus(status, 'Abriendo el PDF…');
    const bytes = await readFileBytes(file);
    if (!isPdfFile(bytes)) throw new Error(`"${file.name}" no parece un PDF.`);
    const source = await removeProtectionIfPossible(bytes);
    if (source) {
      await startEditor(source);
    } else {
      pendingEncrypted = bytes;
      passwordPanel.hidden = false;
      passwordInput.focus();
      setStatus(
        status,
        'No se pudo abrir sin contraseña. Si el PDF tiene contraseña, escríbela. Si no la tiene, el archivo puede estar dañado.',
      );
    }
  } catch (error) {
    console.error(error);
    setStatus(status, `No se pudo abrir el PDF: ${errorMessage(error)}`, 'error');
  } finally {
    busy = false;
  }
}

/** Devuelve el PDF sin cifrar, o null si necesita contraseña. */
async function removeProtectionIfPossible(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (!(await isEncryptedPdf(bytes))) return bytes;
  try {
    return await decryptPdf(bytes, '');
  } catch (error) {
    if (error instanceof PdfUnlockError) return null;
    throw error;
  }
}

async function unlockPending(password: string): Promise<void> {
  if (!pendingEncrypted || busy) return;
  busy = true;
  unlockButton.disabled = true;
  setStatus(status, 'Desbloqueando…');
  try {
    const source = await decryptPdf(pendingEncrypted, password);
    pendingEncrypted = null;
    passwordInput.value = '';
    passwordPanel.hidden = true;
    await startEditor(source);
  } catch (error) {
    if (error instanceof PdfUnlockError) {
      passwordInput.select();
      setStatus(
        status,
        'No se pudo abrir con esa contraseña. Revísala e inténtalo de nuevo. Si es correcta, el archivo podría estar dañado.',
        'error',
      );
    } else {
      console.error(error);
      setStatus(status, `No se pudo desbloquear el PDF: ${errorMessage(error)}`, 'error');
    }
  } finally {
    busy = false;
    unlockButton.disabled = false;
  }
}

async function startEditor(source: Uint8Array): Promise<void> {
  setStatus(status, 'Preparando el editor…');
  await ensureTextFont();
  const task = openPdfDocument(source);
  const loaded = await task.promise;

  const previous = loadingTask;
  loadingTask = task;
  sourceBytes = source;
  session = new EditorSession(loaded.numPages);
  session.subscribe(onSessionEvent);
  pageView.attach(loaded, session);
  thumbs.attach(loaded, session);
  void previous?.destroy();

  fileNameLabel.textContent = fileName;
  openView.hidden = true;
  editorView.hidden = false;
  setStatus(status, '');
  thumbs.rebuild();
  setTool('navigate');
  setZoom(zoomIndex); // dibuja la primera página y actualiza los controles
}

function showOpenView(): void {
  setTool('navigate');
  editorView.hidden = true;
  openView.hidden = false;
  setStatus(status, '');
}

function onSessionEvent(event: SessionEvent): void {
  if (!session) return;
  switch (event.type) {
    case 'annotations':
      if (event.pageIndex === pageView.currentPageIndex) pageView.redrawOverlay();
      break;
    case 'rotation':
      thumbs.refresh(event.pageIndex);
      if (event.pageIndex === pageView.currentPageIndex) void pageView.render();
      break;
    case 'structure': {
      const last = session.pages.length - 1;
      const current = Math.min(pageView.currentPageIndex, last);
      thumbs.rebuild();
      pageView.showPage(current);
      break;
    }
    case 'saved':
      break;
  }
  updateControls();
}

function goToPage(index: number): void {
  if (!session) return;
  const clamped = Math.max(0, Math.min(index, session.pages.length - 1));
  pageView.showPage(clamped);
  updateControls();
}

function rotateCurrent(quarterTurns: 1 | -1): void {
  session?.rotatePage(pageView.currentPageIndex, quarterTurns);
}

function setZoom(index: number): void {
  zoomIndex = Math.max(0, Math.min(index, ZOOM_LEVELS.length - 1));
  pageView.setZoom(currentZoom());
  updateControls();
}

function currentZoom(): number {
  return ZOOM_LEVELS[zoomIndex] ?? 1;
}

function setTool(tool: ToolId): void {
  settings.tool = tool;
  checkTool(tool);
  pageView.setTool(tool);
}

function checkTool(tool: ToolId): void {
  const radio = document.querySelector<HTMLInputElement>(`input[name="tool"][value="${tool}"]`);
  if (radio) radio.checked = true;
}

function updateControls(): void {
  const count = session?.pages.length ?? 0;
  const index = pageView.currentPageIndex;
  const hasSession = session !== null;

  pageLabel.textContent = `Página ${Math.min(index + 1, Math.max(count, 1))} de ${count}`;
  prevButton.disabled = !hasSession || index <= 0;
  nextButton.disabled = !hasSession || index >= count - 1;
  rotateLeftButton.disabled = !hasSession;
  rotateRightButton.disabled = !hasSession;
  deletePageButton.disabled = !hasSession || count <= 1;
  undoButton.disabled = !session?.canUndo;
  downloadButton.disabled = !hasSession || busy;
  zoomOutButton.disabled = zoomIndex <= 0;
  zoomInButton.disabled = zoomIndex >= ZOOM_LEVELS.length - 1;
  zoomLabel.textContent = `${Math.round(currentZoom() * 100)} %`;
  thumbs.setCurrent(index);
}

async function exportAndDownload(): Promise<void> {
  if (!session || !sourceBytes || busy) return;
  busy = true;
  downloadButton.disabled = true;
  setStatus(status, 'Generando el PDF editado…');
  try {
    const bytes = await exportEditedPdf(sourceBytes, session.pages);
    downloadBytes(bytes, `${baseName(fileName)}-editado.pdf`, 'application/pdf');
    session.markSaved();
    setStatus(status, `PDF descargado (${formatBytes(bytes.byteLength)}).`, 'ok');
  } catch (error) {
    console.error(error);
    setStatus(status, `No se pudo generar el PDF: ${errorMessage(error)}`, 'error');
  } finally {
    busy = false;
    updateControls();
  }
}

/** Comprueba qué caracteres admite Helvetica (WinAnsi). Lo que no admite no se puede escribir en el PDF. */
async function ensureTextFont(): Promise<void> {
  if (textFont) return;
  const validator = await PDFDocument.create({ updateMetadata: false });
  textFont = await validator.embedFont(StandardFonts.Helvetica);
}

function canEncodeLine(line: string): boolean {
  if (!textFont) return false;
  try {
    textFont.encodeText(line);
    return true;
  } catch {
    return false;
  }
}

// Estado inicial de la barra de herramientas.
updateControls();
