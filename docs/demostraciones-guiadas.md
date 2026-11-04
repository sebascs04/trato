# Demostraciones con TeTrato

Implementación local del 3 de noviembre de 2026. Se abre voluntariamente desde Ver una demostración, con sesión validada. Reemplaza la instalación del tour por pestaña; sus fuentes se conservan, pero boot ya no lo instala. TeTrato también aparece en las respuestas del asistente documental del proyecto.

## Alcance actual

Dos casos con seis pasos y fuentes de práctica precargadas: cambio de alcance (acuerdo, pedido, análisis, propuesta, aceptación, cobro) y devolución (pago, solicitud, entregas, propuesta, conformidad, resultado). Dialog nativo con fondo atenuado, panel del paso destacado, pausa, anterior, siguiente, selección de etapa y salida/Escape. Cambiar ruta o cerrar sesión cierra el recorrido; los temporizadores paran en una pestaña oculta.

El contenido y resultados son precargados. No llama a Gemini, Gmail, PayPal ni al backend de negocio, no muta proyectos reales y no demuestra que la devolución real esté integrada. El caso de devolución respeta el estado simulado disponible en el código del responsable de cambios y devoluciones; no altera sus flujos. Esta demostración de interfaz es distinta de las pruebas reales Sandbox y del procesamiento de documentos.

La web carga demo-workspace.mjs/css. Los importes se formatean con uiLocale y las etiquetas tienen traducción ES/EN. No se añade un proveedor, librería o servicio cloud. Una fixture desconocida falla; no se usa como respaldo de una operación real fallida.

## Verificación

npm run check: 1856 claves ES/EN. Tests demo3 y comparaciónEnsayos6 correctos. Comprobaciones HTTP: nuevos assets y endpoints health200. Sin pruebas reales de interfaz ni inferencias. La inspección visual queda para el usuario.

