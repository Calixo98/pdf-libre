# Política de seguridad

## Reportar una vulnerabilidad

Si encuentras un fallo de seguridad en PDF Libre, **no abras un issue público**. Repórtalo de forma privada desde
la pestaña **Security → Report a vulnerability** de este repositorio (GitHub Private Vulnerability Reporting).

Incluye, si puedes:

- qué herramienta afecta (JPG a PDF, editor o quitar contraseña);
- los pasos o el archivo que lo reproducen (si es un PDF malicioso, compártelo dentro de un ZIP con contraseña);
- el impacto que esperas (ejecución de código, fuga de datos, bloqueo del navegador…).

Respondemos en un plazo de 7 días y publicamos la corrección y un aviso cuando esté desplegada.

## Alcance

PDF Libre es un sitio estático: todo se procesa en el navegador del usuario y no hay servidor que reciba
archivos. Son especialmente relevantes:

- PDF o imágenes que logren ejecutar código en la página, saltarse la CSP o filtrar datos a otro origen;
- PDF cuyo contenido activo (JavaScript, acciones, adjuntos) sobreviva a la limpieza al descargarlo;
- archivos que bloqueen o agoten la memoria pese a los límites de entrada;
- problemas en las cabeceras de seguridad (`public/_headers`) o en la cadena de suministro (dependencias, CI).

Fuera de alcance: ataques que requieren acceso físico al dispositivo, navegadores sin soporte, o vulnerabilidades
de Cloudflare.

## Versiones con soporte

Sólo la versión publicada en la rama `main` recibe correcciones.
