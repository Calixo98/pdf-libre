import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const page = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Lee el bloque global ("/*") de public/_headers para aplicarlo también en
// `vite` y `vite preview`: así la CSP que pruebas es la que se despliega.
function readGlobalHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  let inGlobalBlock = false;
  for (const line of readFileSync(page('./public/_headers'), 'utf8').split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      inGlobalBlock = line.trim() === '/*';
      continue;
    }
    if (!inGlobalBlock) continue;
    const colon = line.indexOf(':');
    headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return headers;
}

function securityHeaders(): Plugin {
  const headers = readGlobalHeaders();
  const apply = (_req: IncomingMessage, res: ServerResponse, next: () => void) => {
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    next();
  };
  return {
    name: 'security-headers',
    configureServer(server) {
      server.middlewares.use(apply);
    },
    configurePreviewServer(server) {
      server.middlewares.use(apply);
    },
  };
}

// qpdf-wasm contiene código de Node (fs, path, crypto) que nunca se ejecuta en el navegador.
// Se apunta a un módulo vacío para que el build no avise de módulos externalizados.
const nodeBuiltinStub = page('./src/lib/empty-module.ts');

export default defineConfig({
  plugins: [securityHeaders()],
  resolve: {
    alias: {
      fs: nodeBuiltinStub,
      path: nodeBuiltinStub,
      crypto: nodeBuiltinStub,
    },
  },
  build: {
    rollupOptions: {
      input: {
        index: page('./index.html'),
        'jpg-a-pdf': page('./jpg-a-pdf/index.html'),
        editor: page('./editor/index.html'),
        desbloquear: page('./desbloquear/index.html'),
      },
    },
  },
});
