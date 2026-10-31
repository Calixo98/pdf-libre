import {
  imagesToPdf,
  type ImagesToPdfOptions,
  type OrientationOption,
  type PageSizeOption,
  type PdfImage,
} from '../lib/images-to-pdf';
import { prepareImage } from '../lib/image-prep';
import { baseName, downloadBytes } from '../lib/download';
import { errorMessage, formatBytes, requireElement, setStatus } from '../ui/common';
import { InputLimitError, LIMITS } from '../lib/limits';

interface ImageItem {
  id: number;
  file: File;
  previewUrl: string;
}

const dropzone = requireElement<HTMLDivElement>('dropzone');
const pickButton = requireElement<HTMLButtonElement>('pick-btn');
const fileInput = requireElement<HTMLInputElement>('file-input');
const listPanel = requireElement<HTMLElement>('list-panel');
const countLabel = requireElement<HTMLElement>('count');
const fileList = requireElement<HTMLUListElement>('file-list');
const pageSizeSelect = requireElement<HTMLSelectElement>('page-size');
const orientationSelect = requireElement<HTMLSelectElement>('orientation');
const marginSelect = requireElement<HTMLSelectElement>('margin');
const createButton = requireElement<HTMLButtonElement>('create-btn');
const clearButton = requireElement<HTMLButtonElement>('clear-btn');
const status = requireElement<HTMLElement>('status');

const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png']);
const SUPPORTED_EXTENSIONS = /\.(jpe?g|png)$/i;

let items: ImageItem[] = [];
let nextId = 1;
let busy = false;

pickButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  fileInput.value = '';
});

dropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropzone.classList.add('is-dragover');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropzone.classList.remove('is-dragover');
  addFiles(event.dataTransfer?.files ?? null);
});
// Soltar un archivo fuera de la zona no debe abrirlo en la pestaña (el navegador lo haría).
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

pageSizeSelect.addEventListener('change', syncFitOptions);
syncFitOptions();

createButton.addEventListener('click', () => void createPdf());
clearButton.addEventListener('click', () => {
  revokeAllPreviews();
  items = [];
  render();
  setStatus(status, '');
});
window.addEventListener('pagehide', revokeAllPreviews);

function addFiles(files: FileList | null): void {
  if (!files) return;
  if (busy) {
    setStatus(status, 'Espera a que termine de crearse el PDF para agregar imágenes.');
    return;
  }
  const rejected: string[] = [];
  const tooBig: string[] = [];
  let overLimit = 0;
  let totalBytes = items.reduce((sum, item) => sum + item.file.size, 0);
  for (const file of Array.from(files)) {
    if (!isSupported(file)) {
      rejected.push(file.name);
      continue;
    }
    if (file.size === 0 || file.size > LIMITS.maxImageBytes) {
      tooBig.push(file.name);
      continue;
    }
    if (items.length >= LIMITS.maxImages || totalBytes + file.size > LIMITS.maxTotalImageBytes) {
      overLimit++;
      continue;
    }
    totalBytes += file.size;
    items.push({ id: nextId++, file, previewUrl: URL.createObjectURL(file) });
  }
  render();
  const problems: string[] = [];
  if (rejected.length > 0) problems.push(`Se omitieron (solo JPG o PNG): ${listNames(rejected)}.`);
  if (tooBig.length > 0) {
    problems.push(`Se omitieron por tamaño (vacías o de más de ${formatBytes(LIMITS.maxImageBytes)}): ${listNames(tooBig)}.`);
  }
  if (overLimit > 0) {
    problems.push(
      `Se omitieron ${overLimit} imagen(es): el máximo es ${LIMITS.maxImages} imágenes y ${formatBytes(
        LIMITS.maxTotalImageBytes,
      )} en total por PDF.`,
    );
  }
  setStatus(status, problems.join(' '), problems.length > 0 ? 'error' : 'info');
}

/** Lista corta de nombres para los avisos (un usuario puede soltar cientos de archivos). */
function listNames(names: string[]): string {
  const shown = names.slice(0, 5).join(', ');
  return names.length > 5 ? `${shown} y ${names.length - 5} más` : shown;
}

