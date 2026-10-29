# Estado de implementación y próximos pasos

Resumen público del producto. Los estados describen capacidades y verificaciones; no equivalen a un despliegue ni a una promesa de funcionamiento de las partes pendientes.

## Implementado

- Clientes y proyectos con documentos privados y persistencia.
- Integración de propuestas, aceptación y cobro PayPal Sandbox, con verificación del backend e idempotencia.
- Grafo de relaciones de negocio derivado de los registros del proyecto. Navegación, selección contextual, conexiones con puertos exclusivos y etiquetas separadas de las flechas.
- Reputación: fichas compartidas y experiencias publicadas explícitamente, edición, retirada y reportes. Los datos privados de proyectos ajenos no se comparten.
- Portada pública narrativa y acceso mediante formularios separados de registro e inicio de sesión.
- Interfaz de Ensayos con simulación explícita. La escena pública de temperamentos es ilustrativa y no llama a un modelo.
- Adaptador opcional de modelo local con autenticación, JSON validado, aislamiento de contexto y errores visibles. La configuración de ejemplo lo mantiene deshabilitado y la interfaz aún no lo utiliza.

## Próximos pasos

1. Revisar fuentes y criterios del evaluador de conversaciones. Cada recomendación debe señalar evidencia, explicación y límites; reconocer también aciertos.
2. Evaluar por separado el cliente ficticio y el evaluador, antes de conectar el recorrido de Ensayos al modelo.
3. Validar Reputación en navegador con dos cuentas autorizadas: distintas experiencias sobre una misma ficha, aislamiento de datos, edición, retirada y reporte.
4. Revisar homónimos y fichas duplicadas sin fusionar por coincidencia de nombre. Las reseñas son testimonios de sus autores, no certificaciones de impago ni fraude.
5. Explorar un análisis de Reputación basado únicamente en reseñas publicadas, con citas precisas, contradicciones, antigüedad y escasez de evidencia. Esta idea está planificada, no implementada; no decide por el freelancer ni inventa probabilidades.
6. Validar el grafo con recorridos integrados de pedidos, adendas, aceptación, pagos y devoluciones. La extracción semántica de relaciones desde documentos es una ampliación pendiente.
7. Comprobar el recorrido completo y la documentación frente a los requisitos de entrega del concurso.

## Límites

No publicar automáticamente el directorio privado de clientes ni documentos de sus proyectos. Una cuenta de la aplicación no acredita por sí sola una profesión. Los reportes se conservan para revisión; no hay sanciones automáticas ni consola de moderación implementada.

Cambiar de proveedor, activar servicios de pago o desplegar infraestructura requiere su autorización correspondiente. Una simulación explícita no sustituye un error del funcionamiento conectado. No marcar un recorrido como completado por disponer solamente de frontend o pruebas con dobles.

## Referencias

- [Instalación de Ollama para colaborar](ollama-para-flores.md)
- [Adaptador local de Ensayos](qwen-local.md)
- [Modo ensayo](modo-ensayo.md)
- [Reputación](reputacion.md)
- [Grafo conectado](grafo-conectado.md)
- [Estándar de prompts](estandar-prompts.md)
- [Bases y evaluación](bases-y-evaluacion-hackathon.md)

## Próximo bloque de Ensayos

Cinco guías seleccionadas en [fuentes-evaluador-ensayos.md](fuentes-evaluador-ensayos.md). El [flujo interno](flujo-interno-evaluador-ensayos.md) exige leerlas antes de evaluar y validar las citas. Incorporación de archivos, herramienta de lectura y conexión del agente pendientes.
