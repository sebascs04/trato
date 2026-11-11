# Trato

> **Judges:** start with **[JUDGES.md](JUDGES.md)**. It has the live demo, the test accounts and a 15-minute walkthrough.

**Trato helps freelancers get paid for what they agreed, and for every change along the way.** Each phase of a project leaves a document behind: the agreement, the client's change request, every addendum version, the acceptance and the sign-off of each deliverable. AI agents read those documents and prepare the next step. A person approves it, and PayPal handles the payment. TeTrato, Trato's agent, works on PayPal for the freelancer through the official PayPal Agent Toolkit: it issues invoices, explains stuck payments and prepares dispute responses.

**Live demo:** https://trato-web-68896425401.us-central1.run.app (PayPal Sandbox, no real money is moved)

## The problem

Scope changes are usually agreed in loose messages. The work grows, the price does not, and when a payment is late or disputed the freelancer has no clear record of what was agreed.

## What Trato does

| For | Feature | How it works |
|---|---|---|
| Freelancer | **Plan from the agreement** | AI proposes deliverables and staged payments from the project's documents |
| Freelancer | **Projects already underway** | Upload what was already agreed and done elsewhere; AI plans only the work that is left and its remaining amount |
| Both | **Approved deliverables** | The freelancer sends each delivery; the client approves it or says what is missing in their account, and only an approved stage is charged |
| Client | **Pay inside Trato** | PayPal's official buttons (JavaScript SDK) on every payment the client makes; the backend creates the order and verifies the capture |
| Freelancer | **PayPal invoices by TeTrato** | Agentic commerce: TeTrato writes the concept and issues a PayPal invoice through the official PayPal Agent Toolkit for an addendum or a deliverable, after the freelancer confirms |
| Freelancer | **Payment detective** | TeTrato reads the payment's live state in PayPal and explains in plain words why it has not gone through and what to do |
| Freelancer | **Addenda from change requests** | AI compares the request with the agreement and drafts scope, conditions and effort. Each version keeps its own PDF, delivery and acceptance |
| Client | **Client portal** | Review, request changes, accept and pay from a secure emailed link, with no account needed. An optional client account opens each project with its work plan, changes, and disputes and problems |
| Client | **Report a problem** | After paying, the client reports a problem in Trato, or TeTrato drafts it. The freelancer replies or turns it into a new request; only the client closes it, and the conversation stays as evidence |
| Both | **Refunds** | The client requests a refund with its reason; TeTrato drafts the decision from the evidence and the freelancer refunds the original PayPal payment in one step |
| Freelancer | **PayPal disputes** | A new dispute on a verified payment, for a deliverable or an addendum, is flagged on the home page. It opens in the project, read through the official PayPal Agent Toolkit, with a response prepared from the project's evidence that the freelancer reviews and sends |
| Both | **TeTrato assistant** | Answers the freelancer's questions about a project, and the client's about their own projects and payments, citing the records it used |
| Freelancer | **Rehearsals** | Practice a difficult conversation with an AI client, then get coaching with cited sources |
| Both | **History and map** | Every phase and document, in one timeline and one graph. The timeline also records each step the client takes: change requests from the portal, approvals of each delivery and every payment request sent |

**Rules the code enforces**

- Agents never send email or move money without a person's approval.
- Only a capture verified by the backend counts as paid. Returning from PayPal or sending an email does not.
- One way to collect each payment: issuing a PayPal invoice retires the checkout link, so a client can never pay twice.
- A paid change is read-only. New work becomes a separate request.
- Agent output is JSON validated in code. If a step fails, Trato shows the error and never fakes a result.

## PayPal and AI in Trato, at a glance

The hackathon asks for a working project that meaningfully uses **both PayPal and AI**. This is where each one lives.

**Requirements**

| Requirement | In Trato |
|---|---|
| Meaningful PayPal integration | Every payment in the product runs on PayPal: checkout, invoices, refunds, disputes and webhooks (table below) |
| Meaningful AI | Gemini agents plan the work, draft addenda, write invoice concepts, explain stuck payments, decide refunds and answer disputes, always citing project documents |
| Working prototype | Live demo on Google Cloud, PayPal Sandbox, a judge account with three loaded projects ([JUDGES.md](JUDGES.md)) |
| Documented | This README, [JUDGES.md](JUDGES.md) and a step-by-step guide with sample PDFs ([examples/cafe-aurora](examples/cafe-aurora/README.md)) |

