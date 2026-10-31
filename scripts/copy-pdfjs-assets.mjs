// Copia los recursos de pdf.js (fuentes estándar, cMaps y decodificadores WASM)
// a public/pdfjs para servirlos desde el mismo origen y que funcionen sin conexión.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pdfjsDir = join(root, 'node_modules', 'pdfjs-dist');
const destDir = join(root, 'public', 'pdfjs');

rmSync(destDir, { recursive: true, force: true });
for (const dir of ['standard_fonts', 'cmaps', 'wasm']) {
  mkdirSync(join(destDir, dir), { recursive: true });
  cpSync(join(pdfjsDir, dir), join(destDir, dir), { recursive: true });
  console.log(`pdf.js: ${dir} -> public/pdfjs/${dir}`);
}
