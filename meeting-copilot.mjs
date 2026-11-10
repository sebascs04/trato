import { textForLanguage, uiLanguage } from './i18n.mjs';
import { SessionClient } from './auth-session.mjs';

export function convertFloat32ToInt16(samples) {
  const source = samples instanceof Float32Array ? samples : new Float32Array(samples ?? []);
  const output = new Int16Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    const value = Math.max(-1, Math.min(1, source[index] || 0));
    output[index] = value < 0 ? Math.round(value * 0x8000) : Math.round(value * 0x7fff);
  }
  return output;
}

export function createLiveSessionConfig({
  sessionId = `meeting-${Date.now()}`,
  source = 'microphone',
  language = 'es',
  origin = typeof window !== 'undefined' && window.location ? `${window.location.protocol}//${window.location.host}` : 'http://localhost:5173',
  host = 'localhost',
  port = '5173',
  secure = false,
  token = '',
  ticket = ''
} = {}) {
  const resolvedOrigin = origin || (typeof window !== 'undefined' && window.location ? `${window.location.protocol}//${window.location.host}` : 'http://localhost:5173');
  const resolvedToken = token || '';
  const socketUrl = new URL('/ws/copilot', resolvedOrigin);
  socketUrl.protocol = secure || socketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  socketUrl.searchParams.set('sessionId', sessionId);
  socketUrl.searchParams.set('ticket', ticket);

  return {
    sessionId,
    source,
    language,
    origin: resolvedOrigin,
    wsUrl: socketUrl.toString(),
    authHeader: resolvedToken ? `Bearer ${resolvedToken}` : '',
    requireOrigin: true,
    secure,
    host,
    port,
    token: resolvedToken
  };
}

