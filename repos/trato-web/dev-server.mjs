import http from 'node:http';
import {readFile} from 'node:fs/promises';
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/extraction.js', ['extraction.js', 'text/javascript; charset=utf-8']],
  ['/session.js', ['session.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);
http.createServer(async (req, res) => {
  const item = files.get(new URL(req.url, 'http://localhost').pathname);
  if (!item || req.method !== 'GET') {res.writeHead(404); res.end(); return;}
  try {
    res.writeHead(200, {'Content-Type': item[1], 'Cache-Control': 'no-store'});
    res.end(await readFile(new URL(`./public/${item[0]}`, import.meta.url)));
  } catch {res.writeHead(500); res.end('No se pudo cargar el recurso.');}
}).listen(Number(process.env.PORT || 5174), '127.0.0.1', () => console.log('Trato Web: http://localhost:5174'));
