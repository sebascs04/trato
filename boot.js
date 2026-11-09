// Load explicit rehearsal scenarios; never use them as studio business data.
async function bootTrato() {
  try {
    const {localizeStaticDocument,installLanguagePreference,uiLanguage,uiText}=await import('/i18n.mjs');
    localizeStaticDocument(document);
    document.querySelector('#workspace-privacy').href='/privacidad?lang='+uiLanguage();
    const {captureAuthReturn}=await import('/auth-return.mjs');
    const authReturn=captureAuthReturn();
    document.title=uiText('app.title');
    const response = await fetch('/data/demo.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`No se pudieron cargar los datos (${response.status}).`);
    const data = await response.json();
    if (data.meta.schemaVersion !== 1 || data.meta.fixture !== true) throw new Error('El formato de datos de la demo no es compatible.');
    for (const table of ['freelancers','clients','projects','documents','documentVersions','conversations','messages','requests','invoices','refunds','events','demoScenarios']) {
      if (!Array.isArray(data[table])) throw new Error(`Falta la colección ${table}.`);
      const ids = data[table].map(record => record.id);
      if (ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new Error(`Identificadores inválidos en ${table}.`);
    }
    window.TRATO_DATA = data;
    // Fictional rehearsal cases shared with the API (data/rehearsal-cases.json). Hidden intents are chosen by the server.
    const cases = await fetch('/data/rehearsal-cases.json', { cache: 'no-store' });
    if (!cases.ok) throw new Error(`No se pudieron cargar los casos de Ensayos (${cases.status}).`);
    const bank = await cases.json();
    if (bank.version !== 1 || ['scope','payment','refund'].some(id => !Array.isArray(bank.scenarios?.[id]?.cases) || !bank.scenarios[id].cases.length)) throw new Error('El formato de los casos de Ensayos no es compatible.');
    window.TRATO_REHEARSAL_CASES = bank;
    const {mountIcons}=await import('/icons.mjs');
    mountIcons(document);
    try {
      const {createConnectedWorkspace} = await import('/connected-workspace.mjs');
      window.TratoCloud = createConnectedWorkspace({authReturn});
      installLanguagePreference(window.TratoCloud);
      const {installPracticeWorkspace}=await import('/practice-workspace.mjs');
      installPracticeWorkspace(window.TratoCloud);
      const {installReputationWorkspace}=await import('/reputation-workspace.mjs');
      installReputationWorkspace(window.TratoCloud);
      const {installProjectPlanning}=await import('/project-planning.mjs');
      installProjectPlanning(window.TratoCloud);
      const {installPlanPayments}=await import('/plan-payments.mjs');
      installPlanPayments(window.TratoCloud);
      const {installVisitorLanding}=await import('/visitor-landing.mjs');
      installVisitorLanding(window.TratoCloud);
      const {installProposalWorkspace} = await import('/proposal-workspace.mjs');
      installProposalWorkspace(window.TratoCloud);
      const {installDisputeWorkspace} = await import('/dispute-workspace.mjs');
      installDisputeWorkspace(window.TratoCloud);
      const {installRefundWorkspace} = await import('/refund-workspace.mjs');
      installRefundWorkspace(window.TratoCloud);
      const {installGmailConnection} = await import('/gmail-connection.mjs');
      installGmailConnection(window.TratoCloud);
      const {installProjectAssistant}=await import('/project-assistant.mjs');
      installProjectAssistant(window.TratoCloud);
      // TeTrato flotante en Ensayos y Reputación: desactivado (Sebastian, 8/11/2026). Esas secciones se explican con sus botones «i»;
      // el código (section-assistant.mjs, /api/v1/ai/section-questions) queda para un posible TeTrato único.
      const {installDemoWorkspace}=await import('/demo-workspace.mjs');
      installDemoWorkspace(window.TratoCloud);
    } catch {throw new Error('No se pudo abrir tu espacio. Recarga para volver a intentar.');}
    const script = document.createElement('script');
    script.src = '/app.js';
    script.onerror = () => showBootError('No se pudo cargar la aplicación. Recarga la página.');
    document.head.append(script);
  } catch (error) { showBootError(error.message); }
}
function showBootError(message) {
  document.body.setAttribute('aria-busy', 'false');
  document.querySelector('#boot-status')?.setAttribute('hidden', '');
  const notice = document.createElement('div');
  notice.className = 'data-error';
  notice.setAttribute('role', 'alert');
  notice.textContent = `No se pudo abrir Trato. ${message}`;
  document.body.prepend(notice);
}
bootTrato();