**PayPal capabilities used**

| PayPal capability | What Trato does with it | Code |
|---|---|---|
| JavaScript SDK (Buttons) | PayPal's own buttons inside Trato on every client payment: deliverables and addenda | `paypal-buttons.mjs` |
| Orders v2 (REST) | The backend creates each order and only counts a capture it verified (order, amount, merchant, currency) | `repos/trato-api/paypal/client.py` |
| Invoicing | TeTrato writes the concept and issues a PayPal invoice for a deliverable or an addendum; a paid invoice completes the payment | `repos/trato-api/trato_api/proposals/invoices.py` |
| Refunds | One-step refund of the original capture, full or partial, after the freelancer confirms | `repos/trato-api/paypal/client.py` (`refund_capture`) |
| Disputes | New disputes flagged on the home page; TeTrato prepares the response; send message, provide evidence, accept claim or escalate, after the freelancer approves | `repos/trato-api/trato_api/disputes.py` |
| Webhooks | Signature-verified events for payments, invoices, refunds and disputes update Trato without a refresh | `payment_webhook.py`, `refunds/webhook.py`, `dispute_webhook.py` |
| PayPal Agent Toolkit | TeTrato's PayPal tools: read orders and disputes, create, send and read invoices | `repos/trato-api/paypal/agent_toolkit.py` |

**AI that acts, with a person's approval (agentic commerce)**

- **Plans and addenda:** Gemini agents in background workers read the project's PDFs and propose staged payments or an addendum, quoting the passages they used (`business_ai.py`, `change_proposal.py`).
- **Invoices:** TeTrato drafts the invoice and issues it in PayPal through the Agent Toolkit once the freelancer confirms (`invoice_concept.py`).
- **Payment detective:** TeTrato reads the payment's live state in PayPal and explains why it has not gone through (`payment_detective.py`).
- **Disputes and refunds:** TeTrato builds a dispute response from the project's evidence (the stage's terms, the delivered file, the client's approval, the payment) and drafts refund decisions (`dispute_defense.py`).
- **The client's TeTrato:** answers "How much have I paid?" from the client's records, and can accept or pay an addendum after the client confirms (`client_assistant.py`, `portal_assistant.py`).

No agent moves money or sends anything on its own: every PayPal action waits for a person's click, and only a capture the backend verifies counts as paid.

**Hackathon themes it covers**

- **AI Agents or Automation:** agents that transact through PayPal (invoices, refunds, dispute responses) on the freelancer's behalf, after approval.
- **Money Movement:** a freelancer is paid per deliverable the moment the client approves it, and sees every payment across clients.
- **Business Solutions:** an invoicing and agreement tool built for freelancers, where every change becomes a paid addendum.

## How it is built

```
Browser (vanilla JS modules)
   │
   ▼
trato-api (FastAPI)  ── authorizes, validates, talks to PayPal, Gmail and Supabase
   │        │
   │        └── trato-file-processor ── extraction, embeddings, Weaviate search
   ▼
Redis queue ── trato-worker (LangGraph + Gemini) ── generic processes defined by their input
```

| Layer | Technology |
|---|---|
| **Payments** | PayPal Sandbox: JavaScript SDK buttons, Orders, Invoicing, Refunds, Disputes, webhooks and the PayPal Agent Toolkit |
| **AI** | Google Gemini through LangGraph and LangChain |
| **Data** | Supabase (Postgres with row-level security, Auth, Storage), Neo4j (project graph), Weaviate (vector search) |
| **Email** | Gmail API |
| **Hosting** | Google Cloud (Cloud Run and Compute Engine) |

## Repository layout

| Folder | Purpose |
|---|---|
| Root (`index.html`, `connected-workspace.mjs`, `portal.html`…) | Web product and client portal |
| `repos/trato-api` | **The backend:** authentication, business rules, persistence, Gmail and PayPal |
| `repos/trato-worker` | Agent graphs, model contracts and job execution |
| `repos/trato-file-processor` | Validation, extraction, chunking and Weaviate operations |
| `repos/trato-web` | Optional technical tool, not the product interface |
| `supabase` | Database migrations, policies and SQL tests |
| `deploy` | Google Cloud images and deployment |
| `examples/cafe-aurora` | A user manual with sample documents for every situation |
| `tools/sample-case` | Sources and generator of the sample PDFs |
| `tests`, `scripts`, `locales`, `assets` | Frontend tests, tooling, English and Spanish text, static files |
| `backend` | Earlier prototype. The product runs on `repos/trato-api` |