function isSupported(file: File): boolean {
  return SUPPORTED_TYPES.has(file.type) || SUPPORTED_EXTENSIONS.test(file.name);
}

function render(): void {
  fileList.replaceChildren(...items.map((item, index) => renderItem(item, index)));
  // Mientras se crea el PDF la lista queda bloqueada para que no cambie el orden a mitad de proceso.
  fileList.inert = busy;
  countLabel.textContent = String(items.length);
  listPanel.hidden = items.length === 0;
  createButton.disabled = items.length === 0 || busy;
  clearButton.disabled = busy;
}

function renderItem(item: ImageItem, index: number): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'file-item';

  const img = document.createElement('img');
  img.src = item.previewUrl;
  img.alt = `Vista previa de ${item.file.name}`;

  const info = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'file-name';
  name.textContent = `${index + 1}. ${item.file.name}`;
  const meta = document.createElement('div');
  meta.className = 'file-meta';
  meta.textContent = formatBytes(item.file.size);
  info.append(name, meta);

  const actions = document.createElement('div');
  actions.className = 'file-actions';
  actions.append(
    actionButton('↑', `Subir ${item.file.name}`, index === 0, () => move(index, index - 1)),
    actionButton('↓', `Bajar ${item.file.name}`, index === items.length - 1, () => move(index, index + 1)),
    actionButton('✕', `Quitar ${item.file.name}`, false, () => remove(item.id)),
  );

  li.append(img, info, actions);
  return li;
}

function actionButton(label: string, ariaLabel: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-small btn-icon';
  button.textContent = label;
  button.setAttribute('aria-label', ariaLabel);
  button.disabled = disabled;
  button.addEventListener('click', onClick);
  return button;
}

function move(from: number, to: number): void {
  const [moved] = items.splice(from, 1);
  if (!moved) return;
  items.splice(to, 0, moved);
  render();
}

function remove(id: number): void {
  const item = items.find((candidate) => candidate.id === id);
  if (item) URL.revokeObjectURL(item.previewUrl);
  items = items.filter((candidate) => candidate.id !== id);
  render();
}

function revokeAllPreviews(): void {
  for (const item of items) URL.revokeObjectURL(item.previewUrl);
}

async function createPdf(): Promise<void> {
  busy = true;
  render();
  try {
    const images: PdfImage[] = [];
    const warnings: string[] = [];
    for (const [index, item] of items.entries()) {
      setStatus(status, `Preparando imagen ${index + 1} de ${items.length}…`);
      const prepared = await prepareImage(item.file);
      images.push(prepared.image);
      if (prepared.warning) warnings.push(prepared.warning);
    }

    setStatus(status, 'Creando el PDF…');
    const bytes = await imagesToPdf(images, readOptions());
    downloadBytes(bytes, outputName(), 'application/pdf');

    const summary = `PDF creado con ${images.length} página(s), ${formatBytes(bytes.byteLength)}.`;
    setStatus(status, warnings.length > 0 ? `${summary} ${warnings.join(' ')}` : summary, warnings.length > 0 ? 'info' : 'ok');
  } catch (error) {
    if (!(error instanceof InputLimitError)) console.error(error);
    setStatus(status, `No se pudo crear el PDF: ${errorMessage(error)}`, 'error');
  } finally {
    busy = false;
    render();
  }
}

/** "Ajustar a la imagen" no usa margen ni orientación: se desactivan para que no parezcan activos. */
function syncFitOptions(): void {
  const fit = pageSizeSelect.value === 'fit';
  marginSelect.disabled = fit;
  orientationSelect.disabled = fit;
}

function readOptions(): ImagesToPdfOptions {
  return {
    pageSize: pageSizeSelect.value as PageSizeOption,
    orientation: orientationSelect.value as OrientationOption,
    marginMm: Number(marginSelect.value),
  };
}

function outputName(): string {
  const [first] = items;
  return items.length === 1 && first ? `${baseName(first.file.name)}.pdf` : 'imagenes.pdf';
}
