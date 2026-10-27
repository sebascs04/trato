import {SessionClient, apiRequest} from './session.js';
const $ = selector => document.querySelector(selector);
let session, api, clients = [], projects = [], busy = false, uploadCommand = null;
function status(text) {$('#status').textContent = text;}
function baseUrl() {
  const url = new URL($('#api-url').value);
  if (url.username || url.password || !['http:','https:'].includes(url.protocol) ||
      (url.protocol === 'http:' && !['localhost','127.0.0.1'].includes(url.hostname))) throw new Error('Usa una API HTTPS o local.');
  return url.origin;
}
async function connection() {
  api = baseUrl();
  const response = await fetch(api + '/api/v1/config', {signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error('La API no tiene configurado el acceso a Supabase.');
  session = new SessionClient((await response.json()).data);
}
async function request(path, options, blob) {return apiRequest(session, api, path, options, blob);}
function jsonPost(data) {return {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)};}
async function action(task) {
  if (busy) return;
  busy = true; document.querySelectorAll('button').forEach(button => {button.disabled = true;});
  try {await task();} catch (error) {status(error.name === 'TimeoutError' ? 'Se agotó el tiempo. Actualiza antes de reintentar.' : error.message);}
  finally {busy = false; document.querySelectorAll('button').forEach(button => {button.disabled = false;});}
}
function options(selector, items, label) {
  const node = $(selector), previous = node.value;
  node.replaceChildren(new Option('Selecciona…',''), ...items.map(item => new Option(label(item),item.id)));
  if (items.some(item => item.id === previous)) node.value = previous;
  else if (items.length) node.value = items[0].id;
}
async function loadWorkspace() {
  await request('/api/v1/session');
  $('#identity').textContent = session.session.user.email || 'Sesión iniciada';
  $('#login-section').hidden = true; $('#workspace').hidden = false;
  [clients,projects] = await Promise.all([request('/api/v1/clients'),request('/api/v1/projects')]);
  options('#client-selector', clients, item => item.name);
  options('#project-selector', projects, item => `${clients.find(c => c.id === item.client_id)?.name || 'Cliente'} · ${item.name}`);
  await loadProject();
}
function renderExtraction(data) {
  $('#result').hidden = false;
  $('#metadata').textContent = `${data.document.title} · ${data.extraction.status} · SHA-256 ${data.document.sha256}`;
  $('#warnings').textContent = (data.extraction.warnings || []).join(' '); $('#segments').replaceChildren();
  for (const segment of data.segments) {
    const article = document.createElement('article'), heading = document.createElement('h3'), text = document.createElement('pre');
    heading.textContent = `${segment.locator_kind === 'page' ? 'Página' : 'Párrafo'} ${segment.locator_number}`;
    text.textContent = segment.text; article.append(heading,text); $('#segments').append(article);
  }
}
async function loadProject() {
  $('#documents').replaceChildren(); $('#events').replaceChildren(); $('#result').hidden = true;
  const id = $('#project-selector').value;
  if (!id) {$('#documents').textContent = 'Crea un cliente y un proyecto para incorporar documentos.'; return;}
  const [documents,events] = await Promise.all([request(`/api/v1/projects/${id}/documents`),request(`/api/v1/projects/${id}/events`)]);
  if (!documents.length) $('#documents').textContent = 'Todavía no hay documentos en este proyecto.';
  for (const doc of documents) {
    const article = document.createElement('article'), heading = document.createElement('h3'), detail = document.createElement('p');
    const extraction = Array.isArray(doc.document_extractions) ? doc.document_extractions[0] : doc.document_extractions;
    heading.textContent = doc.title; detail.textContent = `${doc.original_filename} · ${extraction?.status || 'queued'} · origen por verificar`;
    const view = document.createElement('button'); view.className = 'secondary'; view.textContent = 'Ver texto';
    view.addEventListener('click', () => action(async () => renderExtraction(await request(`/api/v1/documents/${doc.id}/extraction`))));
    const download = document.createElement('button'); download.className = 'secondary'; download.textContent = 'Descargar original';
    download.addEventListener('click', () => action(async () => {
      const blob = await request(`/api/v1/documents/${doc.id}/file`, {}, true), url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = doc.original_filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }));
    article.append(heading,detail,view,download);
    if (extraction?.status !== 'ready') {
      const retry = document.createElement('button'); retry.className = 'secondary'; retry.textContent = 'Reintentar lectura';
      retry.addEventListener('click', () => action(async () => {await request(`/api/v1/documents/${doc.id}/retry`, {method:'POST'}); await loadProject(); status('Lectura guardada.');})); article.append(retry);
    }
    $('#documents').append(article);
  }
  const labels = {document_registered:'Documento registrado',extraction_completed:'Texto extraído y guardado',extraction_failed:'Lectura pendiente de reintento'};
  for (const event of events) {
    const line = document.createElement('p'); line.textContent = `${new Intl.DateTimeFormat('es-PE',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Lima'}).format(new Date(event.created_at))} · ${labels[event.event_type] || event.event_type}`; $('#events').append(line);
  }
}
$('#login-form').addEventListener('submit', event => {event.preventDefault(); action(async () => {
  await connection(); await session.login($('#email').value.trim(),$('#password').value); $('#password').value = '';
  await loadWorkspace(); status('Sesión iniciada. Tus datos se recuperan desde Supabase.');
});});
$('#signup').addEventListener('click', () => action(async () => {
  if (!$('#login-form').reportValidity()) return;
  await connection(); const signedIn = await session.signup($('#email').value.trim(),$('#password').value); $('#password').value = '';
  if (signedIn) {await loadWorkspace(); status('Cuenta creada.');} else status('Revisa tu correo y confirma la cuenta. Después vuelve aquí e inicia sesión.');
}));
$('#logout').addEventListener('click', () => action(async () => {
  await session.logout(); $('#workspace').hidden = true; $('#login-section').hidden = false;
  $('#documents').replaceChildren(); $('#events').replaceChildren(); $('#segments').replaceChildren(); clients = []; projects = []; uploadCommand = null; status('Sesión cerrada en este navegador.');
}));
$('#client-form').addEventListener('submit', event => {event.preventDefault(); action(async () => {
  await request('/api/v1/clients',jsonPost({name:$('#client-name').value,contact_email:$('#client-email').value.trim() || null}));
  $('#client-form').reset(); await loadWorkspace(); status('Cliente guardado.');
});});
$('#project-form').addEventListener('submit', event => {event.preventDefault(); action(async () => {
  await request('/api/v1/projects',jsonPost({client_id:$('#client-selector').value,name:$('#project-name').value}));
  $('#project-name').value = ''; await loadWorkspace(); status('Proyecto guardado.');
});});
$('#project-selector').addEventListener('change', () => action(loadProject)); $('#refresh').addEventListener('click', () => action(loadWorkspace));
$('#extract-form').addEventListener('submit', event => {event.preventDefault(); action(async () => {
  const file = $('#document').files[0], project = $('#project-selector').value;
  if (!file || file.size > 10485760) throw new Error('Selecciona un archivo de hasta 10 MB.');
  const command = JSON.stringify([project,file.name,file.size,file.lastModified,$('#document-title').value,$('#document-kind').value]);
  if (uploadCommand?.command !== command) uploadCommand = {command,key:crypto.randomUUID()};
  const params = new URLSearchParams({filename:file.name,title:$('#document-title').value,kind:$('#document-kind').value}); status('Guardando el original y leyendo su contenido…');
  let data;
  try {data = await request(`/api/v1/projects/${project}/documents?${params}`,{method:'POST',body:file,
    headers:{'Content-Type':file.name.toLowerCase().endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf','Idempotency-Key':uploadCommand.key}});}
  catch (error) {await loadProject(); throw error;}
  await loadProject(); renderExtraction(data); uploadCommand = null;
  $('#document').value = ''; $('#document-title').value = ''; status('Original y texto guardados. Puedes recargar y recuperarlos desde este proyecto.');
});});
action(async () => {await connection(); if (session.session) {await loadWorkspace(); status('Sesión y documentos recuperados.');} else status('Inicia sesión o crea una cuenta para empezar.');});