## Run it locally

The hosted demo is the quickest way to try Trato. To run it on your own machine, follow these steps on Ubuntu 24.04 or WSL 2; macOS works with the equivalent packages.

### 1. Install the tools

You need Git, Node.js 22, Python 3.12, Redis 7 and Poppler (`pdftotext`). On Ubuntu:

```bash
sudo apt update
sudo apt install git python3.12 python3.12-venv redis-server poppler-utils
```

Install Node.js 22 from https://nodejs.org.

### 2. Clone and install the dependencies

```bash
git clone https://github.com/sebascs04/trato.git
cd trato
npm ci
python3.12 -m venv repos/trato-file-processor/.venv
repos/trato-file-processor/.venv/bin/python -m pip install -r repos/trato-file-processor/requirements.lock.txt
repos/trato-file-processor/.venv/bin/python -m pip install -r repos/trato-api/requirements.lock.txt
python3.12 -m venv repos/trato-worker/.venv
repos/trato-worker/.venv/bin/python -m pip install -r repos/trato-worker/requirements.lock.txt
```

The API and the file processor share one Python environment, and the worker has its own.

### 3. Create the environment files

```bash
cp repos/trato-api/.env.example repos/trato-api/.env
cp repos/trato-file-processor/.env.example repos/trato-file-processor/.env
cp repos/trato-worker/.env.example repos/trato-worker/.env
```

Each `.env.example` lists every variable its service reads, without credentials. Fill in your own:

| Service | Variables |
|---|---|
| API | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVER_KEY`, `FILE_PROCESSOR_TOKEN` (a long random string, the same one as the file processor) |
| API, PayPal Sandbox | `PAYPAL_ENVIRONMENT=sandbox`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MERCHANT_ID`, `PAYPAL_RETURN_URL`, `PAYPAL_CANCEL_URL` |
| Worker, Gemini on Vertex AI | `TRATO_MODEL_PROVIDER=gemini`, `TRATO_GEMINI_BACKEND=vertex`, `TRATO_GEMINI_MODEL`, `TRATO_GOOGLE_CLOUD_PROJECT`, `TRATO_GOOGLE_CLOUD_LOCATION`, `TRATO_GOOGLE_CREDENTIALS_FILE` (absolute path to a service account JSON with the Vertex AI User role) |
| File processor | `FILE_PROCESSOR_TOKEN` |

Apply the database migrations in `repos/trato-api/supabase/migrations` to your Supabase project.

### 4. Connect the queue, search and email

```bash
python3.12 scripts/configure-ingestion.py
repos/trato-file-processor/.venv/bin/python scripts/configure-rehearsal-sources.py --configure
repos/trato-file-processor/.venv/bin/python scripts/configure-vector.py
repos/trato-file-processor/.venv/bin/python scripts/configure-gmail.py
```

These commands set up a private local Redis queue, the rehearsal sources, the Weaviate connection (read from `.local/weaviate/connection.env` with `WEAVIATE_URL` and `WEAVIATE_API_KEY`) and the Gmail OAuth client used to send addenda and payment requests.

### 5. Start Trato

```bash
python3.12 scripts/dev-polyrepo.py --with-worker
```

One supervisor starts the web on 5173, the API on 8100, the file processor on 8101, Redis on 6380 and the AI workers. Open http://localhost:5173, create your account and sign in. To pay as a client, use a PayPal Sandbox Personal account, separate from the Business account that receives the payments.

## Tests

```bash
# Frontend
npm run check
node --test tests/*.test.mjs
node scripts/check-i18n.mjs

# Browser tests (need the local server and Chromium libraries)
npx playwright install chromium
npm run test:browser

# API, from repos/trato-api
PYTHONPATH=../trato-file-processor ../trato-file-processor/.venv/bin/python -m unittest discover -s tests

# Worker, from repos/trato-worker
.venv/bin/python -m unittest discover -s tests
```

## License

Trato is released under the MIT License: see [LICENSE](LICENSE). Third-party licenses, such as the Lucide icons, are in [licenses](licenses).
