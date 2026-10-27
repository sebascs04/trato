"""Connected worker process. All modes and endpoints are explicitly configured."""
import argparse
import os
import json
import time
from redis.exceptions import ConnectionError,TimeoutError
from .connected import ConnectedWorker,ExtractionClient
from .redis_transport import RedisTransport


def main():
    parser=argparse.ArgumentParser(description='Worker conectado para extraer PDF reales.')
    parser.add_argument('--mode',choices=['connected'],required=True)
    parser.add_argument('--once',action='store_true')
    args=parser.parse_args()
    worker=ConnectedWorker(ExtractionClient(os.environ.get('TRATO_API_URL',''),os.environ.get('TRATO_WORKER_TOKEN',''),
                                           os.environ.get('FILE_PROCESSOR_URL',''),os.environ.get('FILE_PROCESSOR_TOKEN','')))
    bus=RedisTransport(os.environ.get('TRATO_REDIS_URL',''),worker)
    try:
        bus.setup()
        while True:
            try:
                bus.process_once()
            except (RuntimeError,ConnectionError,TimeoutError):
                print(json.dumps({'error':{'code':'WORKER_SERVICE_UNAVAILABLE'},'pending_preserved':True}),flush=True)
                if args.once:raise
                time.sleep(1)
            if args.once:return
    finally:bus.close()


if __name__=='__main__':main()
