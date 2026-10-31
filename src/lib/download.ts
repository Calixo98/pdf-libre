/**
 * Crea un Blob a partir de bytes. Todos los bytes de este proyecto viven en un
 * ArrayBuffer normal (nunca compartido), así que el cast al tipo estricto que
 * pide TypeScript para Blob es seguro.
 */
export function toBlob(bytes: Uint8Array, type: string): Blob {
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type });
}

/** Dispara la descarga de bytes como archivo en el navegador. Todo ocurre localmente. */
export function downloadBytes(bytes: Uint8Array, filename: string, mimeType: string): void {
  const url = URL.createObjectURL(toBlob(bytes, mimeType));
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFileName(filename);
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Algunos navegadores cancelan la descarga si el blob se libera de inmediato.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** "documento.pdf" -> "documento": nombre base para los archivos generados. */
export function baseName(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return safeFileName((dot > 0 ? filename.slice(0, dot) : filename).trim());
}

const MAX_FILE_NAME_LENGTH = 120;
// Caracteres de control y de dirección (U+202E puede disfrazar "gpj.exe" como "exe.jpg").
const INVISIBLE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
const RESERVED_CHARS = /[<>:"/\\|?*]+/g;

/**
 * Nombre de archivo seguro para descargar: sin rutas, caracteres reservados de
 * Windows, caracteres de control ni marcas de dirección, y con longitud limitada.
 * El nombre viene del archivo del usuario, así que se trata como dato no confiable.
 */
export function safeFileName(name: string): string {
  const cleaned = name
    .normalize('NFC')
    .replace(INVISIBLE_CHARS, '')
    .replace(RESERVED_CHARS, '_')
    .replace(/_+/g, '_')
    .replace(/^[.\s_]+/, '')
    .replace(/[.\s]+$/, '')
    .slice(0, MAX_FILE_NAME_LENGTH)
    .trim();
  return cleaned || 'documento';
}
