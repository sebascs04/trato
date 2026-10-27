FROM python:3.12-slim
WORKDIR /app
COPY requirements.lock.txt .
RUN pip install --no-cache-dir -r requirements.lock.txt
COPY trato_api ./trato_api
COPY paypal ./paypal
RUN useradd --create-home api
USER api
CMD ["sh", "-c", "uvicorn trato_api.app:app --host 0.0.0.0 --port ${PORT:-8000} --limit-concurrency 8"]
