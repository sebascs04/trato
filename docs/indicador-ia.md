# Indicador reutilizable de actividad de IA

Importar `renderAIActivity` desde `ai-activity.mjs`. El CSS compartido `ai-activity.css` se carga en index.html. No depende de Ensayos y no llama al modelo.

```js
import {renderAIActivity} from './ai-activity.mjs';
// Los textos deben venir de los catalogos ES/EN.
const html = renderAIActivity({label: uiText('practice.replyThinking'), hint: uiText('practice.replyThinkingHint')});
```

Admite compact:true. Escapa texto, expone role=status, aria-live=polite y aria-busy=true, y respeta prefers-reduced-motion. No inventa porcentaje ni etapas. Mostrarlo solo mientras una solicitud real esta en curso/encolada; ante fallo, quitarlo y mostrar el error con reintento explicito. No sirve de fallback ni acredita finalizacion. Flores puede usarlo en cambios y devoluciones con sus propios textos traducidos. Ensayos ya lo usa para respuesta del cliente y evaluacion final.

Las salidas de agentes deben ser JSON con esquema validado. Una respuesta invalida se conserva como fallo, no se reemplaza por texto libre o fixtures. El renderer no interpreta la salida del modelo.