export async function startLiveAudioCapture({
  source = 'microphone',
  language = 'es',
  mode = 'general',
  context = {},
  origin = typeof window !== 'undefined' && window.location ? `${window.location.protocol}//${window.location.host}` : 'http://localhost:5173',
  sessionId = `meeting-${Date.now()}`,
  // Mix your microphone into a tab capture. Off inside Trato, where your voice has its own connection.
  mixMicrophone = false,
  onEvent = () => {}
} = {}) {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
    throw new Error('La captura de audio del navegador no está disponible en este entorno.');
  }

  let stream;
  let micStream = null;
  let audioContext;
  let socket;
  let sessionClient;
  let mediaStreamSource;
  let workletNode;
  let mutedCaptureSink;
  let ticket;
  let stopped = false;
  let paused = false;
  let queuedSamples = [];

  const cleanup = async () => {
    stopped = true;
    stream?.getTracks().forEach((track) => track.stop());
    micStream?.getTracks().forEach((track) => track.stop());
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'Meeting ended');
    if (audioContext && audioContext.state !== 'closed') await audioContext.close();
  };

  try {
    audioContext = new AudioContext();
    await audioContext.resume();
    stream = source === 'screen'
      ? await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
      : await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },
          video: false
        });
    if (!stream.getAudioTracks().length) throw new Error('La fuente seleccionada no entregó audio.');
    // A Meet tab carries the client, not you: your microphone is mixed in so TeTrato hears both sides of the call.
    // If the microphone is refused, the tab alone still works.
    if (source === 'screen' && mixMicrophone) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      } catch { micStream = null; }
    }

    const configResponse = await fetch('/api/v1/config', { cache: 'no-store' });
    if (!configResponse.ok) throw new Error('No pudimos cargar la configuración de acceso de Trato.');
    const configBody = await configResponse.json();
    sessionClient = new SessionClient(configBody.data);
    const accessToken = await sessionClient.token();
    const createResponse = await fetch('/api/v1/meeting-copilot/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, source, language })
    });
    const createBody = await createResponse.json().catch(() => ({}));
    if (!createResponse.ok || !createBody.data?.ticket) {
      throw new Error(createBody.error?.message || 'Trato no pudo autorizar la sesión del copiloto.');
    }
    ticket = createBody.data.ticket;
    const liveConfig = createLiveSessionConfig({ sessionId, source, language, origin, token: accessToken, ticket });

    mediaStreamSource = audioContext.createMediaStreamSource(stream);
    await audioContext.audioWorklet.addModule(new URL('./meeting-copilot-audio-processor.js', import.meta.url));
    workletNode = new AudioWorkletNode(audioContext, 'meeting-copilot-audio-processor');
    mutedCaptureSink = audioContext.createGain();
    mutedCaptureSink.gain.value = 0;
    mediaStreamSource.connect(workletNode);
    // Who is speaking: the Meet tab is the client, the microphone is you. Each side's loudness is added up while a
    // phrase is said; when the phrase is transcribed, the louder side names its speaker.
    const meters = {};
    const meter = (node) => { const analyser = audioContext.createAnalyser(); analyser.fftSize = 1024; node.connect(analyser); return analyser; };
    meters.client = meter(mediaStreamSource);
    if (micStream) {
      const micSource = audioContext.createMediaStreamSource(micStream);
      micSource.connect(workletNode);
      meters.you = meter(micSource);
    }
    const energy = { client: 0, you: 0 }, buffer = new Float32Array(1024);
    const measure = () => {
      for (const [who, analyser] of Object.entries(meters)) {
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0; for (const value of buffer) sum += value * value;
        energy[who] += Math.sqrt(sum / buffer.length);
      }
    };
    workletNode.connect(mutedCaptureSink);
    mutedCaptureSink.connect(audioContext.destination);

    socket = new WebSocket(liveConfig.wsUrl);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('La conexión con el copiloto tardó demasiado.')), 10_000);
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ type: 'session-open', source, language, mode, context }));
      });
      socket.addEventListener('message', (event) => {
        let payload;
        try { payload = JSON.parse(event.data); } catch { return; }
        onEvent(payload);
        if (payload.type === 'config-ack') {
          clearTimeout(timeout);
          resolve();
        } else if (payload.type === 'error' && !socket.__connected) {
          clearTimeout(timeout);
          reject(new Error(payload.message || 'El proveedor rechazó la sesión.'));
        }
      });
      socket.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('No se pudo conectar con el WebSocket de Trato.'));
      });
      socket.addEventListener('close', (event) => {
        if (!socket.__connected) {
          clearTimeout(timeout);
          reject(new Error(`El servidor rechazó la conexión (${event.code}).`));
        } else if (!stopped) {
          onEvent({ type: 'error', code: 'CONNECTION_CLOSED', message: 'La conexión del copiloto se interrumpió.' });
        }
      });
    });
    socket.__connected = true;

    const sendPcm = (samples) => {
      if (stopped || !socket || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 262_144) return;
      const pcm = convertFloat32ToInt16(new Float32Array(samples));
      socket.send(JSON.stringify({ type: 'audio-raw', pcm: Array.from(pcm), source, sampleRate: audioContext.sampleRate }));
    };
    workletNode.port.onmessage = (event) => {
      const payload = event.data || {};
      if (paused || payload.type !== 'audio-frame' || !Array.isArray(payload.samples)) return;
      measure();
      queuedSamples.push(...payload.samples);
      while (queuedSamples.length >= 4096) {
        sendPcm(queuedSamples.splice(0, 4096));
      }
    };

    const sendMessage = (payload) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('La conexión del copiloto no está disponible.');
      socket.send(JSON.stringify(payload));
    };
    return {
      // 'client' or 'you' for the phrase just transcribed; null without a microphone to compare with. Starts over.
      takeSpeaker: () => {
        const who = !meters.you ? null : energy.client >= energy.you ? 'client' : 'you';
        energy.client = 0; energy.you = 0;
        return who;
      },
      config: liveConfig,
      ticket,
      stream,
      audioContext,
      sourceNode: mediaStreamSource,
      workletNode,
      socket,
      send: sendMessage,
      pause: () => {
        paused = true;
        [...stream.getTracks(), ...(micStream?.getTracks() || [])].forEach((track) => { track.enabled = false; });
        queuedSamples = [];
        sendMessage({ type: 'pause' });
      },
      resume: () => {
        [...stream.getTracks(), ...(micStream?.getTracks() || [])].forEach((track) => { track.enabled = true; });
        paused = false;
        sendMessage({ type: 'resume' });
      },
      close: async () => {
        try {
          if (socket && socket.readyState === WebSocket.OPEN) {
            if (queuedSamples.length) sendPcm(queuedSamples.splice(0));
          }
          await fetch(`/api/v1/meeting-copilot/sessions/${encodeURIComponent(sessionId)}/close`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${await sessionClient.token()}`, 'X-Meeting-Ticket': ticket }
          });
        } finally {
          await cleanup();
        }
      }
    };
  } catch (error) {
    await cleanup();
    if (ticket && sessionClient) {
      try {
        await fetch(`/api/v1/meeting-copilot/sessions/${encodeURIComponent(sessionId)}/close`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${await sessionClient.token()}`, 'X-Meeting-Ticket': ticket }
        });
      } catch { /* The original connection error remains the actionable failure. */ }
    }
    throw error;
  }
}

export const meetingCopilotModes = Object.freeze([
  'general',
  'sales',
  'negotiation',
  'requirements',
  'support'
]);

const demoReplyTemplates = Object.freeze({
  'what-reply': {
    es: 'Podemos evaluar la app móvil como segunda etapa y preparar una cotización independiente para no afectar el alcance ni los plazos actuales.',
    en: 'We can evaluate the mobile app as a second phase and prepare a separate quote so it does not affect the current scope or timeline.'
  },
  'brief': {
    es: 'Sí, lo vemos como una segunda fase con alcance definido y presupuesto separado.',
    en: 'Yes, we can treat it as a second phase with a defined scope and a separate budget.'
  },
  'ask': {
    es: '¿Qué funcionalidades consideran imprescindibles para esa app para priorizarla correctamente?',
    en: 'Which features do you consider essential for that app so we can prioritize it correctly?'
  },
  'objection': {
    es: 'La objeción clave es el riesgo de ampliación de alcance; conviene dejarlo claro y definir el presupuesto como trabajo adicional.',
    en: 'The main objection is the risk of scope creep, so it is best to clarify it and define the budget as additional work.'
  },
  'summary': {
    es: 'La conversación confirma interés, pero requiere un alcance explícito y una definición de requisitos para evitar cambios no previstos.',
    en: 'The conversation confirms interest, but it needs an explicit scope and a clear requirements definition to avoid unplanned changes.'
  }
});

