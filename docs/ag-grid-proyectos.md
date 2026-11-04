# Tabla mínima de proyectos con AG Grid

Adelanto autorizado por el responsable del proyecto el 3 de noviembre, dentro de la fase de cierre. La ampliación de cobros queda para la segunda fase del 5 al 12 de noviembre; ver tareas-p1-p2.md.

## Interfaz y datos

En Clientes, abrir un cliente y pulsar **Ver tabla**. Se utiliza el listado ya obtenido por el API para la sesión actual, filtrado nuevamente por cliente. No hay nuevas rutas, consultas de IA, importes calculados ni estados de pago inferidos. Columnas: nombre, fecha de creación y acciones. Las celdas no se editan; abrir y eliminar conservan los handlers existentes. Se mantiene el cambio explícito entre lista y tabla, no como sustitución automática si falla Grid.

Búsqueda por texto y ordenación por nombre/fecha. Altura acorde al número de filas, con límite de espacio. Al cambiar de cliente, propietario o vista se destruye el componente anterior; una importación pendiente no puede montarse en otro contexto. La búsqueda y preferencia de vista son locales a esta sesión/cliente y se eliminan al cerrar la sesión.

## Dependencias y compilación

- `ag-grid-community` 36.2.0: MIT, únicamente ClientSideRowModelModule y QuickFilterModule. No usa Enterprise, licencias de prueba, CDN ni servicios contratados.
- `@ag-grid-community/locale` 36.2.0: origen del catálogo de traducciones de AG Grid. Las etiquetas se incorporaron con prefijo projectGrid.vendor en los catálogos ES/EN y se consultan mediante uiText, incluidos textos accesibles. project-grid-locale-keys.mjs conserva el conjunto de claves para ambas traducciones.
- `esbuild` 0.28.2: dependencia de desarrollo para generar el módulo local.

```bash
npm ci
npm run grid:build
npm run check
node --test tests/project-grid.test.mjs
```

`project-grid-vendor.mjs` es el punto de entrada de compilación. El resultado es `assets/vendor/project-grid-vendor.mjs`, servido solo al elegir la tabla. La licencia se conserva en docs/ag-grid-LICENSE.txt. Los iconos de ordenación y acciones son Lucide, generados con icons:build. No hay parámetros de entorno nuevos. Las nuevas dependencias se comunicaron al equipo para su entrega conjunta a el responsable de cambios y devoluciones antes de cualquier publicación.

Las pruebas de contrato verifican filtro por cliente, proyección de campos, catálogos ES/EN y exportaciones del módulo compilado. No equivalen a una prueba visual/E2E; el responsable del proyecto realiza esa comprobación en la interfaz. Sin push, PR, merge ni despliegue en este lote.
