"""Local development gateway: expose only the exact PayPal refund webhook route."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parent.parent
PORTS = json.loads((ROOT / 'local-ports.json').read_text())
ROUTE = '/api/v1/refunds/webhooks/paypal'


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Payloads and signature headers are private.

    def reply(self, status, body=b''):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.reply(404)

    def do_POST(self):
        if self.path != ROUTE:
            self.reply(404)
            return
        try:
            length = int(self.headers.get('Content-Length', '-1'))
        except ValueError:
            length = -1
        if self.headers.get('Transfer-Encoding') or not 0 <= length <= 256 * 1024:
            self.reply(413)
            return
        body = self.rfile.read(length)
        headers = {k: v for k, v in self.headers.items() if k.lower().startswith('paypal-')}
        headers['Content-Type'] = 'application/json'
        request = Request(f"http://127.0.0.1:{PORTS['api']}{ROUTE}", data=body,
                          headers=headers, method='POST')
        try:
            with urlopen(request, timeout=45) as response:
                self.reply(response.status, response.read(65536))
        except HTTPError as error:
            self.reply(error.code, error.read(65536))
        except (URLError, TimeoutError, OSError):
            self.reply(503, b'{"error":{"code":"REFUND_API_UNAVAILABLE"}}')


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', PORTS['refund_webhook_gateway']), Handler)
    print(f"Refund webhook gateway: 127.0.0.1:{PORTS['refund_webhook_gateway']}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