const practicePhrase = Object.freeze({
  es: 'Práctica / Demo',
  en: 'Practice / Demo'
});

function safeText(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function buildMeetingSummary({ name, client, project, objective, mode = 'general' }) {
  const meetingName = safeText(name, 'Reunión');
  const customerName = safeText(client, 'Cliente');
  const projectName = safeText(project, 'Proyecto');
  const goal = safeText(objective, 'Confirmar el objetivo de la reunión');
  const targetMode = meetingCopilotModes.includes(mode) ? mode : 'general';

  const decisionLabel = targetMode === 'sales' ? 'Conviene cerrar la propuesta con prioridad en valor y orden de implementación.' : targetMode === 'negotiation' ? 'La negociación debe centrarse en alcance, prioridad y condicionantes clave.' : targetMode === 'requirements' ? 'Los requisitos quedan condicionados a una definición clara de funcionalidad mínima.' : targetMode === 'support' ? 'La respuesta debe reforzar la resolución rápida y la trazabilidad de la ayuda.' : 'La conversación debe mantener el foco en alcance, objetivos y riesgos del proyecto.';

  return {
    title: `${meetingName} · ${customerName}`,
    decisions: [
      `Se confirma que ${projectName} sigue siendo el contexto principal de la reunión.`,
      `El objetivo principal es ${goal.toLowerCase()}.`,
      decisionLabel
    ],
    actionItems: [
      'Definir qué entrega está realmente comprometida para esta fase.',
      'Documentar los riesgos de alcance y los cambios pendientes.',
      'Confirmar quién toma la decisión final y en qué plazo.'
    ],
    risks: [
      'Riesgo de ampliación de alcance si no se limitan los entregables.',
      'Posible desalineación con la prioridad de negocio si falta contexto claro.',
      'Compromisos pendientes sin responsable claro.'
    ],
    nextSteps: [
      'Preparar una respuesta breve y clara para el cliente.',
      'Guardar evidencias y decisiones principales del encuentro.',
      'Programar una revisión final antes de cerrar el acuerdo.'
    ],
    closing: 'La reunión queda en un estado de seguimiento claro, con decisiones verificables y un siguiente paso definido.'
  };
}

export function createDemoSession({
  name = 'Reunión de revisión',
  client = 'Cliente',
  project = 'Proyecto demo',
  objective = 'Alinear alcance y presupuesto',
  context = 'Necesitamos mantener el foco en valor y riesgos del cambio.',
  mode = 'general'
} = {}) {
  const selectedMode = meetingCopilotModes.includes(mode) ? mode : 'general';
  const transcript = [
    { speaker: 'Cliente', text: '¿Podemos incluir una app móvil sin aumentar el presupuesto?', at: '09:15' },
    { speaker: 'Tú', text: 'Podemos evaluarlo como una segunda etapa y preparar una cotización independiente para no afectar el alcance ni los plazos.', at: '09:16' },
    { speaker: 'Copilot', text: 'Alerta: posible ampliación de alcance. La app móvil no figura en el alcance inicial.', at: '09:17', system: true },
    { speaker: 'Cliente', text: 'Nos interesa una solución rápida, con prioridad en los módulos principales y sin cambiar la fecha.', at: '09:18' },
    { speaker: 'Tú', text: 'Perfecto; revisemos qué funcionalidades son imprescindibles para definir una fase 2 con presupuesto claro.', at: '09:19' }
  ];

  const suggestions = [
    {
      title: 'Respuesta sugerida',
      text: demoReplyTemplates['what-reply'].es,
      tag: 'demo'
    },
    {
      title: 'Pregunta recomendada',
      text: demoReplyTemplates.ask.es,
      tag: 'question'
    },
    {
      title: 'Resumen rápido',
      text: demoReplyTemplates.summary.es,
      tag: 'summary'
    }
  ];

  const recommendedQuestions = [
    '¿Qué funcionalidades son imprescindibles para la app móvil?',
    '¿Qué prioridad tienen esas funciones frente al lanzamiento actual?',
    '¿Pueden aceptar una segunda fase con presupuesto independiente?'
  ];

  const alerts = [
    {
      type: 'scope-risk',
      label: 'Alerta',
      text: 'Posible ampliación de alcance: la aplicación móvil no está incluida en el alcance actual.'
    },
    {
      type: 'timeline-risk',
      label: 'Riesgo',
      text: 'La fecha de entrega puede verse afectada si se agregan servicios fuera del plan inicial.'
    }
  ];

  const summary = buildMeetingSummary({ name, client, project, objective, mode: selectedMode });

  return {
    id: `demo-${Date.now()}`,
    provider: 'demo',
    practice: true,
    badge: 'Práctica / Demo',
    name: safeText(name, 'Reunión de revisión'),
    client: safeText(client, 'Cliente'),
    project: safeText(project, 'Proyecto demo'),
    objective: safeText(objective, 'Alinear alcance y presupuesto'),
    context: safeText(context, 'Necesitamos mantener el foco en valor y riesgos del cambio.'),
    mode: selectedMode,
    transcript,
    suggestions,
    recommendedQuestions,
    alerts,
    summary,
    status: 'ready'
  };
}

export function getQuickActionCopy(kind, lang = 'es') {
  const template = demoReplyTemplates[kind] || demoReplyTemplates['what-reply'];
  return template[lang] || template.es;
}

export function getPracticeBadge(lang = 'es') {
  return practicePhrase[lang] || practicePhrase.es;
}

// Mounted by its own page (meeting-copilot.html) or inside a Trato project (embedded, with the client and project chosen).
export function mountMeetingCopilot(root, options = {}) {
  {
    const embedded = !!options.embedded;
    const state = {
      language: uiLanguage() || 'es',
      running: false,
      started: false,
      experienceMode: 'practice',
      practiceSession: null,
      transcript: [],
      suggestions: [],
      recommendedQuestions: [],
      alerts: [],
      summary: null,
      session: null,
      source: 'microphone',
      tratoSessionClient: null,
      selectedClientId: '',
      selectedProjectId: '',
      clientOptions: [],
      projectOptions: [],
      projectDocuments: [],
      contextLoading: false,
      liveSession: null,
      liveStatus: 'ready',
      provider: '',
      interimTranscript: '',
      summaryResolver: null,
      liveError: ''
    };

    const ensureSession = () => {
      if (!state.session) {
        state.session = createDemoSession();
        state.transcript = [...state.session.transcript];
        state.suggestions = [...state.session.suggestions];
        state.recommendedQuestions = [...state.session.recommendedQuestions];
        state.alerts = [...state.session.alerts];
        state.summary = state.session.summary;
      }
      return state.session;
    };

    const fetchTratoData = async (path) => {
      if (!state.tratoSessionClient) {
        const response = await fetch('/api/v1/config', { cache: 'no-store' });
        if (!response.ok) throw new Error('No pudimos cargar el acceso de Trato.');
        const payload = await response.json();
        state.tratoSessionClient = new SessionClient(payload.data);
      }
      const token = await state.tratoSessionClient.token();
      const response = await fetch(path, {
        headers: { Authorization: `Bearer ${token}`, 'Accept-Language': state.language },
        cache: 'no-store'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(payload.data)) {
        throw new Error(payload.error?.message || 'No pudimos cargar el contexto autorizado de Trato.');
      }
      return payload.data;
    };

    const documentStatusKey = (document) => {
      const extraction = Array.isArray(document.document_extractions)
        ? document.document_extractions[0]
        : document.document_extractions;
      if (extraction?.status === 'ready') return 'meeting.documentStatus.ready';
      if (extraction?.status === 'queued') return 'meeting.documentStatus.queued';
      if (extraction?.status === 'error') return 'meeting.documentStatus.error';
      return 'meeting.documentStatus.unknown';
    };

    const selectedProjectContext = () => {
      const project = state.projectOptions.find((item) => item.id === state.selectedProjectId);
      return project ? {
        client_id: state.selectedClientId,
        project_id: project.id,
        project_name: project.name,
        project_status: project.status,
        documents: state.projectDocuments.map((item) => ({
          id: item.id,
          title: item.title,
          kind: item.kind,
          extraction_status: (Array.isArray(item.document_extractions)
            ? item.document_extractions[0]?.status
            : item.document_extractions?.status) || 'unknown'
        }))
      } : {};
    };

    const loadClients = async () => {
      state.contextLoading = true;
      state.liveError = '';
      render();
      try {
        state.clientOptions = await fetchTratoData('/api/v1/clients');
      } catch (error) {
        state.liveError = error instanceof Error ? error.message : 'No pudimos cargar tus clientes.';
      } finally {
        state.contextLoading = false;
        render();
      }
    };

    const loadProjects = async (clientId) => {
      state.contextLoading = true;
      state.projectOptions = [];
      state.projectDocuments = [];
      state.selectedProjectId = '';
      state.session.project = '';
      render();
      try {
        state.projectOptions = await fetchTratoData(`/api/v1/projects?client_id=${encodeURIComponent(clientId)}`);
      } catch (error) {
        state.liveError = error instanceof Error ? error.message : 'No pudimos cargar los proyectos.';
      } finally {
        state.contextLoading = false;
        render();
      }
    };

    const loadProjectDocuments = async (projectId) => {
      state.contextLoading = true;
      state.projectDocuments = [];
      render();
      try {
        state.projectDocuments = await fetchTratoData(`/api/v1/projects/${encodeURIComponent(projectId)}/documents`);
      } catch (error) {
        state.liveError = error instanceof Error ? error.message : 'No pudimos cargar los documentos del proyecto.';
      } finally {
        state.contextLoading = false;
        render();
      }
    };

    const render = () => {
      const session = ensureSession();
      const language = state.language;
      const emptySummary = { decisions: [], actionItems: [], risks: [], nextSteps: [], closing: '' };
      const summary = state.summary || (state.experienceMode === 'practice' ? session.summary : emptySummary);
      const mainText = (key, values = {}) => {
        try {
          return textForLanguage(language, key, values);
        } catch {
          return key;
        }
      };
      const quickActions = [
        'what-reply',
        'brief',
        'ask',
        'objection'
      ];

      root.innerHTML = `
        <div class="meeting-copilot-shell ${embedded ? 'is-embedded' : ''}">
          <header class="meeting-copilot-header">
            ${embedded ? '' : `<div class="brand-wrap">
              <a href="/" class="brand" aria-label="Trato inicio"><span class="brand-symbol">t<span>↗</span></span>trato<span class="brand-dot">.</span></a>
              <span class="brand-divider" aria-hidden="true"></span>
              <span class="product-title">Copilot</span>
            </div>`}
            <div class="header-actions">
              <div class="experience-switch" role="group" aria-label="${mainText('meeting.mode')}">
                <button type="button" class="experience-toggle ${state.experienceMode === 'practice' ? 'is-active' : ''}" data-experience="practice" ${state.running ? 'disabled' : ''}>${mainText('meeting.practiceMode')}</button>
                <button type="button" class="experience-toggle ${state.experienceMode === 'live' ? 'is-active' : ''}" data-experience="live" ${state.running ? 'disabled' : ''}>${mainText('meeting.liveMode')}</button>
              </div>
              ${embedded ? '' : `<button class="language-button ${language === 'es' ? 'is-active' : ''}" type="button" data-language="es">ES</button>
              <button class="language-button ${language === 'en' ? 'is-active' : ''}" type="button" data-language="en">EN</button>`}
            </div>
          </header>

          <div class="layout-grid">
            ${embedded
              // Inside Trato the setup is one collapsible block across the top; it folds once the meeting starts.
              ? `<details class="panel meeting-setup" ${(state.setupOpen ?? !state.started) ? 'open' : ''}><summary><h2>${mainText('meeting.sessionConfig')}</h2></summary>`
              : `<aside class="panel"><h2>${mainText('meeting.sessionConfig')}</h2>`}
              <div class="field-group">
                <label>
                  ${mainText('meeting.meetingName')}
                  <input data-field="name" value="${escapeHtml(session.name)}">
                </label>
                ${embedded && state.experienceMode === 'live' ? '' : `<label>
                  ${mainText('meeting.client')}
                  ${state.experienceMode === 'live'
                    ? `<select data-context-field="client" ${state.contextLoading ? 'disabled' : ''}><option value="">${mainText('meeting.selectClient')}</option>${state.clientOptions.map((client) => `<option value="${escapeHtml(client.id)}" ${client.id === state.selectedClientId ? 'selected' : ''}>${escapeHtml(client.name)}</option>`).join('')}</select>`
                    : `<input data-field="client" value="${escapeHtml(session.client)}">`}
                </label>
                <label>
                  ${mainText('meeting.project')}
                  ${state.experienceMode === 'live'
                    ? `<select data-context-field="project" ${!state.selectedClientId || state.contextLoading ? 'disabled' : ''}><option value="">${mainText('meeting.selectProject')}</option>${state.projectOptions.map((project) => `<option value="${escapeHtml(project.id)}" ${project.id === state.selectedProjectId ? 'selected' : ''}>${escapeHtml(project.name)}</option>`).join('')}</select>`
                    : `<input data-field="project" value="${escapeHtml(session.project)}">`}
                </label>`}
                ${state.experienceMode === 'live' ? `<details class="project-context" ${embedded ? '' : 'open'} aria-label="${mainText('meeting.projectDocuments')}"><summary><h3>${mainText('meeting.projectDocuments')} (${state.projectDocuments.length})</h3></summary>${state.contextLoading ? `<p role="status">${mainText('meeting.loadingContext')}</p>` : !state.selectedClientId ? '' : !state.projectOptions.length ? `<p>${mainText('meeting.noProjects')}</p>` : state.selectedProjectId && !state.projectDocuments.length ? `<p>${mainText('meeting.noDocuments')}</p>` : `<ul>${state.projectDocuments.map((document) => `<li><strong>${escapeHtml(document.title)}</strong><span>${escapeHtml(document.kind)} · ${mainText(documentStatusKey(document))}</span></li>`).join('')}</ul>`}</details>` : ''}
                <label>
                  ${mainText('meeting.objective')}
                  <textarea data-field="objective">${escapeHtml(session.objective)}</textarea>
                </label>
                <label>
                  ${mainText('meeting.context')}
                  <textarea data-field="context">${escapeHtml(session.context)}</textarea>
                </label>
                <label>
                  ${mainText('meeting.mode')}
                  <select data-field="mode">
                    ${meetingCopilotModes.map((option) => `<option value="${option}" ${option === session.mode ? 'selected' : ''}>${mainText(`meeting.modes.${option}`)}</option>`).join('')}
                  </select>
                </label>
                <div>
                  <div class="field-label">${mainText('meeting.audioSource')}</div>
                  <div class="source-switch" role="group" aria-label="Fuente de audio">
                    <button type="button" class="source-toggle ${state.source === 'microphone' ? 'is-active' : ''}" data-source="microphone">${mainText('meeting.microphone')}</button>
                    <button type="button" class="source-toggle ${state.source === 'screen' ? 'is-active' : ''}" data-source="screen">${mainText('meeting.screen')}</button>
                  </div>
                </div>
              </div>

              <div class="stats-grid">
                <div class="stat-chip">
                  <span>${mainText('meeting.connection')}</span>
                  <strong>${mainText(state.running ? 'meeting.connected' : state.liveStatus === 'paused' ? 'meeting.paused' : state.liveStatus === 'connecting' ? 'meeting.connecting' : 'meeting.ready')}</strong>
                </div>
                <div class="stat-chip">
                  <span>${mainText('meeting.provider')}</span>
                  <strong>${state.experienceMode === 'practice' ? mainText('meeting.demo') : (!state.provider ? '—' : escapeHtml(state.provider === 'not-configured' ? mainText('meeting.notConfigured') : state.provider))}</strong>
                </div>
              </div>
            ${embedded ? '</details>' : '</aside>'}

            <main class="panel transcript-panel">
              <h2>${mainText('meeting.live')}</h2>
              <div class="session-toolbar">
                <button class="primary-button" type="button" data-action="start" ${state.started ? 'disabled' : ''}>${mainText('meeting.start')}</button>
                <button class="secondary-button" type="button" data-action="pause" ${!state.started ? 'disabled' : ''}>${mainText(state.running ? 'meeting.pause' : 'meeting.resume')}</button>
                <button class="danger-button" type="button" data-action="end" ${!state.started ? 'disabled' : ''}>${mainText('meeting.end')}</button>
                <span class="status-indicator"><span class="status-dot" aria-hidden="true"></span>${state.running ? mainText('meeting.recording') : mainText('meeting.ready')}</span>
              </div>
              ${state.liveError ? `<div class="live-error">${escapeHtml(state.liveError)}</div>` : ''}

              <div class="transcript-list">
                ${state.transcript.map((item) => `
                  <article class="transcript-bubble ${item.system ? 'is-system' : ''}">
                    <div class="transcript-header">
                      <span>${escapeHtml(item.speaker)}</span>
                      <span>${escapeHtml(item.at)}</span>
                    </div>
                    <div>${escapeHtml(item.text)}</div>
                  </article>
                `).join('')}
                ${state.interimTranscript ? `<article class="transcript-bubble is-partial"><div class="transcript-header"><span>${escapeHtml(state.source === 'screen' ? mainText('meeting.screen') : mainText('meeting.microphone'))}</span><span>${mainText('meeting.connecting')}</span></div><div>${escapeHtml(state.interimTranscript)}</div></article>` : ''}
              </div>

              <div>
                <h3>${mainText('meeting.quickActions')}</h3>
                <div class="quick-actions">
                  ${quickActions.map((key) => `
                    <button class="quick-action" type="button" data-action="quick" data-quick-key="${key}">${mainText(`meeting.quick.${key}`)}</button>
                  `).join('')}
                </div>
              </div>
            </main>

            <aside class="panel">
              <h2>${mainText('meeting.aiSuggestions')}</h2>
              <div class="field-group">
                ${state.suggestions.map((suggestion) => `
                  <div class="suggestion-card">
                    <span class="suggestion-badge">${escapeHtml(suggestion.tag)}</span>
                    <strong>${escapeHtml(suggestion.title)}</strong>
                    <div>${escapeHtml(suggestion.text)}</div>
                  </div>
                `).join('')}
              </div>

              <h3>${mainText('meeting.recommendedQuestions')}</h3>
              <ul class="question-list">
                ${state.recommendedQuestions.map((question) => `<li>${escapeHtml(question)}</li>`).join('')}
              </ul>

              <h3>${mainText('meeting.alerts')}</h3>
              <ul class="alert-list">
                ${state.alerts.map((alert) => `<li class="${alert.type === 'scope-risk' ? 'warn' : ''}">${escapeHtml(alert.label)}: ${escapeHtml(alert.text)}</li>`).join('')}
              </ul>
            </aside>
          </div>

          ${state.started || state.summary ? `<section class="summary-panel">
            <div class="summary-header">
              <h2>${mainText('meeting.finalSummary')}</h2>
              <button class="primary-button" type="button" data-action="summary" ${state.experienceMode === 'live' && !state.liveSession ? 'disabled' : ''}>${mainText('meeting.generateSummary')}</button>
            </div>
            <div class="summary-grid">
              <article class="summary-card">
                <h3>${mainText('meeting.decisions')}</h3>
                <ul class="summary-list">
                  ${summary.decisions.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
                </ul>
              </article>
              <article class="summary-card">
                <h3>${mainText('meeting.actionItems')}</h3>
                <ul class="summary-list">
                  ${summary.actionItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
                </ul>
              </article>
              <article class="summary-card">
                <h3>${mainText('meeting.risks')}</h3>
                <ul class="summary-list">
                  ${summary.risks.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
                </ul>
              </article>
            </div>
            <div class="summary-card">
              <h3>${mainText('meeting.nextSteps')}</h3>
              <ul class="summary-list">
                ${summary.nextSteps.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
              </ul>
              <p>${escapeHtml(summary.closing)}</p>
            </div>
          </section>` : ''}
        </div>
      `;

      // The setup block stays as the freelancer left it, open or folded, across repaints.
      root.querySelector('.meeting-setup')?.addEventListener('toggle', (event) => { state.setupOpen = event.target.open; });

      root.querySelectorAll('[data-action]').forEach((button) => {
        button.addEventListener('click', async () => {
          const action = button.dataset.action;
          if (action === 'start') {
            state.liveError = '';
            if (state.experienceMode === 'practice') {
              state.running = true;
              state.started = true;
              render();
              return;
            }
            if (state.experienceMode === 'live' && !state.started) {
              state.transcript = [];
              state.suggestions = [];
              state.recommendedQuestions = [];
              state.alerts = [];
              state.summary = null;
              state.provider = 'not-configured';
            }
            state.liveStatus = 'connecting';
            render();

            try {
              const liveSession = await startLiveAudioCapture({
                source: state.source,
                language: state.language,
                mode: state.session.mode,
                context: {
                  meeting: state.session.name,
                  client: state.session.client,
                  project: state.session.project,
                  objective: state.session.objective,
                  notes: state.session.context,
                  ...selectedProjectContext()
                },
                origin: typeof window !== 'undefined' && window.location ? `${window.location.protocol}//${window.location.host}` : 'http://localhost:5173',
                sessionId: `meeting-${Date.now()}`,
                onEvent: (event) => {
                  if (event.type === 'transcription') {
                    if (event.phase === 'partial') {
                      state.interimTranscript = event.text;
                    } else if (event.phase === 'final' && event.text) {
                      state.interimTranscript = '';
                      state.transcript.push({
                        speaker: mainText(event.source === 'screen' ? 'meeting.screen' : 'meeting.microphone'),
                        text: event.text,
                        at: new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(new Date())
                      });
                    }
                    if (state.liveSession) {
                      state.liveSession.send({
                        type: 'transcript-context',
                        transcript: state.transcript.map(({ speaker, text }) => ({ speaker, text })),
                        mode: state.session.mode,
                        language: state.language,
                        context: selectedProjectContext()
                      });
                    }
                  } else if (event.type === 'suggestion') {
                    const result = event.result || {};
                    state.suggestions = [{ title: mainText(`meeting.quick.${event.kind}`), text: result.reply || '', tag: mainText('meeting.geminiLive') }];
                    state.recommendedQuestions = result.recommended_question ? [result.recommended_question] : [];
                    state.alerts = result.question_detected || result.objection_detected
                      ? [{ type: result.objection_detected ? 'scope-risk' : 'question', label: result.objection_detected ? mainText('meeting.risks') : mainText('meeting.recommendedQuestions'), text: result.rationale || result.reply || '' }]
                      : [];
                  } else if (event.type === 'summary') {
                    const result = event.result || {};
                    state.summary = {
                      title: result.title,
                      decisions: result.decisions || [],
                      actionItems: result.action_items || [],
                      risks: result.risks || [],
                      nextSteps: result.next_steps || [],
                      closing: result.closing || ''
                    };
                    state.summaryResolver?.();
                    state.summaryResolver = null;
                  } else if (event.type === 'error') {
                    state.liveError = event.message || mainText('meeting.notConfigured');
                    state.liveStatus = 'error';
                    state.summaryResolver?.();
                    state.summaryResolver = null;
                  } else if (event.type === 'config-ack') {
                    state.provider = event.provider || 'gemini-live';
                    state.liveStatus = 'connected';
                  } else if (event.type === 'status' && event.status === 'pause') {
                    state.liveStatus = 'paused';
                  } else if (event.type === 'status' && event.status === 'resume') {
                    state.liveStatus = 'connected';
                  }
                  render();
                }
              });
              state.liveSession = liveSession;
              state.running = true;
              state.started = true;
              state.liveStatus = 'connected';
            } catch (error) {
              state.running = false;
              state.liveError = error instanceof Error ? error.message : 'La captura no pudo iniciarse.';
              state.liveStatus = 'error';
            }
            render();
            return;
          }
          if (action === 'pause') {
            state.running = !state.running;
            if (state.liveSession) {
              if (state.running) state.liveSession.resume();
              else state.liveSession.pause();
            }
            render();
            return;
          }
          if (action === 'end') {
            if (state.liveSession) {
              const summaryReady = new Promise((resolve) => {
                state.summaryResolver = resolve;
                setTimeout(resolve, 8_000);
              });
              state.liveSession.send({
                type: 'transcript-context',
                transcript: state.transcript.map(({ speaker, text }) => ({ speaker, text })),
                mode: state.session.mode,
                language: state.language,
                context: selectedProjectContext()
              });
              state.liveSession.send({ type: 'summary-request' });
              await summaryReady;
              state.summaryResolver = null;
            }
            state.running = false;
            state.started = false;
            state.liveStatus = 'ready';
            if (state.liveSession) {
              await state.liveSession.close();
              state.liveSession = null;
            }
            render();
            return;
          }
          if (action === 'summary') {
            if (state.experienceMode === 'live') {
              if (!state.liveSession) return;
              state.liveSession.send({
                type: 'transcript-context',
                transcript: state.transcript.map(({ speaker, text }) => ({ speaker, text })),
                mode: state.session.mode,
                language: state.language,
                context: selectedProjectContext()
              });
              state.liveSession.send({ type: 'summary-request' });
              return;
            }
            state.summary = buildMeetingSummary({
              name: state.session.name,
              client: state.session.client,
              project: state.session.project,
              objective: state.session.objective,
              mode: state.session.mode
            });
            render();
            return;
          }
          if (action === 'quick') {
            const key = button.dataset.quickKey;
            if (state.experienceMode === 'live') {
              if (!state.liveSession) {
                state.liveError = mainText('meeting.notConfigured');
                render();
                return;
              }
              state.liveSession.send({
                type: 'transcript-context',
                transcript: state.transcript.map(({ speaker, text }) => ({ speaker, text })),
                mode: state.session.mode,
                language: state.language,
                context: selectedProjectContext()
              });
              state.liveSession.send({ type: 'suggestion-request', kind: key });
              return;
            }
            const quickText = getQuickActionCopy(key, state.language);
            state.transcript.push({ speaker: 'Copilot', text: quickText, at: 'Ahora', system: true });
            state.session.transcript = [...state.transcript];
            render();
          }
        });
      });

      root.querySelectorAll('[data-language]').forEach((button) => {
        button.addEventListener('click', () => {
          state.language = button.dataset.language;
          render();
        });
      });

      root.querySelectorAll('[data-source]').forEach((button) => {
        button.addEventListener('click', () => {
          state.source = button.dataset.source === 'screen' ? 'screen' : 'microphone';
          render();
        });
      });

      root.querySelectorAll('[data-context-field]').forEach((field) => {
        field.addEventListener('change', async (event) => {
          if (event.target.dataset.contextField === 'client') {
            state.selectedClientId = event.target.value;
            const client = state.clientOptions.find((item) => item.id === state.selectedClientId);
            state.session.client = client?.name || '';
            state.session.project = '';
            state.selectedProjectId = '';
            if (state.selectedClientId) await loadProjects(state.selectedClientId);
            else {
              state.projectOptions = [];
              state.projectDocuments = [];
              render();
            }
          } else if (event.target.dataset.contextField === 'project') {
            state.selectedProjectId = event.target.value;
            const project = state.projectOptions.find((item) => item.id === state.selectedProjectId);
            state.session.project = project?.name || '';
            if (state.selectedProjectId) await loadProjectDocuments(state.selectedProjectId);
            else {
              state.projectDocuments = [];
              render();
            }
          }
        });
      });

      root.querySelectorAll('[data-experience]').forEach((button) => {
        button.addEventListener('click', async () => {
          if (state.running) return;
          const nextMode = button.dataset.experience === 'live' ? 'live' : 'practice';
          if (nextMode !== state.experienceMode && nextMode === 'live') {
            state.practiceSession = state.session;
            state.session = {
              name: '', client: '', project: '', objective: '', context: '', mode: 'general',
              transcript: [], suggestions: [], recommendedQuestions: [], alerts: [], summary: null
            };
          } else if (nextMode !== state.experienceMode && nextMode === 'practice') {
            state.session = state.practiceSession || createDemoSession();
            state.practiceSession = null;
          }
          state.experienceMode = nextMode;
          state.transcript = state.experienceMode === 'practice' ? [...session.transcript] : [];
          state.suggestions = state.experienceMode === 'practice' ? [...session.suggestions] : [];
          state.recommendedQuestions = state.experienceMode === 'practice' ? [...session.recommendedQuestions] : [];
          state.alerts = state.experienceMode === 'practice' ? [...session.alerts] : [];
          state.summary = state.experienceMode === 'practice' ? session.summary : null;
          state.liveError = '';
          render();
          if (state.experienceMode === 'live') await loadClients();
        });
      });

      root.querySelectorAll('[data-field]').forEach((field) => {
        field.addEventListener('change', (event) => {
          const target = event.target;
          const nextValue = target.value;
          const key = target.dataset.field;
          if (!key) return;
          state.session[key] = nextValue;
          if (key === 'mode' && !meetingCopilotModes.includes(nextValue)) {
            state.session[key] = 'general';
          }
          if (state.experienceMode === 'practice') {
            state.summary = buildMeetingSummary({
              name: state.session.name,
              client: state.session.client,
              project: state.session.project,
              objective: state.session.objective,
              mode: state.session.mode
            });
          }
          render();
        });
      });
    };

    // Opened from a project in Trato (?client=…&project=…): start in live mode with that client and project chosen.
    // The lists come from the API with the signed-in session, so an id that is not the user's is simply not found.
    const preselect = async (clientId, projectId) => {
      state.practiceSession = state.session;
      state.session = { name: '', client: '', project: '', objective: '', context: '', mode: 'general',
        transcript: [], suggestions: [], recommendedQuestions: [], alerts: [], summary: null };
      state.experienceMode = 'live';
      state.transcript = []; state.suggestions = []; state.recommendedQuestions = []; state.alerts = []; state.summary = null;
      await loadClients();
      const client = state.clientOptions.find((item) => item.id === clientId);
      if (!client) return;
      state.selectedClientId = client.id; state.session.client = client.name || '';
      await loadProjects(client.id);
      const project = state.projectOptions.find((item) => item.id === projectId);
      if (!project) return;
      state.selectedProjectId = project.id; state.session.project = project.name || '';
      await loadProjectDocuments(project.id);
    };

    ensureSession();
    render();
    const params = new URLSearchParams(root.ownerDocument.defaultView.location.search);
    const clientId = options.clientId || params.get('client'), projectId = options.projectId || params.get('project');
    if (clientId && projectId) void preselect(clientId, projectId);
  }
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('meeting-copilot-root');
  if (root) mountMeetingCopilot(root);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
