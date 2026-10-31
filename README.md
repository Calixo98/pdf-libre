# PDF Libre

Herramientas PDF gratuitas y de código abierto que se ejecutan **en tu navegador**:

- **JPG a PDF**: une varias fotos o imágenes (JPG y PNG) en un solo PDF, en el orden que elijas.
- **Editor de PDF**: añade texto, resalta, dibuja y borra anotaciones; gira, reordena o quita páginas; y descarga el PDF editado.
- **Quitar contraseña**: desbloquea un PDF si conoces su contraseña, y quita sus restricciones de copia, impresión o edición.

Tus archivos **no se suben a ningún servidor**. Cloudflare sólo sirve los archivos estáticos de la aplicación; el procesamiento ocurre en tu dispositivo.

Licencia MIT (ver [LICENSE](LICENSE)).

## Uso local

Necesitas Node.js 22.12 o superior.

```bash
npm install
npm run dev
```

Abre http://localhost:5173 en el navegador.

Otros comandos:

```bash
npm test          # pruebas unitarias (Vitest)
npm run typecheck # comprobación de tipos
npm run build     # genera dist/
npm run preview   # sirve dist/ con las mismas cabeceras que producción
```

`npm install` copia los recursos de pdf.js (fuentes estándar, cMaps y decodificadores WASM) a `public/pdfjs/` con `scripts/copy-pdfjs-assets.mjs`. Esa carpeta es generada y está en `.gitignore`.

## Despliegue en Cloudflare

El proyecto es un sitio estático que Cloudflare sirve con **Workers Static Assets**. No hay código de servidor.

1. Primera vez: inicia sesión en tu cuenta de Cloudflare desde la terminal.

   ```bash
   npx wrangler login
   ```

2. Construye y despliega:

   ```bash
   npm run deploy
   ```

   Ese comando ejecuta `npm run build` y luego `wrangler deploy` con la configuración de [wrangler.jsonc](wrangler.jsonc), que apunta a `dist/`.

3. Las cabeceras de seguridad (Content-Security-Policy, `X-Frame-Options`, `Referrer-Policy` y demás) están en [public/_headers](public/_headers). Cloudflare las aplica a cada respuesta, y `vite` y `vite preview` las aplican igual para que pruebes la misma política.

Si prefieres conectar el repositorio a Git desde el panel de Cloudflare, usa `npm run build` como comando de compilación y `npx wrangler deploy` como comando de despliegue.

## Notas de uso

- **Editor de PDF**: las anotaciones se guardan como capas nuevas sobre el PDF; no editan el texto que ya tiene el documento. Para el texto se usa la fuente Helvetica del PDF, así que sólo admite caracteres de WinAnsi (letras latinas, acentos, `ñ`, `€`…). Emojis y letras griegas se rechazan con un aviso.
- **Borrar** en el editor sólo quita anotaciones. No es un tachado seguro: un recuadro blanco encima de un texto no elimina ese texto del PDF.
- **Exportar** crea un PDF nuevo con las páginas que elegiste. Conserva el contenido, el texto, las imágenes y los enlaces a sitios web. No conserva los enlaces internos entre páginas, los campos de formulario interactivos, el índice (marcadores) ni los metadatos (título, autor) del PDF original. Las páginas quitadas no quedan dentro del archivo, aunque otra página las enlace.
- **Quitar contraseña**: sólo funciona con archivos sobre los que tienes derecho. Si el PDF tiene contraseña de apertura, hace falta escribirla; si sólo tiene restricciones, se quitan sin contraseña.
- **Fotos de iPhone**: se aceptan JPG y PNG. Las imágenes HEIC deben convertirse a JPG antes.
- **Orientación de las fotos**: si una foto tiene orientación EXIF (la típica de los celulares), se vuelve a codificar con el navegador, con calidad JPEG 95, para que el PDF la muestre derecha. Las fotos sin orientación EXIF no se tocan.
- **Archivos grandes**: todo se procesa en memoria del navegador. Un PDF de cientos de megas puede tardar o agotar la memoria de un celular.

