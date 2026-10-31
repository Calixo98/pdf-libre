/**
 * Límites de entrada. Todo se procesa en la memoria del navegador, así que un
 * archivo enorme o una imagen con dimensiones absurdas (una "bomba" de
 * descompresión: pocos KB que se expanden a gigas de píxeles) podría congelar
 * o tumbar la pestaña. Se rechazan antes de procesarlos.
 */
export const LIMITS = {
  /** Tamaño máximo de un PDF de entrada. */
  maxPdfBytes: 150 * 1024 * 1024,
  /** Tamaño máximo de cada imagen. */
  maxImageBytes: 40 * 1024 * 1024,
  /** Número máximo de imágenes por PDF. */
  maxImages: 300,
  /** Suma máxima de todas las imágenes de un PDF. */
  maxTotalImageBytes: 400 * 1024 * 1024,
  /** Lado máximo de una imagen, en píxeles. */
  maxImageSidePx: 20_000,
  /** Píxeles máximos de una imagen (100 megapíxeles ≈ 400 MB descomprimida en RGBA). */
  maxImagePixels: 100_000_000,
  /** Longitud máxima de una contraseña de PDF (el estándar usa como mucho 127 bytes). */
  maxPasswordLength: 1024,
  /** Píxeles máximos de un canvas de render (≈ 64 MB en RGBA). */
  maxCanvasPixels: 16_777_216,
} as const;

export class InputLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputLimitError';
  }
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** Falla si el archivo pasa del tamaño permitido. Se comprueba antes de leerlo en memoria. */
export function assertFileSize(file: { name: string; size: number }, maxBytes: number): void {
  if (file.size > maxBytes) {
    throw new InputLimitError(`"${file.name}" pesa más de ${megabytes(maxBytes)}, el máximo permitido.`);
  }
  if (file.size === 0) {
    throw new InputLimitError(`"${file.name}" está vacío.`);
  }
}

/** Falla si una imagen tiene dimensiones fuera de los límites. */
export function assertImageDimensions(name: string, width: number, height: number): void {
  if (width <= 0 || height <= 0) {
    throw new InputLimitError(`"${name}" no tiene dimensiones válidas.`);
  }
  if (width > LIMITS.maxImageSidePx || height > LIMITS.maxImageSidePx || width * height > LIMITS.maxImagePixels) {
    throw new InputLimitError(
      `"${name}" mide ${width} × ${height} px; el máximo es ${LIMITS.maxImageSidePx} px por lado y ${
        LIMITS.maxImagePixels / 1_000_000
      } megapíxeles.`,
    );
  }
}

/**
 * Factor de escala (≤ 1) que mantiene un canvas por debajo del límite de
 * píxeles. Una página PDF puede declarar un tamaño gigantesco; sin este tope,
 * el canvas pediría gigas de memoria.
 */
export function canvasScaleCap(width: number, height: number, maxPixels: number = LIMITS.maxCanvasPixels): number {
  const area = width * height;
  if (!Number.isFinite(area) || area <= 0) return 1;
  return area > maxPixels ? Math.sqrt(maxPixels / area) : 1;
}
