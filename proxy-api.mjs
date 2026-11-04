import http from 'node:http';
import https from 'node:https';
import {browserOriginAllowed} from './web-origin.mjs';
import {readFileSync} from 'node:fs';

const localPorts = JSON.parse(readFileSync(new URL('./local-ports.json', import.meta.url), 'utf8'));

// Fixed server-side destination. Browser requests cannot choose an upstream host.
export function proxyApiRequest(req, res, base = process.env.TRATO_API_URL || `http://127.0.0.1:${localPorts.api}`) {
  const upstream = new URL(base);
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password) {
    res.writeHead(503, {'Content-Type':'application/json'});
    res.end(JSON.stringify({error:{code:'API_NOT_CONFIGURED'}})); return;
  }
  const url = new URL(req.url, 'http://localhost');
  if (!browserOriginAllowed(req)) {
    res.writeHead(403); res.end(); return;
  }
  const headers = {};
  for (const name of ['authorization','content-type','content-length','idempotency-key','accept-language']) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }
  if(url.pathname==='/api/v1/webhooks/paypal'){
    for(const name of ['paypal-auth-algo','paypal-cert-url','paypal-transmission-id','paypal-transmission-sig','paypal-transmission-time']){
      if(req.headers[name])headers[name]=req.headers[name];
    }
  }
  const request = (upstream.protocol === 'https:' ? https : http).request({
    protocol:upstream.protocol, hostname:upstream.hostname, port:upstream.port,
    path:url.pathname + url.search, method:req.method, headers,
  }, response => {
    if (res.headersSent || res.destroyed) {response.destroy(); return;}
    const outgoing = {'Cache-Control':'no-store'};
    for (const name of ['content-type','content-length','content-disposition','x-content-type-options']) {
      if (response.headers[name]) outgoing[name] = response.headers[name];
    }
    res.writeHead(response.statusCode || 502, outgoing);
    response.on('error', () => res.destroy());
    response.pipe(res);
  });
  request.setTimeout(90000, () => request.destroy(new Error('upstream timeout')));
  request.on('error', () => {
    if (res.headersSent || res.destroyed) return;
    res.writeHead(503, {'Content-Type':'application/json', 'Cache-Control':'no-store'});
    res.end(JSON.stringify({error:{code:'API_UNAVAILABLE', message:'No se pudo conectar con el servicio de Trato.'}}));
  });
  let size = 0;
  req.on('data', chunk => {
    size += chunk.length;
    if (size > 10485760 && !res.headersSent) {
      res.writeHead(413, {'Content-Type':'application/json'});
      res.end(JSON.stringify({error:{code:'REQUEST_TOO_LARGE'}}));
      req.unpipe(request); request.destroy(); req.resume();
    }
  });
  req.on('aborted', () => request.destroy());
  req.on('error', () => request.destroy());
  res.on('close', () => {if (!res.writableEnded) request.destroy();});
  req.pipe(request);
}
