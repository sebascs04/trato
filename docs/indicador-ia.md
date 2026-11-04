# Indicador reutilizable de actividad de IA

Importar `renderAIActivity` desde `ai-activity.mjs`. El CSS compartido `ai-activity.css` se carga en index.html. No depende de Ensayos y no llama al modelo.

```js
import {renderAIActivity} from './ai-activity.mjs';
// Los textos deben venir de los catalogos ES/EN.
const html = renderAIActivity({label: uiText('practice.replyThinking'), hint: uiText('practice.replyThinkingHint')});
```

Admite compact:true. Escapa texto, expone role=status, aria-live=polite y aria-busy=true, y respeta prefers-reduced-motion. No inventa porcentaje ni etapas. Mostrarlo solo mientras una solicitud real esta en curso/encolada; ante fallo, quitarlo y mostrar el error con reintento explicito. No sirve de fallback ni acredita finalizacion. el responsable de cambios y devoluciones puede usarlo en cambios y devoluciones con sus propios textos traducidos. Ensayos ya lo usa para respuesta del cliente y evaluacion final.

Las salidas de agentes deben ser JSON con esquema validado. Una respuesta invalida se conserva como fallo, no se reemplaza por texto libre o fixtures. El renderer no interpreta la salida del modelo.

### Ajuste de interfaz, 3 de noviembre

El componente compartido muestra la mascota de Trato y conserva la etiqueta que aporta cada operación real. No convierte una consulta de lectura en un análisis de IA ni inventa avances. Conserva `role=status`, escape de etiquetas y movimiento reducido.

El plan inicial conserva su respuesta aunque el usuario haya cambiado de pestaña durante la petición. Solo pinta cuando su vista está activa; una ausencia de plan muestra el estado vacío y un fallo muestra reintento. Prueba de regresión: `node --test tests/project-plan-loading.test.mjs`.

El inventario del asistente se consulta desde un panel flotante debajo de la pregunta, con cierre y Escape. Actualiza estados pendientes cada ocho segundos mientras la pestaña está activa. Las subidas nuevas ya encadenan extracción y procesamiento desde `VectorJobs.after_extraction`; consultar el inventario no inicia trabajos ni reprocesa archivos antiguos. La acción explícita para archivos anteriores se mantiene dentro del panel. No se realizaron pruebas con modelos ni desde la interfaz.
