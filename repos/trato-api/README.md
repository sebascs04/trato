# Trato API

The Trato API is the public backend of the product. It authenticates every request with Supabase Auth, owns the business rules, and is the only service that talks to PayPal, Gmail and Supabase on the user's behalf. The browser never receives a server key.

## What it does

- **Clients, projects and documents:** creates and reads the signed-in freelancer's clients and projects, stores every uploaded PDF privately and queues it for reading.
- **PayPal:** creates Orders v2 and verifies each capture before a payment counts, issues invoices through the PayPal Agent Toolkit, refunds captures in full or in part, reads and answers disputes, and accepts signature-verified webhooks for payments, invoices, refunds and disputes.
- **AI jobs:** sends work plans, addenda, invoice concepts, dispute responses and the assistants' questions to the Gemini workers through a Redis queue, then validates every answer and its citations before showing it.
- **Client portal and client account:** lets a client review, accept and pay from a secure link or from their own account.
- **Email:** sends addenda and payment requests from Trato's mailbox through the Gmail API.

## Run it

From the repository root, the supervisor starts this service together with the others (see the main README):

```bash
python3 scripts/dev-polyrepo.py --with-worker
```

To run the API alone:

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.lock.txt
.venv/bin/uvicorn trato_api.app:app --host 127.0.0.1 --port 8100
```

`.env.example` lists every variable the API reads, without credentials. `GET /health` reports the process and its configuration.

## Tests

```bash
.venv/bin/python -m unittest discover -s tests -v
```

The tests use test doubles for PayPal, Supabase and the queue, so they need no network access.
