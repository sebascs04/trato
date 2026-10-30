import http from 'node:http';
import {readFileSync} from 'node:fs';
import {workflowEndpoint} from './workflow-bridge.mjs';
import { extractPdfText, extractEmailFields } from './pdf-extraction.mjs';
import { readFile } from 'node:fs/promises';
import {proxyApiRequest} from './proxy-api.mjs';
import {simulationThreadsEndpoint} from './simulation-threads.mjs';
const localPorts = JSON.parse(readFileSync(new URL('./local-ports.json', import.meta.url), 'utf8'));
const port = Number(process.env.PORT || localPorts.web);
const assets = new Map([
  ['/project-planning.mjs',['project-planning.mjs','text/javascript; charset=utf-8']],
  ['/project-planning.css',['project-planning.css','text/css; charset=utf-8']],
  ['/i18n.mjs',['i18n.mjs','text/javascript; charset=utf-8']],
  ['/locales/es.mjs',['locales/es.mjs','text/javascript; charset=utf-8']],
  ['/locales/en.mjs',['locales/en.mjs','text/javascript; charset=utf-8']],
  ['/visitor-landing.mjs',['visitor-landing.mjs','text/javascript; charset=utf-8']],
  ['/visitor-landing.css',['visitor-landing.css','text/css; charset=utf-8']],
  ['/reputation-workspace.mjs',['reputation-workspace.mjs','text/javascript; charset=utf-8']],
  ['/reputation-workspace.css',['reputation-workspace.css','text/css; charset=utf-8']],
  ['/practice-workspace.mjs',['practice-workspace.mjs','text/javascript; charset=utf-8']],
  ['/practice-workspace.css',['practice-workspace.css','text/css; charset=utf-8']],
  ['/refund-preview.mjs', ['refund-preview.mjs', 'text/javascript; charset=utf-8']],
  ['/refund-preview.css', ['refund-preview.css', 'text/css; charset=utf-8']],
  ['/grafo.html', ['graph-preview.html', 'text/html; charset=utf-8']],
  ['/graph-live.mjs', ['graph-live.mjs', 'text/javascript; charset=utf-8']],
  ['/graph-live.css', ['graph-live.css', 'text/css; charset=utf-8']],
  ['/graph-preview.mjs', ['graph-preview.mjs', 'text/javascript; charset=utf-8']],
  ['/graph-preview.css', ['graph-preview.css', 'text/css; charset=utf-8']],
  ['/assets/fonts/manrope-variable.ttf', ['assets/fonts/manrope-variable.ttf', 'font/ttf']],
  ['/icons.mjs', ['icons.mjs', 'text/javascript; charset=utf-8']],
  ['/proposal-workspace.mjs', ['proposal-workspace.mjs', 'text/javascript; charset=utf-8']],
  ['/paypal-payment.html', ['paypal-payment.html', 'text/html; charset=utf-8']],
  ['/paypal-payment.mjs', ['paypal-payment.mjs', 'text/javascript; charset=utf-8']],
  ['/sandbox-checkout.mjs', ['sandbox-checkout.mjs', 'text/javascript; charset=utf-8']],
  ['/paypal-sandbox-return.html', ['paypal-sandbox-return.html', 'text/html; charset=utf-8']],
  ['/gmail-connection.mjs', ['gmail-connection.mjs', 'text/javascript; charset=utf-8']],
  ['/gmail-callback.html', ['gmail-callback.html', 'text/html; charset=utf-8']],
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/boot.js', ['boot.js', 'text/javascript; charset=utf-8']],
  ['/connected-workspace.mjs', ['connected-workspace.mjs', 'text/javascript; charset=utf-8']],
  ['/auth-session.mjs', ['auth-session.mjs', 'text/javascript; charset=utf-8']],
  ['/connected-workspace.css', ['connected-workspace.css', 'text/css; charset=utf-8']],
  ['/local-store.js', ['local-store.js', 'text/javascript; charset=utf-8']],
  ['/payment-api.js', ['payment-api.js', 'text/javascript; charset=utf-8']],
  ['/payment-panel.js', ['payment-panel.js', 'text/javascript; charset=utf-8']],
  ['/workflow-ui.js', ['workflow-ui.js', 'text/javascript; charset=utf-8']],
  ['/data/demo.json', ['data/demo.json', 'application/json; charset=utf-8']],
]);
const demo = JSON.parse(await readFile(new URL('data/demo.json', import.meta.url), 'utf8'));
for (const doc of demo.documents) {
  assets.set(`/data/pdfs/${doc.id}.pdf`, [`data/pdfs/${doc.id}.pdf`, 'application/pdf']);
}
http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname==='/api/simulation/threads'||pathname.startsWith('/api/simulation/threads/')) {await simulationThreadsEndpoint(req,res);return;}
  if (pathname.startsWith('/api/v1/')) {proxyApiRequest(req,res); return;}
  if (pathname === '/api/workflows') { await workflowEndpoint(req,res); return; }
  if (pathname === '/api/extract-email-pdf') {
    const json = (status, value) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(value)); };
    if (req.method !== 'POST') { json(405,{error:'Método no permitido.'}); return; }
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) { json(403,{error:'Origen no permitido.'}); return; }
    if (req.headers['content-type'] !== 'application/pdf') { json(415,{error:'Selecciona un PDF.'}); return; }
    try {
      let size=0; const chunks=[];
      for await (const chunk of req) { size+=chunk.length; if(size>10*1024*1024){json(413,{error:'El PDF supera 10 MB.'});return;} chunks.push(chunk); }
      const bytes=Buffer.concat(chunks);
      if(bytes.subarray(0,5).toString()!=='%PDF-'){json(400,{error:'El archivo no tiene una cabecera PDF válida.'});return;}
      const text=await extractPdfText(bytes);
      json(200,{...extractEmailFields(text),method:'local-text',notice:'Texto extraído localmente, sin IA ni verificación de autenticidad.'});
    } catch(error) {
      const messages={PDF_NO_TEXT:'No encontramos texto seleccionable. El PDF puede ser una imagen; aún no hay OCR conectado.',PDF_UNAVAILABLE:'La herramienta local de lectura PDF no está disponible.',PDF_TIMEOUT:'El PDF tardó demasiado en procesarse.',PDF_TOO_LONG:'El documento contiene demasiado texto para esta lectura.',PDF_UNREADABLE:'No pudimos leer el PDF. Puede estar dañado o protegido.'};
      json(422,{error:messages[error.message] || 'No pudimos procesar el documento.'});
    }
    return;
  }
  const asset = assets.get(pathname);
  if (!asset) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const body = await readFile(new URL(asset[0], import.meta.url));
    res.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': pathname==='/assets/fonts/manrope-variable.ttf'?'public, max-age=86400':'no-store' });
    res.end(body);
  } catch { res.writeHead(500); res.end('Unable to read asset'); }
}).listen(port, '127.0.0.1', () => console.log(`Trato local: http://localhost:${port}`));
