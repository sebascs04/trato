"""Explicit CLI for simulated worker workflows; never starts the real application."""
import argparse
import json
import os
from pathlib import Path
import sys
from .threads import ThreadWorker


def main():
    parser = argparse.ArgumentParser(description='Workflows simulados de ingesta y cambios en el worker.')
    parser.add_argument('--mode', choices=['simulation'], required=True)
    parser.add_argument('--transport', choices=['stdio', 'redis'], required=True)
    parser.add_argument('--database', default=str(Path(__file__).resolve().parent.parent / '.local/simulation/threads.sqlite'))
    parser.add_argument('--publish', action='store_true')
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    transport = None
    try:
        worker = ThreadWorker(args.database, mode=args.mode)
        if args.transport == 'redis':
            from .redis_transport import RedisTransport
            transport = RedisTransport(os.environ.get('TRATO_SIMULATION_REDIS_URL', ''), worker)
            transport.setup()
            if not args.publish:
                while True:
                    result = transport.process_once()
                    if args.once:
                        print(json.dumps({'processed': result is not None}))
                        return 0
        raw = sys.stdin.buffer.read(32001)
        if len(raw) > 32000:
            raise ValueError('Entrada demasiado grande.')
        envelope = json.loads(raw)
        result = {'queued': transport.publish(envelope)} if transport else worker.handle(envelope)
        print(json.dumps({'data': result}, ensure_ascii=False))
        return 0
    except KeyboardInterrupt:
        return 0
    except Exception:
        print(json.dumps({'error': {'code': 'INGESTION_FAILED',
                                   'message': 'No se completó la operación; revisa el thread y el servicio seleccionado.'}}))
        return 1
    finally:
        if transport:
            transport.close()


if __name__ == '__main__':
    sys.exit(main())
