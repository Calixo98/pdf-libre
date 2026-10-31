import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFContext,
  type PDFObject,
} from 'pdf-lib';

/**
 * Qué se quitó de un PDF. Este sitio nunca ejecuta el contenido activo de un
 * PDF (pdf.js sólo lo dibuja en un canvas), pero el archivo descargado puede
 * abrirse luego en un lector que sí lo ejecute, como Acrobat.
 */
export interface SanitizeReport {
  /** Acciones o scripts JavaScript. */
  javascript: number;
  /** Acciones que abren programas, envían formularios o abren otros archivos. */
  dangerousActions: number;
  /** Acciones automáticas (al abrir el documento, una página o un campo). */
  autoActions: number;
  /** Archivos adjuntos incrustados. */
  embeddedFiles: number;
  /** Enlaces con un esquema distinto de http, https o mailto (por ejemplo javascript: o file:). */
  unsafeLinks: number;
  /** Anotaciones multimedia o 3D, que pueden cargar contenido externo. */
  mediaAnnotations: number;
  /** Formularios XFA (pueden llevar scripts). */
  xfaForms: number;
}

export function emptyReport(): SanitizeReport {
  return {
    javascript: 0,
    dangerousActions: 0,
    autoActions: 0,
    embeddedFiles: 0,
    unsafeLinks: 0,
    mediaAnnotations: 0,
    xfaForms: 0,
  };
}

export function totalRemoved(report: SanitizeReport): number {
  return Object.values(report).reduce((sum, value) => sum + value, 0);
}

/** Resumen legible, p. ej. "2 scripts JavaScript y 1 archivo adjunto". */
export function describeReport(report: SanitizeReport): string {
  const parts: string[] = [];
  const add = (count: number, singular: string, plural: string) => {
    if (count > 0) parts.push(`${count} ${count === 1 ? singular : plural}`);
  };
  add(report.javascript, 'script JavaScript', 'scripts JavaScript');
  add(report.autoActions, 'acción automática', 'acciones automáticas');
  add(report.dangerousActions, 'acción peligrosa', 'acciones peligrosas');
  add(report.embeddedFiles, 'archivo adjunto', 'archivos adjuntos');
  add(report.unsafeLinks, 'enlace inseguro', 'enlaces inseguros');
  add(report.mediaAnnotations, 'elemento multimedia', 'elementos multimedia');
  add(report.xfaForms, 'formulario XFA', 'formularios XFA');
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;
}

/** Únicas acciones que se conservan: saltar a una página, abrir una URL web y navegación básica. */
const SAFE_NAMED_ACTIONS = new Set(['NextPage', 'PrevPage', 'FirstPage', 'LastPage']);
const SAFE_URI = /^(https?:|mailto:)/i;
/** Anotaciones que incrustan archivos o reproducen contenido (pueden lanzar programas o cargar recursos externos). */
const MEDIA_ANNOTATIONS = new Set(['FileAttachment', 'Sound', 'Movie', 'Screen', 'RichMedia', '3D']);
/** Claves de un diccionario que apuntan a una acción. */
const ACTION_KEYS = ['A', 'Next', 'OpenAction', 'PA'];

const name = (value: string) => PDFName.of(value);

function nameText(value: PDFObject | undefined): string | null {
  return value instanceof PDFName ? value.decodeText() : null;
}

function stringText(value: PDFObject | undefined): string | null {
  return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : null;
}

type ActionVerdict = 'safe' | 'javascript' | 'unsafe-link' | 'dangerous';

function judgeAction(action: PDFDict, context: PDFContext): ActionVerdict {
  const type = nameText(context.lookup(action.get(name('S'))));
  switch (type) {
    case 'GoTo':
      return 'safe';
    case 'Named': {
      const target = nameText(context.lookup(action.get(name('N'))));
      return target && SAFE_NAMED_ACTIONS.has(target) ? 'safe' : 'dangerous';
    }
    case 'URI': {
      const uri = stringText(context.lookup(action.get(name('URI'))))?.trim() ?? '';
      return SAFE_URI.test(uri) ? 'safe' : 'unsafe-link';
    }
    case 'JavaScript':
      return 'javascript';
    default:
      // Launch, SubmitForm, ImportData, GoToR, GoToE, Rendition, Hide, etc.
      return 'dangerous';
  }
}

/**
 * Quita del documento el contenido activo: JavaScript, acciones automáticas,
 * acciones que lanzan programas o envían datos, adjuntos, multimedia, XFA y
 * enlaces con esquemas peligrosos. El texto, las imágenes, los enlaces web y
 * los campos de formulario (sin sus scripts) se conservan.
 */
