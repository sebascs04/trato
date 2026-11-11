# Trato Worker

The worker runs Trato's AI in the background. It reads jobs from a Redis queue, calls Google Gemini through LangChain and LangGraph, and returns structured JSON that the API validates before anything reaches the user.

## What it runs

- **Document processing:** reads each uploaded PDF, checks what it is for, splits it into passages, summarizes it and publishes it for cited search.
- **Business workflows:** the initial work plan with staged payments, addenda from client requests, invoice concepts, the Payment detective, dispute responses, refund decisions, and the freelancer's and the client's assistants.
- **Rehearsals:** a simulated client for practicing difficult conversations, and coaching grounded in approved negotiation sources.

Every agent works only with the tools the API grants for that job. Each answer must quote the passage or record it relies on, and the worker returns it to the API for validation instead of acting on its own.

## Run it

From the repository root, the supervisor starts the workers together with the other services:

```bash
python3 scripts/dev-polyrepo.py --with-worker
```

To prepare this service alone:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock.txt
```

Gemini runs through Vertex AI with a Google Cloud service account. `.env.example` lists the variables, without credentials: `TRATO_MODEL_PROVIDER=gemini`, `TRATO_GEMINI_BACKEND=vertex`, the model, the project, the region and the path to the credentials file.

## Tests

```bash
PYTHONPATH=.:../trato-api:../trato-file-processor .venv/bin/python -m unittest discover -s tests -v
```

The tests use test doubles for the model, so they make no calls to Gemini.
