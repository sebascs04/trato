// State-level regression checks, not a substitute for browser layout/interaction QA.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

function loadApp() {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      innerHTML: '', textContent: '', value: '', hidden: false,
      dataset: {}, classList: { toggle() {} },
      addEventListener() {}, setAttribute() {}, removeAttribute() {},
      showModal() { this.open=true; }, close() { this.open=false; },
      querySelectorAll() { return []; }, focus() {},
    });
    return elements.get(selector);
  };
  const context = vm.createContext({
    document: { querySelector: element, querySelectorAll() { return []; }, addEventListener() {} },
    location: { hash: '#inicio' }, window: { TRATO_DATA: JSON.parse(readFileSync(new URL('../data/demo.json', `file://${__filename}`), 'utf8')), addEventListener() {} },
    Intl, setTimeout, clearTimeout,
  });
  vm.runInContext(readFileSync(new URL('../app.js', `file://${__filename}`), 'utf8'), context);
  return { run: expression => vm.runInContext(expression, context), element };
}

test('free questions stay with their project and do not pretend to use a model', () => {
  const app = loadApp();
  app.run("askAssistant('¿Puedo cambiar la fecha de entrega?')");
  assert.equal(app.run("chatHistories.get('SP-001').length"), 6);
  assert.equal(app.run("chatHistories.get('SP-002').length"), 4);
  assert.match(app.run("chatHistories.get('SP-001').at(-1).text"), /no hay un modelo conectado/);
  assert.equal(app.run("actionHistories.get('SP-001').length"), 4);
});

test('sample routing and evidence follow the selected client/project', () => {
  const app = loadApp();
  for (const id of ['SP-001', 'SP-002', 'SP-003', 'SP-004', 'SP-005']) {
    app.run(`selectedProjectId = '${id}'; askAssistant(cases[selectedProjectId].message)`);
    assert.equal(app.run(`chatHistories.get('${id}').at(-1).source`), `DOC-${id}`);
    assert.equal(app.run(`chatHistories.get('${id}').at(-1).action`), true);
    assert.match(app.element('#chat-messages').innerHTML, new RegExp(`data-project="${id}"`));
  }
});

test('actions do not leak into another project or imply a completed payment', () => {
  const app = loadApp();
  app.run("recordAction('SP-002', 'Seguimiento preparado · simulación')");
  assert.equal(app.run("actionHistories.get('SP-002').length"), 4);
  assert.equal(app.run("actionHistories.get('SP-001').length"), 4);
  assert.match(app.run("chatHistories.get('SP-002').at(-1).text"), /No se realizó una operación real/);
});

test('user text is escaped in chat rendering', () => {
  const app = loadApp();
  app.run(`askAssistant('<img src=x onerror=alert(1)>')`);
  assert.ok(!app.element('#chat-messages').innerHTML.includes('<img'));
  assert.match(app.element('#chat-messages').innerHTML, /&lt;img/);
});

test('reset removes local history and drafts and restores all example sources', () => {
  const app = loadApp();
  app.run("askAssistant('hola'); recordAction('SP-001', 'simulación'); knowledgeDocuments.push({id:'DRAFT-TEST'}); resetWorkspaceData()");
  assert.equal(app.run('knowledgeDocuments.length'), 25);
  assert.equal(app.run("chatHistories.get('SP-001').length"), 4);
  assert.equal(app.run("actionHistories.get('SP-001').length"), 4);
});

test('general assistant scopes do not mix histories or alter project chat selection', () => {
  const app = loadApp();
  app.run("generalScope = 'SP-002'; answerGeneral('Resumen', 'summary')");
  assert.match(app.run("generalHistories.get('SP-002').at(-1).text"), /Norte Café/);
  assert.doesNotMatch(app.run("generalHistories.get('SP-002').at(-1).text"), /Luna Studio/);
  assert.equal(app.run("generalHistories.get('general').length"), 1);
  assert.equal(app.run("chatHistories.get('SP-002').length"), 4);
  assert.equal(app.run('selectedProjectId'), 'SP-001');
});

test('general overview labels each client and never claims live payment data', () => {
  const app = loadApp();
  app.run("answerGeneral('Mi resumen', 'summary')");
  assert.match(app.run("generalHistories.get('general').at(-1).text"), /Luna Studio/);
  assert.match(app.run("generalHistories.get('general').at(-1).text"), /Norte Café/);
  assert.match(app.run("generalHistories.get('general').at(-1).text"), /no saldos consultados a PayPal/);
  assert.equal(app.run("generalHistories.get('general').at(-1).projects.length"), 5);
});

