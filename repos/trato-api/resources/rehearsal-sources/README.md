# Fuentes aprobadas de Ensayos

Esta carpeta contiene las cinco selecciones de texto ya utilizadas por el evaluador, con sus IDs, autores, URLs, localizadores y hashes originales. El formato JSON evita tener que extraer otra vez los PDFs al instalar Trato. Los materiales conservan su atribucion original; no son obras originales de Trato ni se les aplica automaticamente la licencia del codigo.

`manifest.json` enumera exactamente cinco archivos. No incluye conversaciones de usuarios, contratos, credenciales ni resultados privados de pruebas. No se indexan en Weaviate: el evaluador debe leer las cinco completas mediante su herramienta autorizada.

La fuente de Jerome Slavik contiene solamente Commitment y Conclusion de la pagina 3. El apartado 5f permanece excluido. El catalogo de procedencia, aplicacion y limites esta en `docs/fuentes-evaluador-ensayos.md`, desde la raiz del proyecto.

Desde la raiz, con las dependencias API/FP instaladas:

```bash
repos/trato-file-processor/.venv/bin/python scripts/configure-rehearsal-sources.py
repos/trato-file-processor/.venv/bin/python scripts/configure-rehearsal-sources.py --configure
```

El primer comando comprueba hashes y lectura de las cinco fuentes sin modificar configuracion. El segundo selecciona explicitamente esta biblioteca en API .env mediante una ruta absoluta propia de la instalacion. No modifica claves, no llama al modelo ni activa el evaluador. Reiniciar exclusivamente la API de Trato para cargar el cambio; no iniciar procesos adicionales si sus puertos estan ocupados.

Si falta una fuente o cambia su contenido sin actualizar el manifiesto aprobado, la lectura falla. No se descarga otra fuente ni se usa una biblioteca alternativa automaticamente.