## Estructura

```
index.html                 portada
jpg-a-pdf/index.html       herramienta JPG a PDF
editor/index.html          editor de PDF
desbloquear/index.html     quitar contraseña
src/lib/                   conversión de imágenes, desbloqueo (qpdf-wasm), pdf.js
src/editor/                modelo del editor, historial, geometría, dibujo, exportación
src/pages/                 controladores de cada página
src/styles/app.css         estilos compartidos
tests/                     pruebas unitarias (Vitest) con fixtures generados en memoria
public/_headers            cabeceras de seguridad
wrangler.jsonc             configuración de Cloudflare (sólo activos estáticos)
scripts/                   copia de recursos de pdf.js
```

## Pruebas

`npm test` cubre la lectura de orientación EXIF, el cálculo de páginas y el PDF generado desde JPG/PNG (también el rechazo de un PNG cortado), el cifrado y descifrado real con qpdf (contraseña de usuario, sólo propietario y contraseña incorrecta), el historial del editor, la geometría de las anotaciones y la exportación del editor (orden de páginas, giro, contenido dibujado y páginas quitadas que no quedan en el archivo).

La interfaz (arrastrar archivos, dibujar sobre la página, etc.) se comprueba a mano en el navegador: las pruebas unitarias no cubren el DOM.

## Seguridad: OWASP Top 10:2025

Revisión de la aplicación contra [OWASP Top 10:2025](https://top10.owasp.org/2025):

| Categoría | Cómo se cumple |
|---|---|
| A01 Control de acceso | No hay cuentas, servidor ni datos de otros usuarios. Cada archivo sólo existe en la pestaña que lo abrió. |
| A02 Configuración de seguridad | CSP estricta (`script-src 'self' 'wasm-unsafe-eval'`, `object-src 'none'`, `frame-ancestors 'none'`, `form-action 'none'`), `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` y `Permissions-Policy` sin permisos. No se usa `unsafe-eval`. |
| A03 Fallos en la cadena de suministro | Dependencias con versión exacta y `package-lock.json`. Ningún script se carga desde CDN. Antes de publicar, revisa `npm audit`. |
| A04 Fallos criptográficos | No hay criptografía propia. Las contraseñas de PDF se usan sólo en memoria para descifrar, nunca se guardan ni se envían. |
| A05 Inyección | El texto del usuario y los nombres de archivo se escriben con `textContent` o en un canvas; no hay `innerHTML` con datos externos. El contenido de los PDF es datos: se procesa con pdf.js y qpdf dentro de sus workers o de WASM. |
| A06 Diseño inseguro | Modelo de amenazas: un PDF malicioso sólo puede afectar la pestaña donde se abre. No hay acciones del lado servidor que abusar. |
| A07 Fallos de autenticación | No aplica: no hay sesiones. Las contraseñas de los PDF nunca salen del navegador. |
| A08 Fallos de integridad | Los recursos son propios del sitio (mismo origen), sin CDN, y las versiones están fijadas en el lockfile. |
| A09 Registro y alertas | No hay telemetría. Los errores se muestran al usuario y se registran sólo en la consola del navegador, sin el contenido del archivo. |
| A10 Manejo de condiciones excepcionales | Falla cerrada: si qpdf no puede descifrar, no se entrega ningún archivo; si una foto no se puede enderezar, se avisa y se usa la original. |

## Dependencias y licencias

| Paquete | Uso | Licencia |
|---|---|---|
| [pdf-lib](https://github.com/Hopding/pdf-lib) | crear y modificar PDF | MIT |
| [pdf.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`) | mostrar páginas en el editor | Apache-2.0 |
| [qpdf](https://github.com/qpdf/qpdf) vía [@neslinesli93/qpdf-wasm](https://github.com/neslinesli93/qpdf-wasm) | descifrar PDF | Apache-2.0 (qpdf); ISC (envoltorio) |

Las herramientas de desarrollo (Vite, TypeScript, Vitest, Wrangler y otras) no se incluyen en el sitio publicado.
