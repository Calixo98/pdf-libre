import { decryptPdf, isEncryptedPdf, isPdfFile, PdfUnlockError } from '../lib/pdf-unlock';
import { baseName, downloadBytes } from '../lib/download';
import { errorMessage, formatBytes, readFileBytes, requireElement, setStatus } from '../ui/common';
import { assertFileSize, InputLimitError, LIMITS } from '../lib/limits';
import { describeReport, sanitizePdfBytes, totalRemoved } from '../lib/pdf-sanitize';

interface LoadedPdf {
  name: string;
  size: number;
  bytes: Uint8Array;
}

const dropzone = requireElement<HTMLDivElement>('dropzone');
const pickButton = requireElement<HTMLButtonElement>('pick-btn');
const fileInput = requireElement<HTMLInputElement>('file-input');
const resultPanel = requireElement<HTMLElement>('result-panel');
const fileNameLabel = requireElement<HTMLElement>('file-name');
const fileSizeLabel = requireElement<HTMLElement>('file-size');
const passwordForm = requireElement<HTMLFormElement>('password-form');
const passwordInput = requireElement<HTMLInputElement>('password-input');
const unlockButton = requireElement<HTMLButtonElement>('unlock-btn');
const downloadArea = requireElement<HTMLElement>('download-area');
const downloadButton = requireElement<HTMLButtonElement>('download-btn');
const sanitizeCheckbox = requireElement<HTMLInputElement>('sanitize-checkbox');
const status = requireElement<HTMLElement>('status');

let loaded: LoadedPdf | null = null;
let unlocked: Uint8Array | null = null;
let busy = false;

pickButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (file) void loadFile(file);
});

dropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropzone.classList.add('is-dragover');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropzone.classList.remove('is-dragover');
  const file = event.dataTransfer?.files[0];
  if (file) void loadFile(file);
});
// Soltar un archivo fuera de la zona no debe abrirlo en la pestaña (el navegador lo haría).
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

passwordForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void unlockWithPassword(passwordInput.value);
});

downloadButton.addEventListener('click', () => void download());

/**
 * Descarga el PDF desbloqueado. Por defecto se quita antes el contenido activo
 * (JavaScript, acciones automáticas, adjuntos…): este sitio no lo ejecuta, pero
 * el lector con el que se abra el archivo después sí podría.
 */
async function download(): Promise<void> {
  if (!loaded || !unlocked || busy) return;
  const name = `${baseName(loaded.name)}-desbloqueado.pdf`;
  if (!sanitizeCheckbox.checked) {
    downloadBytes(unlocked, name, 'application/pdf');
    return;
  }
  busy = true;
  downloadButton.disabled = true;
  setStatus(status, 'Revisando y limpiando el contenido activo del PDF…');
  try {
    const { bytes, report } = await sanitizePdfBytes(unlocked);
    downloadBytes(bytes, name, 'application/pdf');
    const removed = totalRemoved(report);
    setStatus(
      status,
      removed > 0
        ? `PDF descargado. Por seguridad se quitó: ${describeReport(report)}.`
        : 'PDF descargado. No tenía contenido activo (scripts, adjuntos ni acciones automáticas).',
      'ok',
    );
  } catch (error) {
    console.error(error);
    setStatus(
      status,
      'No se pudo revisar el contenido activo de este PDF. Si confías en el archivo, desmarca la limpieza y descárgalo sin ella.',
      'error',
    );
  } finally {
    busy = false;
    downloadButton.disabled = false;
  }
}

async function loadFile(file: File): Promise<void> {
  if (busy) return;
  busy = true;
  unlocked = null;
  try {
    assertFileSize(file, LIMITS.maxPdfBytes);
    loaded = { name: file.name, size: file.size, bytes: await readFileBytes(file) };
  } catch (error) {
    busy = false;
    if (!(error instanceof InputLimitError)) console.error(error);
    const message = error instanceof InputLimitError ? error.message : `No se pudo leer "${file.name}": ${errorMessage(error)}`;
    setStatus(status, message, 'error');
    return;
  }
  resultPanel.hidden = false;
  fileNameLabel.textContent = loaded.name;
  fileSizeLabel.textContent = formatBytes(loaded.size);
  passwordForm.hidden = true;
  downloadArea.hidden = true;
  passwordInput.value = '';
  setStatus(status, 'Revisando el PDF…');

  try {
    if (!isPdfFile(loaded.bytes)) {
      setStatus(status, `"${loaded.name}" no parece un PDF.`, 'error');
      return;
    }
    if (!(await isEncryptedPdf(loaded.bytes))) {
      setStatus(status, 'Este PDF no tiene contraseña ni restricciones. No hay nada que quitar.', 'ok');
      return;
    }
    // Primero se intenta sin contraseña: así se quitan también las restricciones de propietario.
    unlocked = await decryptPdf(loaded.bytes, '');
    showDownload('Listo: el PDF ya no tiene contraseña ni restricciones.', 'ok');
  } catch (error) {
    if (error instanceof PdfUnlockError) {
      passwordForm.hidden = false;
      passwordInput.focus();
      setStatus(
        status,
        'No se pudo abrir sin contraseña. Si el PDF tiene contraseña, escríbela. Si no la tiene, el archivo puede estar dañado.',
      );
    } else {
      console.error(error);
      setStatus(status, `No se pudo leer este PDF: ${errorMessage(error)}`, 'error');
    }
  } finally {
    busy = false;
  }
}

async function unlockWithPassword(password: string): Promise<void> {
  if (!loaded || busy) return;
  if (password.length > LIMITS.maxPasswordLength) {
    setStatus(status, 'La contraseña es demasiado larga.', 'error');
    return;
  }
  busy = true;
  unlockButton.disabled = true;
  setStatus(status, 'Desbloqueando…');

  try {
    unlocked = await decryptPdf(loaded.bytes, password);
    passwordInput.value = '';
    passwordForm.hidden = true;
    showDownload('Contraseña correcta. Ya puedes descargar el PDF sin protección.', 'ok');
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

function showDownload(message: string, tone: 'ok' | 'info'): void {
  downloadArea.hidden = false;
  setStatus(status, message, tone);
}
