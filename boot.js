// Carga una fixture JSON normalizada. Una carga fallida se muestra; no se inventan datos.
async function bootTrato() {
  try {
    const {localizeStaticDocument,installLanguagePreference}=await import('/i18n.mjs');
    localizeStaticDocument(document);
    await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/payment-panel.js';script.onload=resolve;script.onerror=()=>reject(new Error('No se pudo cargar la interfaz de pagos.'));document.head.append(script);});
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
    const {mountIcons}=await import('/icons.mjs');
    mountIcons(document);
    try {
      const {createConnectedWorkspace} = await import('/connected-workspace.mjs');
      window.TratoCloud = createConnectedWorkspace();
      installLanguagePreference(window.TratoCloud);
      const {installPracticeWorkspace}=await import('/practice-workspace.mjs');
      installPracticeWorkspace(window.TratoCloud);
      const {installReputationWorkspace}=await import('/reputation-workspace.mjs');
      installReputationWorkspace(window.TratoCloud);
      const {installVisitorLanding}=await import('/visitor-landing.mjs');
      installVisitorLanding(window.TratoCloud);
      const {installProposalWorkspace} = await import('/proposal-workspace.mjs');
      installProposalWorkspace(window.TratoCloud);
      const {installGmailConnection} = await import('/gmail-connection.mjs');
      installGmailConnection(window.TratoCloud);
      const {installSandboxCheckout} = await import('/sandbox-checkout.mjs');
      installSandboxCheckout(window.TratoCloud);
    } catch {throw new Error('No se pudo abrir tu espacio. Recarga para volver a intentar.');}
    try { window.TRATO_SAVED_STATE = await window.TratoStore.load(); }
    catch { window.TRATO_STORAGE_WARNING = true; }
    const script = document.createElement('script');
    script.src = '/app.js';
    script.onerror = () => showBootError('No se pudo cargar la aplicación. Recarga la página.');
    document.head.append(script);
  } catch (error) { showBootError(error.message); }
}
function showBootError(message) {
  document.querySelector('#boot-status')?.setAttribute('hidden', '');
  const notice = document.createElement('div');
  notice.className = 'data-error';
  notice.setAttribute('role', 'alert');
  notice.textContent = `No se pudo abrir Trato. ${message}`;
  document.body.prepend(notice);
}
bootTrato();