test('normalized fixture references exist and stay within the same project', () => {
  const data = JSON.parse(readFileSync(new URL('../data/demo.json', `file://${__filename}`), 'utf8'));
  for (const [table, rows] of Object.entries(data)) {
    if (!Array.isArray(rows)) continue;
    assert.equal(new Set(rows.map(row => row.id)).size, rows.length, `duplicate id in ${table}`);
  }
  const project = id => data.projects.find(row => row.id === id);
  const versionProject = id => {
    const version = data.documentVersions.find(row => row.id === id);
    assert.ok(version, `missing version ${id}`);
    return data.documents.find(row => row.id === version.documentId).projectId;
  };
  for (const row of data.projects) assert.ok(data.clients.some(client => client.id === row.clientId));
  for (const row of data.clients) assert.ok(data.freelancers.some(owner => owner.id === row.freelancerId));
  for (const row of data.documents) assert.ok(project(row.projectId));
  for (const row of data.requests) {
    assert.equal(versionProject(row.sourceVersionId), row.projectId);
    const message = data.messages.find(message => message.id === row.sourceMessageId);
    assert.ok(message);
    assert.equal(data.conversations.find(thread => thread.id === message.conversationId).projectId, row.projectId);
  }
  for (const row of data.events) {
    assert.ok(project(row.projectId));
    assert.equal(versionProject(row.sourceVersionId), row.projectId);
    if (row.invoiceId) assert.equal(data.invoices.find(invoice => invoice.id === row.invoiceId).projectId, row.projectId);
    if (row.requestId) assert.equal(data.requests.find(request => request.id === row.requestId).projectId, row.projectId);
    assert.equal(row.amount, undefined, 'financial amounts must come from the related entity');
  }
  for (const refund of data.refunds) {
    const invoice = data.invoices.find(row => row.id === refund.invoiceId);
    const request = data.requests.find(row => row.id === refund.requestId);
    assert.equal(invoice.projectId, request.projectId);
    assert.ok(refund.amount <= invoice.amount);
  }
});

test('timeline filters and invoice summaries use the selected project only', () => {
  const app = loadApp();
  app.run("selectedProjectId='SP-002'; historyFilter='cobros'; renderClientActivity(document.querySelector('#client-panel'))");
  const html = app.element('#client-panel').innerHTML;
  assert.match(html, /Norte Café/);
  assert.doesNotMatch(html, /Luna Studio/);
  assert.match(html, /Pago recibido/);
  assert.doesNotMatch(html, /Acuerdo registrado/);
});

test('change flow separates email, review, alternatives and unsigned addendum', () => {
  const app = loadApp();
  app.run("activeProject = projects.find(p => p.id === 'SP-001'); selectedProjectId='SP-001'; changeDraft={option:'swap',amount:0,days:0,scope:'Sustituir una entrega pendiente por la nueva versión',note:'Requiere firma de ambas partes',prepared:false}; stage=1; renderStage()");
  assert.match(app.element('#dialog-content').innerHTML, /Correo ficticio/);
  app.run('stage=2; renderStage()');
  assert.match(app.element('#dialog-content').innerHTML, /ACUERDO VIGENTE/);
  app.run('stage=3; renderStage()');
  assert.match(app.element('#dialog-content').innerHTML, /ANÁLISIS DEL AGENTE/);
  assert.match(app.element('#dialog-content').innerHTML, /Esfuerzo ilustrativo/);
  app.run('stage=4; renderStage()');
  assert.match(app.element('#dialog-content').innerHTML, /Intercambiar trabajo pendiente/);
  assert.match(app.element('#dialog-content').innerHTML, /readonly/);
  app.run('stage=5; renderStage()');
  const html = app.element('#dialog-content').innerHTML;
  assert.match(html, /sin cobro adicional/);
  assert.match(html, /Sin firma/);
  assert.match(html, /No se ha aceptado el cambio/);
  assert.match(html, /data-preview-pdf="DOC-SP-001"/);
  assert.equal(app.run('outcomes.size'), 0);
});

