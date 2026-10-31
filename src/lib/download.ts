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
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Algunos navegadores cancelan la descarga si el blob se libera de inmediato.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** "documento.pdf" -> "documento": nombre base para los archivos generados. */
export function baseName(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return (dot > 0 ? filename.slice(0, dot) : filename).trim() || 'documento';
}
