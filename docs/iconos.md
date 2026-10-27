# Iconos de Trato

Biblioteca única: Lucide, mediante `lucide-static@1.61.0`. No se requiere React para el frontend actual. No incorporar React Icons u otra biblioteca para nuevas acciones.

`npm run icons:build` genera `icons.mjs` a partir de SVG oficiales instalados. Se incluyen únicamente los iconos seleccionados en `scripts/build-icons.mjs`; el navegador no carga la colección completa ni consulta un CDN. La licencia ISC se conserva en `docs/lucide-LICENSE.txt`.

Para módulos: `import {icon as uiIcon} from './icons.mjs'` y `${uiIcon('trash-2')}` dentro de la plantilla. Para HTML estático: `<span data-ui-icon="users"></span>`, montado en boot.js. Los nombres admitidos están definidos en el generador; un nombre inexistente produce un error explícito.

Usar icono solo en acciones compactas reconocibles, con aria-label específico y title, foco visible y tamaño táctil adecuado. Mantener texto en acciones principales y confirmaciones. Los SVG decorativos se ocultan de lectores de pantalla; la etiqueta accesible pertenece al botón.

Aplicación inicial: eliminar cliente, cerrar modales, enviar correo y navegación principal. El nombre de proveedor y las etiquetas PDF/DOCX son texto/marca, no otra biblioteca de iconos.