test('new email request stores its source once and leaves the agreement unchanged', () => {
  const app = loadApp();
  app.run("registerLocalChange({projectId:'SP-002',subject:'Agregar una página',sender:'cliente@example.com',emailDate:'2026-10-24',message:'¿Podemos agregar otra página?',filename:'correo.pdf',pdfUrl:null})");
  assert.equal(app.run('knowledgeDocuments.length'), 26);
  assert.equal(app.run('localChangeRequests.length'), 1);
  assert.equal(app.run("localChangeRequests[0].status"), 'pending_analysis');
  assert.equal(app.run("knowledgeDocuments.filter(d=>d.id===localChangeRequests[0].documentId).length"), 1);
  assert.equal(app.run("knowledgeDocuments.at(-1).projectId"), 'SP-002');
  assert.equal(app.run("knowledgeDocuments.find(d=>d.id==='DOC-SP-002').version"), '1.0');
  app.run("selectedProjectId='SP-001'; renderWorkspace(); selectedClientTab='documentos'; renderWorkspace()");
  assert.doesNotMatch(app.element('#client-panel').innerHTML, /Agregar una página|data-open-upload/);
  app.run('resetWorkspaceData()');
  assert.equal(app.run('knowledgeDocuments.length'), 25);
  assert.equal(app.run('localChangeRequests.length'), 0);
});

test('history reflects request progress without a duplicate permanent client card', () => {
  const app=loadApp();
  app.run("registerLocalChange({projectId:'SP-001',subject:'Nueva versión',sender:'cliente@example.com',emailDate:'2026-10-24',message:'Una nueva versión vertical',filename:'correo.pdf',pdfUrl:null}); activeLocalRequest=localChangeRequests[0]; selectedProjectId='SP-001'; currentView='clientes'; updateRequestStatus('analysis_simulated')");
  assert.doesNotMatch(app.element('#client-workspace').innerHTML,/local-request-row/);
  app.run("renderClientActivity(document.querySelector('#client-panel'))");
  assert.match(app.element('#client-panel').innerHTML,/Análisis simulado disponible/);
  assert.match(app.element('#client-panel').innerHTML,/Continuar solicitud/);
  app.run("updateRequestStatus('analysis_reviewed'); updateRequestStatus('draft_ready'); updateRequestStatus('analysis_simulated')");
  assert.equal(app.run('localChangeRequests[0].status'),'draft_ready');
  app.run("renderClientActivity(document.querySelector('#client-panel'))");
  assert.match(app.element('#client-panel').innerHTML,/Adenda preparada/);
  app.run("currentView='cambios'; renderRows()");
  assert.match(app.element('#project-rows').innerHTML,/Adenda preparada/);
});


test('signature step never equates an uploaded file with formalizing the agreement', () => {
  const app=loadApp();
  app.run("activeProject=projects[0]; selectedProjectId='SP-001'; changeDraft={option:'extra',amount:180,days:3,scope:'Agregar subtítulos',note:'',prepared:true,sent:true}; stage=6; renderStage()");
  assert.match(app.element('#dialog-content').innerHTML,/signed-return-form/);
  assert.match(app.element('#dialog-content').innerHTML,/no se cambia el contrato/);
  app.run("changeDraft.returnedDocumentId='RETURN-EXAMPLE'; renderStage()");
  assert.match(app.element('#dialog-content').innerHTML,/continúa con la revisión/);
  assert.match(app.element('#dialog-content').innerHTML,/No se ha formalizado el cambio/);
  assert.equal(app.run("selectedSource().version"),'1.0');
});


test('saved requests restore their adenda and resume at the pending signature step', async () => {
  const app=loadApp();
  app.run("registerLocalChange({projectId:'SP-001',subject:'Adenda pendiente',sender:'',emailDate:'',message:'Agregar otra versión vertical',filename:'ejemplo.pdf',pdfUrl:'/data/pdfs/DOC-SP-001-solicitud.pdf'}); activeLocalRequest=localChangeRequests[0]; activeProject=projects[0]; selectedProjectId='SP-001'; localChangeRequests[0].status='pending_signature_simulated'; savedChangeDrafts.set(localChangeRequests[0].id,{option:'extra',amount:245,days:4,scope:'Otra versión vertical',note:'Condiciones guardadas',prepared:true,sent:true}); window.TratoStore={save: async snapshot=>{window.snapshot=JSON.stringify(snapshot);}};");
  await app.run('persistChangeWorkspace()');
  const snapshot=app.run('window.snapshot');
  const reopened=loadApp();
  reopened.run(`restoreChangeWorkspace(${snapshot}); selectedProjectId='SP-001'; renderClientRequests(document.querySelector('#client-panel'));`);
  assert.match(reopened.element('#client-panel').innerHTML,/Continuar con firma/);
  reopened.run('openFlow(localChangeRequests[0].projectId,localChangeRequests[0].id)');
  assert.equal(reopened.run('stage'),6);
  assert.equal(reopened.run('changeDraft.amount'),245);
  assert.equal(reopened.run('changeDraft.note'),'Condiciones guardadas');
  assert.equal(reopened.run("knowledgeDocuments.filter(d=>d.id===localChangeRequests[0].documentId).length"),1);
  assert.equal(reopened.run("selectedSource().version"),'1.0');
});