export function sanitizePdfDocument(doc: PDFDocument): SanitizeReport {
  const report = emptyReport();
  const context = doc.context;
  const catalog = doc.catalog;

  // 1. Árbol de nombres: scripts de documento y archivos adjuntos.
  const names = context.lookup(catalog.get(name('Names')));
  if (names instanceof PDFDict) {
    if (names.has(name('JavaScript'))) {
      names.delete(name('JavaScript'));
      report.javascript++;
    }
    if (names.has(name('EmbeddedFiles'))) {
      names.delete(name('EmbeddedFiles'));
      report.embeddedFiles++;
    }
  }

  // 2. Formularios XFA (los lectores modernos los ignoran, pero pueden llevar scripts).
  const acroForm = context.lookup(catalog.get(name('AcroForm')));
  if (acroForm instanceof PDFDict && acroForm.has(name('XFA'))) {
    acroForm.delete(name('XFA'));
    acroForm.delete(name('NeedsRendering'));
    report.xfaForms++;
  }

  // 3. Todos los diccionarios del archivo, también los anidados: acciones y acciones automáticas.
  const visited = new Set<PDFObject>();
  const visit = (object: PDFObject | undefined): void => {
    if (!object || visited.has(object)) return;
    visited.add(object);
    if (object instanceof PDFStream) {
      visit(object.dict);
    } else if (object instanceof PDFArray) {
      for (const item of object.asArray()) visit(item);
    } else if (object instanceof PDFDict) {
      cleanDict(object, context, report);
      for (const [, value] of object.entries()) visit(value);
    }
  };
  visit(context.trailerInfo.Root ? context.lookup(context.trailerInfo.Root) : catalog);
  for (const [, object] of context.enumerateIndirectObjects()) visit(object);

  // 4. Anotaciones multimedia y de adjuntos: se quitan de cada página.
  for (const page of doc.getPages()) {
    const annotations = page.node.Annots();
    if (!annotations) continue;
    const kept: PDFObject[] = [];
    for (const reference of annotations.asArray()) {
      const annotation = context.lookup(reference);
      const subtype = annotation instanceof PDFDict ? nameText(context.lookup(annotation.get(name('Subtype')))) : null;
      if (subtype && MEDIA_ANNOTATIONS.has(subtype)) {
        if (subtype === 'FileAttachment') report.embeddedFiles++;
        else report.mediaAnnotations++;
        continue;
      }
      kept.push(reference);
    }
    if (kept.length !== annotations.size()) page.node.set(name('Annots'), context.obj(kept));
  }

  // 5. Lo que quedó sin referencias (scripts, adjuntos) no debe seguir dentro del archivo.
  removeUnreachableObjects(context);
  return report;
}

function cleanDict(dict: PDFDict, context: PDFContext, report: SanitizeReport): void {
  // Archivos asociados (PDF 2.0): otra forma de incrustar adjuntos en el catálogo, una página o una anotación.
  if (dict.has(name('AF'))) {
    dict.delete(name('AF'));
    report.embeddedFiles++;
  }

  // Acciones automáticas: al abrir/cerrar el documento, una página, al pasar el ratón por un campo...
  if (dict.has(name('AA'))) {
    const additional = context.lookup(dict.get(name('AA')));
    if (additional instanceof PDFDict && additional.entries().some(([, a]) => isJavaScriptAction(a, context))) {
      report.javascript++;
    } else {
      report.autoActions++;
    }
    dict.delete(name('AA'));
  }

  for (const key of ACTION_KEYS) {
    const target = context.lookup(dict.get(name(key)));
    if (!(target instanceof PDFDict)) continue; // OpenAction también puede ser un destino (array): se conserva
    const verdict = judgeAction(target, context);
    if (verdict === 'safe') continue;
    dict.delete(name(key));
    if (key === 'OpenAction') report.autoActions++;
    if (verdict === 'javascript') report.javascript++;
    else if (verdict === 'unsafe-link') report.unsafeLinks++;
    else report.dangerousActions++;
  }

  // Diccionario de acción JavaScript huérfano o anidado: se vacía el código por si algo lo referencia.
  if (nameText(context.lookup(dict.get(name('S')))) === 'JavaScript' && dict.has(name('JS'))) {
    dict.delete(name('JS'));
  }
}

function isJavaScriptAction(value: PDFObject, context: PDFContext): boolean {
  const action = context.lookup(value);
  return action instanceof PDFDict && nameText(context.lookup(action.get(name('S')))) === 'JavaScript';
}

/**
 * Borra los objetos indirectos a los que ya no se llega desde el catálogo ni
 * desde la información del documento. pdf-lib guarda todos los objetos del
 * contexto, así que sin este paso un script desenlazado seguiría en el archivo.
 */
export function removeUnreachableObjects(context: PDFContext): number {
  const reachable = new Set<string>();
  const stack: PDFObject[] = [];
  const { Root, Info } = context.trailerInfo;
  if (Root) stack.push(Root);
  if (Info) stack.push(Info);

  while (stack.length > 0) {
    const object = stack.pop();
    if (!object) continue;
    if (object instanceof PDFRef) {
      const key = object.toString();
      if (reachable.has(key)) continue;
      reachable.add(key);
      const target = context.lookup(object);
      if (target) stack.push(target);
    } else if (object instanceof PDFStream) {
      stack.push(object.dict);
    } else if (object instanceof PDFDict) {
      for (const [, value] of object.entries()) stack.push(value);
    } else if (object instanceof PDFArray) {
      for (const item of object.asArray()) stack.push(item);
    }
  }

  let removed = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reachable.has(ref.toString())) {
      context.delete(ref);
      removed++;
    }
  }
  return removed;
}

/** Abre, limpia y vuelve a guardar un PDF sin cifrar. */
export async function sanitizePdfBytes(bytes: Uint8Array): Promise<{ bytes: Uint8Array; report: SanitizeReport }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const report = sanitizePdfDocument(doc);
  return { bytes: await doc.save(), report };
}
