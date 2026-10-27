FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.lock.txt .
RUN pip install --no-cache-dir -r requirements.lock.txt
COPY file_processor ./file_processor
RUN useradd --create-home processor
USER processor
CMD ["sh", "-c", "uvicorn file_processor.app:app --host 0.0.0.0 --port ${PORT:-8001} --limit-concurrency 8 --timeout-keep-alive 5"]