test('registered request resumes at its current step and offers no backward actions', () => {
  const app=loadApp();
  app.run("registerLocalChange({projectId:'SP-001',subject:'Sin retroceso',sender:'',emailDate:'',message:'Agregar otra versión vertical',filename:'correo.pdf',pdfUrl:null}); activeLocalRequest=localChangeRequests[0]; activeProject=projects[0]; selectedProjectId='SP-001'; changeDraft={option:'extra',amount:180,days:3,scope:'Agregar subtítulos',note:'',prepared:false}; stage=4; renderStage()");
  assert.doesNotMatch(app.element('#dialog-content').innerHTML,/data-action="back"/);
  app.run('openFlow("SP-001",localChangeRequests[0].id)');
  assert.equal(app.run('stage'),4);
  app.run('changeDraft.prepared=true; stage=6; renderStage()');
  assert.doesNotMatch(app.element('#dialog-content').innerHTML,/data-action="back"/);
  app.run('openFlow("SP-001",localChangeRequests[0].id)');
  assert.equal(app.run('stage'),6);
});

test('complete frontend simulation requires returned document and simulated review, keeps real agreement unchanged', () => {
  const app=loadApp();
  app.run("activeProject=projects[0]; selectedProjectId='SP-001'; stage=6; changeDraft={option:'extra',amount:180,days:3,scope:'Agregar tres versiones verticales',note:'Revisado',prepared:true,sent:true}");
  assert.equal(app.run('completeSimulatedChange()'),false);
  app.run("changeDraft.returnedDocumentId='RETURN-DEMO'; renderStage()");
  assert.match(app.element('#dialog-content').innerHTML,/data-action="simulate-verification"/);
  assert.equal(app.run('completeSimulatedChange()'),false);
  app.run('changeDraft.verificationSimulated=true; renderStage()');
  assert.match(app.element('#dialog-content').innerHTML,/data-action="simulate-formalize"/);
  assert.equal(app.run('completeSimulatedChange()'),true);
  app.run('renderStage()');
  assert.match(app.element('#dialog-content').innerHTML,/Cambio formalizado en la demo/);
  assert.match(app.element('#dialog-content').innerHTML,/Acuerdo v2.0/);
  assert.match(app.element('#dialog-content').innerHTML,/Pendiente de gestionar/);
  assert.equal(app.run("selectedSource().version"),'1.0');
  const eventCount=app.run("actionHistories.get('SP-001').length");
  assert.equal(app.run('completeSimulatedChange()'),false);
  assert.equal(app.run("actionHistories.get('SP-001').length"),eventCount);
});

test('history opens closed request results instead of offering to continue', () => {
  const app=loadApp();
  app.run("registerLocalChange({projectId:'SP-001',subject:'Solicitud cerrada',sender:'',emailDate:'',message:'Agregar una versión vertical',filename:'correo.pdf',pdfUrl:null}); selectedProjectId='SP-001'; savedChangeDrafts.set(localChangeRequests[0].id,{formalizedSimulated:true}); localChangeRequests[0].status='formalized_simulated'; renderClientActivity(document.querySelector('#client-panel'))");
  assert.match(app.element('#client-panel').innerHTML,/Ver resultado ↗/);
  assert.doesNotMatch(app.element('#client-panel').innerHTML,/Continuar solicitud ↗/);
  assert.equal(app.run("requestResumeLabel('unknown-open-request')"),'Continuar solicitud');
});


test('completed additional payment displays view payment and never prepare another charge', () => {
  const app=loadApp();
  app.run("activeProject=projects[0]; selectedProjectId='SP-001'; changeDraft={formalizedSimulated:true,simulatedVersion:'2.0',returnedDocumentId:'RETURN-TEST',amount:180,days:3,scope:'Nueva versión',note:''}; window.TratoPayments={getStatus:()=> 'completed'}; stage=6; renderStage()");
  const html=app.element('#dialog-content').innerHTML;
  assert.match(html,/Ver pago →/);
  assert.match(html,/<dd>Pagado<\/dd>/);
  assert.doesNotMatch(html,/Preparar cobro/);
});
